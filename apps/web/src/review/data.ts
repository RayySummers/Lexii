/**
 * 复习数据源（IndexedDB 实现）。
 *
 * 所有数据操作经由 @lexilexi/core 的公开 API：
 * - loadQueue：getStudyQueueItemIds（按模式筛选 + 排序 + 混合穿插）→
 *   bulkGet（条目 / 义项 / 记忆状态，各一次批量往返，不在循环里逐条查询）
 *   → buildReviewQueue（完整性校验，保持 core 给定的顺序）
 * - grade：gradeReview（读旧状态 → FSRS 排期 → 事件 + 状态单事务原子落库）
 * - importSampleWordlist：importCsvWordlist（内置示例词表，空状态一键体验）
 *
 * 每日新卡上限（RAY-260 评审 suggestion 2）：learn / mixed 模式在取队列前，
 * 用 @lexilexi/stats 的 computeLearnedTodayCount（今天首次被复习的词条数，
 * 事件投影、无需额外状态）折算「今日剩余新卡额度」传给 core 截取；
 * review 模式只含复习卡，不触发额度计算。
 */
import {
  SAMPLE_WORDLIST_CSV,
  exportLexilexiData,
  getStudyQueueItemIds,
  gradeReview,
  importCsvWordlist,
  isReviewEvent,
  openDatabase,
} from "@lexilexi/core";
import type {
  LearningItem,
  LexilexiDatabase,
  LexilexiExportData,
  MemoryState,
  ReviewRating,
  StudyMode,
} from "@lexilexi/core";
import { computeLearnedTodayCount } from "@lexilexi/stats";
import { readDailyNewCardLimit } from "../lib/dailyNewCardLimit";
import { buildReviewQueue } from "./queue";
import type { GradeContext, ReviewCard, ReviewDataProvider } from "./types";

/** 示例词表来源标识（写入 LearningItem.source 与 import 事件，供溯源） */
const SAMPLE_SOURCE = "内置示例词表";

/** 按「每日上限 − 今日已学新词」折算剩余新卡额度（learn/mixed 用；review 用不到） */
async function resolveNewCardLimit(db: LexilexiDatabase, now: string): Promise<number> {
  const configured = readDailyNewCardLimit();
  const reviewEvents = await db.events.where("type").equals("review").toArray();
  const learnedToday = computeLearnedTodayCount(reviewEvents.filter(isReviewEvent), now);
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

    async grade(card: ReviewCard, rating: ReviewRating, context: GradeContext): Promise<void> {
      await gradeReview(db, {
        itemId: card.item.id,
        senseId: card.sense.id,
        exerciseType: "recall",
        rating,
        reviewDurationMs: context.reviewDurationMs,
        revealed: context.revealed,
        answerWasCorrect: rating !== "again",
      });
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
