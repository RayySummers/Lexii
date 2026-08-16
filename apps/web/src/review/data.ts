/**
 * 复习数据源（IndexedDB 实现）。
 *
 * 所有数据操作经由 @lexilexi/core 的公开 API：
 * - loadQueue：getStudyQueueItemIds（按模式筛选 + 排序 + 混合穿插）→
 *   bulkGet（条目 / 义项 / 记忆状态，各一次批量往返，不在循环里逐条查询）
 *   → buildReviewQueue（完整性校验，保持 core 给定的顺序）
 * - grade：gradeReview（读旧状态 → FSRS 排期 → 事件 + 状态单事务原子落库），
 *   返回事件 id 与评分前状态（撤销证据）
 * - markMastered：gradeReview(rating=easy, mastered=true)（标熟，RAY-265）
 * - undoGrade：undoReview（删除事件 + 恢复评分前状态，单事务原子回滚）
 * - importSampleWordlist：importCsvWordlist（内置示例词表，空状态一键体验）
 *
 * 每日新卡上限（RAY-260 评审 suggestion 2）：learn / mixed 模式在取队列前，
 * 用 @lexilexi/stats 的 computeLearnedTodayCount（今天首次被复习的词条数，
 * 事件投影、无需额外状态）折算「今日剩余新卡额度」传给 core 截取；
 * review 模式只含复习卡，不触发额度计算。读取路径见 resolveNewCardLimit。
 */
import {
  SAMPLE_WORDLIST_CSV,
  exportLexilexiData,
  generateOptions,
  getStudyQueueItemIds,
  gradeReview,
  importCsvWordlist,
  isReviewEvent,
  openDatabase,
  undoReview,
} from "@lexilexi/core";
import type {
  EventId,
  ItemId,
  LearningItem,
  LexilexiDatabase,
  LexilexiExportData,
  MemoryState,
  ReviewEvent,
  ReviewRating,
  StudyMode,
} from "@lexilexi/core";
import { computeLearnedTodayCount, localDayBounds } from "@lexilexi/stats";
import { readDailyNewCardLimit } from "../lib/dailyNewCardLimit";
import { buildReviewQueue } from "./queue";
import type {
  GradeContext,
  GradeResult,
  MultipleChoiceQueueResult,
  QueueMeta,
  ReviewCard,
  ReviewDataProvider,
} from "./types";

/** 示例词表来源标识（写入 LearningItem.source 与 import 事件，供溯源） */
const SAMPLE_SOURCE = "内置示例词表";

/**
 * 按「每日上限 − 今日已学新词」折算剩余新卡额度（learn/mixed 用；review 用不到）。
 *
 * 扩展性（Oscar 复评 suggestion 1）：不整表读 review 事件——
 * - 今日事件走 time 索引区间（本地日 [00:00, 次日 00:00)），读取量随当日
 *   复习次数增长，不随历史累积；
 * - 「是否今日首次复习」的证据从今日 00:00 反向扫描时间索引、只收集命中
 *   候选词条的事件，候选集清零即提前停止——日常复习用户每次只读几十条
 *   最近的前日事件。最坏情形（今日复习的全是新导入词，历史中无证据）退化为
 *   一次早前历史扫描，与旧实现同阶，绝不更差。
 */
async function resolveNewCardLimit(db: LexilexiDatabase, now: string): Promise<number> {
  const configured = readDailyNewCardLimit();
  const bounds = localDayBounds(now);

  // 1. 今日复习事件（time 索引区间查询）
  const todayReviews = (
    await db.events
      .where("time")
      .between(bounds.start, bounds.end, true, false)
      .filter((event) => event.type === "review")
      .toArray()
  ).filter(isReviewEvent);
  if (todayReviews.length === 0) {
    return configured;
  }

  // 2. 首次复习证据：今日之前存在 review 事件的词条，其「学习」不属于今天。
  //    反向扫描（从今日 00:00 往回，时间上由近及远），每命中一个候选词条
  //    取一条证据并移出候选集；候选集清零即提前停止。
  const candidates = new Set(todayReviews.map((event) => event.itemId));
  const earlierEvidence: ReviewEvent[] = [];
  await db.events
    .where("time")
    .below(bounds.start)
    .reverse()
    .filter((event) => isReviewEvent(event) && candidates.has(event.itemId))
    .until(() => candidates.size === 0)
    .each((event) => {
      if (isReviewEvent(event) && candidates.delete(event.itemId)) {
        earlierEvidence.push(event);
      }
    });

  // 3. 「今日已学新词」口径复用 @lexilexi/stats 纯函数：给定集合内每词条的
  //    最早 review 事件落在今天即计为今日新学（todayReviews ∪ 早前证据）。
  const learnedToday = computeLearnedTodayCount([...todayReviews, ...earlierEvidence], now);
  return Math.max(0, configured - learnedToday);
}

/** 基于已打开的 Lexilexi 数据库创建复习数据源（测试注入 fake-indexeddb 实例） */
export function createIndexedDbReviewDataProvider(db: LexilexiDatabase): ReviewDataProvider {
  return {
    async loadQueue(mode: StudyMode): Promise<ReviewCard[]> {
      const now = new Date().toISOString();
      const newCardLimit = mode === "review" ? undefined : await resolveNewCardLimit(db, now);
      const ids = await getStudyQueueItemIds(db, now, mode, { newCardLimit });
      if (ids.length === 0) {
        return [];
      }
      // items / memories 与 ids 对齐（bulkGet 平行数组）；senses 按保留条目取
      const [items, memories] = await Promise.all([
        db.items.bulkGet(ids),
        db.memoryStates.bulkGet(ids),
      ]);
      const kept = alignCompletePairs(items, memories);
      const senses = await db.senses.bulkGet(kept.map((pair) => pair.item.senseId));
      return buildReviewQueue(
        kept.map((pair) => pair.item),
        senses,
        kept.map((pair) => pair.memory),
        now,
      );
    },

    /**
     * 队列元信息（RAY-276 诊断线 3）：队列为空时区分「额度已用完」与
     * 「没有内容」。额度口径与 loadQueue 一致（resolveNewCardLimit）；
     * hasDueNewWords 为未截断口径（不传 newCardLimit 的新词队列非空）。
     */
    async loadQueueMeta(mode: StudyMode): Promise<QueueMeta> {
      const now = new Date().toISOString();
      if (mode === "review") {
        return { remainingNewCardQuota: null, hasDueNewWords: false };
      }
      const remaining = await resolveNewCardLimit(db, now);
      const uncappedNewIds = await getStudyQueueItemIds(db, now, "learn");
      return { remainingNewCardQuota: remaining, hasDueNewWords: uncappedNewIds.length > 0 };
    },

    async loadMultipleChoiceQueue(mode: StudyMode): Promise<MultipleChoiceQueueResult> {
      const now = new Date().toISOString();
      const newCardLimit = mode === "review" ? undefined : await resolveNewCardLimit(db, now);
      const ids = await getStudyQueueItemIds(db, now, mode, { newCardLimit });
      if (ids.length === 0) {
        return { questions: [], cards: [] };
      }
      const [items, memories] = await Promise.all([
        db.items.bulkGet(ids),
        db.memoryStates.bulkGet(ids),
      ]);
      const kept = alignCompletePairs(items, memories);
      const senses = await db.senses.bulkGet(kept.map((pair) => pair.item.senseId));
      const cards = buildReviewQueue(
        kept.map((pair) => pair.item),
        senses,
        kept.map((pair) => pair.memory),
        now,
      );
      // 加载全部义项（混淆项生成用；词库规模数千条，单次全量可接受）
      const allSenses = await db.senses.toArray();
      // 查询历史常错词：laps es > 0 的条目的 term
      const wrongItemIds = kept
        .filter((pair) => pair.memory.fields.lapses > 0)
        .map((pair) => pair.item.id);
      const wrongItems = await db.items.bulkGet(wrongItemIds);
      const wrongSenses = await db.senses.bulkGet(
        wrongItems
          .filter((item): item is LearningItem => item !== undefined)
          .map((item) => item.senseId),
      );
      const wrongTerms = wrongSenses
        .filter((sense): sense is NonNullable<typeof sense> => sense !== undefined)
        .map((sense) => sense.term);

      const questions = cards.map((card) => ({
        sense: card.sense,
        options: generateOptions(card.sense, allSenses, wrongTerms),
      }));
      return { questions, cards };
    },

    async grade(
      card: ReviewCard,
      rating: ReviewRating,
      context: GradeContext,
    ): Promise<GradeResult> {
      const result = await gradeReview(db, {
        itemId: card.item.id,
        senseId: card.sense.id,
        exerciseType: context.exerciseType ?? "recall",
        rating,
        reviewDurationMs: context.reviewDurationMs,
        revealed: context.revealed,
        answerWasCorrect: context.answerWasCorrect ?? rating !== "again",
      });
      return {
        reviewEventId: result.reviewEvent.id,
        previousMemoryState: result.previousMemoryState,
      };
    },

    async markMastered(card: ReviewCard, context: GradeContext): Promise<GradeResult> {
      // 标熟（RAY-265）：记录一次「已熟」评级——映射 FSRS easy（长间隔），
      // 词保留词书、不挂起不剔除；mastered 标记随事件落库供追溯。
      const result = await gradeReview(db, {
        itemId: card.item.id,
        senseId: card.sense.id,
        exerciseType: context.exerciseType ?? "recall",
        rating: "easy",
        mastered: true,
        reviewDurationMs: context.reviewDurationMs,
        revealed: context.revealed,
        answerWasCorrect: true,
      });
      return {
        reviewEventId: result.reviewEvent.id,
        previousMemoryState: result.previousMemoryState,
      };
    },

    async undoGrade(
      itemId: ItemId,
      eventId: EventId,
      previousMemoryState: MemoryState,
    ): Promise<void> {
      await undoReview(db, { itemId, eventId, previousMemoryState });
    },

    async hasAnyItems(): Promise<boolean> {
      return (await db.items.count()) > 0;
    },

    async importSampleWordlist(): Promise<number> {
      const result = await importCsvWordlist(db, SAMPLE_WORDLIST_CSV, { source: SAMPLE_SOURCE });
      return result.importedCount;
    },

    async exportBackup(): Promise<LexilexiExportData> {
      return exportLexilexiData(db, new Date().toISOString());
    },
  };
}

/**
 * 浏览器默认数据源：打开真实 IndexedDB（window.indexedDB）。
 * 仅可在浏览器环境调用；测试通过注入 mock / fake-indexeddb 实例绕过。
 */
export function createDefaultReviewDataProvider(): ReviewDataProvider {
  return createIndexedDbReviewDataProvider(openDatabase());
}

/** 条目与记忆状态都存在的对齐槽位（缺任一方的条目跳过，义项查询前先滤掉） */
interface CompletePair {
  item: LearningItem;
  memory: MemoryState;
}

function alignCompletePairs(
  items: readonly (LearningItem | undefined)[],
  memories: readonly (MemoryState | undefined)[],
): CompletePair[] {
  const pairs: CompletePair[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const memory = memories[i];
    if (item && memory && item.status === "active") {
      pairs.push({ item, memory });
    }
  }
  return pairs;
}
