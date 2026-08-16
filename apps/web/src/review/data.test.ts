/**
 * 复习数据源集成测试（fake-indexeddb）。
 *
 * 走真实 @lexilexi/core 路径：导入示例词表 → 按模式加载队列（学习 / 复习 /
 * 混合）→ 评分落库 → 队列缩短。与 packages/core 的 persistence.test.ts 使用
 * 同一 fake-indexeddb 注入方式（IDBFactory + IDBKeyRange），不依赖浏览器环境。
 */
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import {
  importCsvWordlist,
  isReviewEvent,
  openDatabase,
  SAMPLE_WORDLIST_ROW_COUNT,
} from "@lexilexi/core";
import type { LexilexiDatabase } from "@lexilexi/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIndexedDbReviewDataProvider } from "./data";
import type { ReviewCard } from "./types";
import { makeItem, makeMemory, makeSense, pastIso } from "./testFixtures";

/** 与 openDatabase 的参数类型对齐，避免直接依赖 dexie 的类型声明 */
function makeOptions(): Parameters<typeof openDatabase>[0] {
  return { indexedDB: new IDBFactory(), IDBKeyRange };
}

let db: LexilexiDatabase | undefined;

beforeEach(() => {
  db = openDatabase(makeOptions());
  try {
    window.localStorage.clear();
  } catch {
    // 忽略清理失败
  }
});

afterEach(async () => {
  await db?.delete();
  db = undefined;
});

/** 把指定卡改为「已评分且到期」（reps > 0，due 在过去），模拟复习过的词 */
async function markReviewed(card: ReviewCard): Promise<void> {
  await db!.memoryStates.put({
    ...card.memory,
    fields: {
      ...card.memory.fields,
      reps: card.memory.fields.reps + 1,
      due: pastIso(new Date(), 3_600_000),
    },
    updatedAt: new Date().toISOString(),
  });
}

describe("createIndexedDbReviewDataProvider", () => {
  it("空库：三模式 loadQueue 均为空，hasAnyItems 为 false", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    expect(await provider.loadQueue("learn")).toEqual([]);
    expect(await provider.loadQueue("review")).toEqual([]);
    expect(await provider.loadQueue("mixed")).toEqual([]);
    expect(await provider.hasAnyItems()).toBe(false);
  });

  it("导入示例词表后：全部词条进入学习队列，复习队列为空", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    const imported = await provider.importSampleWordlist();
    expect(imported).toBe(SAMPLE_WORDLIST_ROW_COUNT);

    const learnQueue = await provider.loadQueue("learn");
    expect(learnQueue).toHaveLength(SAMPLE_WORDLIST_ROW_COUNT);
    // 新卡均未评分：复习队列（reps > 0）为空
    expect(await provider.loadQueue("review")).toEqual([]);
    // 复习为空时混合退化为纯新词队列
    expect(await provider.loadQueue("mixed")).toHaveLength(SAMPLE_WORDLIST_ROW_COUNT);
    expect(await provider.hasAnyItems()).toBe(true);

    // 新卡 due 为导入时刻，同一批导入 due 相同，队列顺序稳定（due 升序）
    const dues = learnQueue.map((card) => card.memory.fields.due);
    const sorted = [...dues].sort();
    expect(dues).toEqual(sorted);
  });

  it("评分后该卡离开学习队列，且记忆状态按排期更新", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();
    const queue = await provider.loadQueue("learn");
    const card = queue[0]!;

    await provider.grade(card, "good", { reviewDurationMs: 2_000, revealed: true });

    const remaining = await provider.loadQueue("learn");
    expect(remaining).toHaveLength(queue.length - 1);
    expect(remaining.some((entry) => entry.item.id === card.item.id)).toBe(false);

    const memory = await db!.memoryStates.get(card.item.id);
    expect(memory?.fields.reps).toBe(1);
    expect(memory?.fields.lastRating).toBe("good");
    expect(memory?.fields.lastReviewAt).not.toBeNull();
    // good 走学习第二步：due 在未来 10 分钟内。日历日口径（RAY-276 诊断线 2）
    // 下仍属「今日到期」，复习队列包含它（提前复习为 FSRS 合法输入）
    expect(memory!.fields.due > new Date().toISOString()).toBe(true);
    const reviewQueue = await provider.loadQueue("review");
    expect(reviewQueue).toHaveLength(1);
    expect(reviewQueue[0]!.item.id).toBe(card.item.id);
  });

  it("已评分且到期的卡只进入复习队列，不进学习队列", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();
    const queue = await provider.loadQueue("learn");
    await markReviewed(queue[0]!);

    const reviewQueue = await provider.loadQueue("review");
    expect(reviewQueue).toHaveLength(1);
    expect(reviewQueue[0]!.item.id).toBe(queue[0]!.item.id);

    const learnQueue = await provider.loadQueue("learn");
    expect(learnQueue).toHaveLength(queue.length - 1);
    expect(learnQueue.some((entry) => entry.item.id === queue[0]!.item.id)).toBe(false);
  });

  it("混合模式：复习卡为主干，每 2 张穿插 1 张新词卡", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();
    const queue = await provider.loadQueue("learn");
    const [first, second] = queue;
    await markReviewed(first!);
    await markReviewed(second!);

    const mixed = await provider.loadQueue("mixed");
    // R R N N N ...（复习耗尽后按序补齐全部新词）
    expect(mixed[0]!.item.id).toBe(first!.item.id);
    expect(mixed[1]!.item.id).toBe(second!.item.id);
    expect(mixed.slice(2).map((card) => card.item.id)).toEqual(
      queue.slice(2).map((card) => card.item.id),
    );
    expect(mixed).toHaveLength(queue.length);
  });

  it("评分 again 后卡仍在短期学习回路，due 在未来 1 分钟附近", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();
    const card = (await provider.loadQueue("learn"))[0]!;
    const before = Date.now();

    await provider.grade(card, "again", { reviewDurationMs: 500, revealed: false });

    const memory = await db!.memoryStates.get(card.item.id);
    expect(memory?.fields.status).toBe("learning");
    const dueMs = Date.parse(memory!.fields.due);
    expect(dueMs).toBeGreaterThan(before);
    expect(dueMs).toBeLessThanOrEqual(before + 60_000 + 1_000);
  });

  it("不完整数据（缺义项/记忆状态）不入队，不抛错", async () => {
    // 直接塞一条只有 item、没有 sense 与 memoryState 的脏数据
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();
    const queue = await provider.loadQueue("learn");
    const victim = queue[0]!;
    await db!.transaction("rw", db!.senses, db!.memoryStates, async () => {
      await db!.senses.delete(victim.sense.id);
      await db!.memoryStates.delete(victim.memory.id);
    });

    const remaining = await provider.loadQueue("learn");
    expect(remaining).toHaveLength(queue.length - 1);
    expect(remaining.some((entry) => entry.item.id === victim.item.id)).toBe(false);
  });

  it("评分时记忆状态缺失则整体失败（core 原子性契约透传）", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();
    const card = (await provider.loadQueue("learn"))[0]!;
    await db!.memoryStates.delete(card.item.id);

    await expect(
      provider.grade(card, "easy", { reviewDurationMs: 1_000, revealed: true }),
    ).rejects.toThrow();
  });

  it("每日新卡上限：设置 5 时 learn 队列只取前 5 张新卡，review 不受影响（RAY-260 suggestion 2）", async () => {
    window.localStorage.setItem("lexilexi:daily-new-card-limit", "5");
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();

    const learnQueue = await provider.loadQueue("learn");
    expect(learnQueue).toHaveLength(5);
    // 复习队列不含新词，额度不影响
    expect(await provider.loadQueue("review")).toEqual([]);
  });

  it("loadQueueMeta：learn/mixed 返回剩余额度与未学新词标记，review 返回 null（RAY-276 诊断线 3）", async () => {
    window.localStorage.setItem("lexilexi:daily-new-card-limit", "5");
    const provider = createIndexedDbReviewDataProvider(db!);

    // 空库：没有未学新词，额度全额
    expect(await provider.loadQueueMeta!("learn")).toEqual({
      remainingNewCardQuota: 5,
      hasDueNewWords: false,
    });

    await provider.importSampleWordlist();
    expect(await provider.loadQueueMeta!("learn")).toEqual({
      remainingNewCardQuota: 5,
      hasDueNewWords: true,
    });
    expect(await provider.loadQueueMeta!("mixed")).toEqual({
      remainingNewCardQuota: 5,
      hasDueNewWords: true,
    });

    // 学满 5 张：额度耗尽、词库仍有未学新词（额度耗尽文案的触发条件）
    const first = (await provider.loadQueue("learn")).slice(0, 5);
    for (const card of first) {
      await provider.grade(card, "good", { reviewDurationMs: 1_000, revealed: true });
    }
    expect(await provider.loadQueueMeta!("learn")).toEqual({
      remainingNewCardQuota: 0,
      hasDueNewWords: true,
    });

    // review 模式不含新词：额度语义为 null
    expect(await provider.loadQueueMeta!("review")).toEqual({
      remainingNewCardQuota: null,
      hasDueNewWords: false,
    });
  });

  it("loadQueueMeta：剩余未学新词全部为暂停/删除条目时不报「仍有新词」（Oscar suggestion 2）", async () => {
    window.localStorage.setItem("lexilexi:daily-new-card-limit", "5");
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();

    // 学满额度 → 剩余新词均不可进入队列（额度耗尽场景）
    const first = (await provider.loadQueue("learn")).slice(0, 5);
    for (const card of first) {
      await provider.grade(card, "good", { reviewDurationMs: 1_000, revealed: true });
    }

    // 把全部剩余未学新词标记为暂停：与队列装配（只保留 active）同口径，
    // 此时不应再提示「剩余新词顺延到明天」
    const remainingNewStates = await db!.memoryStates
      .filter((state) => state.fields.reps === 0)
      .toArray();
    await db!.transaction("rw", db!.items, async () => {
      for (const state of remainingNewStates) {
        const item = await db!.items.get(state.itemId);
        if (item && item.status === "active") {
          await db!.items.put({
            ...item,
            status: "suspended",
            updatedAt: new Date().toISOString(),
          });
        }
      }
    });

    expect(await provider.loadQueueMeta!("learn")).toEqual({
      remainingNewCardQuota: 0,
      hasDueNewWords: false,
    });
  });

  it("每日新卡上限：今日已学词条数扣减额度（已学 2 张后剩余额度只补到上限）", async () => {
    window.localStorage.setItem("lexilexi:daily-new-card-limit", "5");
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();

    const first = (await provider.loadQueue("learn")).slice(0, 2);
    for (const card of first) {
      await provider.grade(card, "good", { reviewDurationMs: 1_000, revealed: true });
    }

    // 今日已学 2 张新卡 → 剩余额度 3
    const learnQueue = await provider.loadQueue("learn");
    expect(learnQueue).toHaveLength(3);
    const ids = new Set(learnQueue.map((card) => card.item.id));
    for (const card of first) {
      expect(ids.has(card.item.id)).toBe(false);
    }
  });

  it("每日新卡上限：昨日已学的词条今日复习不重复扣减今日额度（Oscar 复评 suggestion 1 语义回归）", async () => {
    window.localStorage.setItem("lexilexi:daily-new-card-limit", "5");
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();

    // 学习 a、b 两张新卡
    const [cardA, cardB] = (await provider.loadQueue("learn")).slice(0, 2);
    await provider.grade(cardA!, "good", { reviewDurationMs: 1_000, revealed: true });
    await provider.grade(cardB!, "good", { reviewDurationMs: 1_000, revealed: true });

    // 把 b 的首复习事件移到昨天：b 的「学习」不属于今天，今日已学只剩 a（1 张）
    const bReview = await db!.events
      .where("type")
      .equals("review")
      .and((event) => isReviewEvent(event) && event.itemId === cardB!.item.id)
      .first();
    expect(bReview).toBeDefined();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    await db!.events.put({ ...bReview!, time: yesterday });

    // 今日已学仅剩 a（1 张）→ 剩余额度 4；新词共 12 张，额度先耗尽 → 队列取 4 张
    const learnQueue = await provider.loadQueue("learn");
    expect(learnQueue).toHaveLength(4);
    const ids = new Set(learnQueue.map((card) => card.item.id));
    expect(ids.has(cardA!.item.id)).toBe(false);
    expect(ids.has(cardB!.item.id)).toBe(false);
  });
});

describe("标熟与单步撤销（RAY-265，数据源集成）", () => {
  it("标熟：记录 mastered 事件并按长间隔排期，词保留词书（条目状态不变）", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();
    const queue = await provider.loadQueue("learn");
    const card = queue[0]!;

    const result = await provider.markMastered(card, { reviewDurationMs: 1_000, revealed: false });

    expect(result.previousMemoryState.fields.reps).toBe(0);
    const event = await db!.events.get(result.reviewEventId);
    expect(event).toMatchObject({ type: "review", rating: "easy", mastered: true });

    const memory = await db!.memoryStates.get(card.item.id);
    expect(memory?.fields.lastRating).toBe("easy");
    expect(memory?.fields.status).toBe("review");
    // 词保留词书：条目未被剔除或挂起
    const item = await db!.items.get(card.item.id);
    expect(item?.status).toBe("active");
    // 长间隔：due 至少 1 天以后（easy 直接转复习）
    expect(Date.parse(memory!.fields.due)).toBeGreaterThan(Date.now() + 24 * 60 * 60 * 1000);
  });

  it("撤销：删除事件并恢复评分前状态，队列与评分前一致", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();
    const queue = await provider.loadQueue("learn");
    const card = queue[0]!;

    const result = await provider.grade(card, "good", { reviewDurationMs: 1_000, revealed: false });
    expect(await db!.events.where("type").equals("review").count()).toBe(1);

    await provider.undoGrade(card.item.id, result.reviewEventId, result.previousMemoryState);

    expect(await db!.events.where("type").equals("review").count()).toBe(0);
    const memory = await db!.memoryStates.get(card.item.id);
    expect(memory?.fields).toEqual(result.previousMemoryState.fields);
    // 回到学习队列（与评分前一致）
    const learnQueue = await provider.loadQueue("learn");
    expect(learnQueue.some((entry) => entry.item.id === card.item.id)).toBe(true);
  });
});

describe("选择题出题方向（RAY-293，数据源集成）", () => {
  it("默认英译中：每道题 direction=en-zh，正确选项为主释义", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();

    const { questions, cards } = await provider.loadMultipleChoiceQueue("learn");
    expect(questions.length).toBeGreaterThan(0);
    expect(questions).toHaveLength(cards.length);
    for (const question of questions) {
      expect(question.direction).toBe("en-zh");
      const correct = question.options.find((option) => option.isCorrect);
      expect(correct?.text).toBe(question.sense.definitions[0]);
    }
  });

  it("设置中译英后：每道题 direction=zh-en，正确选项为词条原文、混淆项均为英文词条", async () => {
    window.localStorage.setItem("lexilexi:quiz-direction", "zh-en");
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();

    const { questions, cards } = await provider.loadMultipleChoiceQueue("learn");
    expect(questions.length).toBeGreaterThan(0);
    expect(questions).toHaveLength(cards.length);
    for (const question of questions) {
      expect(question.direction).toBe("zh-en");
      const correct = question.options.find((option) => option.isCorrect);
      expect(correct?.text).toBe(question.sense.term);
      // 中译英的选项全部是词条原文（示例词表为纯小写英文词）
      expect(question.options.every((option) => /^[a-z]+$/.test(option.text))).toBe(true);
    }
  });

  it("混合模式：每道题方向在 {en-zh, zh-en} 内且与选项文本口径一致", async () => {
    window.localStorage.setItem("lexilexi:quiz-direction", "mixed");
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();

    const { questions } = await provider.loadMultipleChoiceQueue("learn");
    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      expect(["en-zh", "zh-en"]).toContain(question.direction);
      const correct = question.options.find((option) => option.isCorrect);
      if (question.direction === "zh-en") {
        expect(correct?.text).toBe(question.sense.term);
      } else {
        expect(correct?.text).toBe(question.sense.definitions[0]);
      }
    }
  });

  it("损坏的方向设置值回落默认英译中（不出错、不出 zh-en 题）", async () => {
    window.localStorage.setItem("lexilexi:quiz-direction", "garbage");
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();

    const { questions } = await provider.loadMultipleChoiceQueue("learn");
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.every((question) => question.direction === "en-zh")).toBe(true);
  });
});

describe("保底填充 + 极端兜底跳题（RAY-293 修正决策，数据源集成）", () => {
  // 3 词小词库：任意两个词编辑距离 > 3，常错词为空 → 每题 1 正确 + 2 随机
  // 干扰 = 3 选项，保底填充池也只剩已入池的词 → 凑不够 MIN_QUIZ_OPTION_COUNT，
  // 属「连保底填充都凑不够」的极端情形，整轮跳题。
  const CSV_3_WORDS = "term,definition,pos\napple,苹果,n.\nbanana,香蕉,n.\ncherry,樱桃,n.";
  // 4 词词库：每词有 3 个随机干扰候选 → 恰好 4 选项，全部照常出题。
  const CSV_4_WORDS = `${CSV_3_WORDS}\ndonut,甜甜圈,n.`;

  it("3 词词库在英译中 / 中译英 / 混合三档设置下均整轮跳题（questions/cards 皆空）", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await importCsvWordlist(db!, CSV_3_WORDS, { source: "测试" });

    for (const preference of ["en-zh", "zh-en", "mixed"]) {
      window.localStorage.setItem("lexilexi:quiz-direction", preference);
      const { questions, cards } = await provider.loadMultipleChoiceQueue("learn");
      expect(questions).toHaveLength(0);
      expect(cards).toHaveLength(0);
    }
  });

  it("极端跳题不影响学习队列本身（卡片队列仍含全部 3 词）", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await importCsvWordlist(db!, CSV_3_WORDS, { source: "测试" });

    const { questions, cards } = await provider.loadMultipleChoiceQueue("learn");
    expect(questions).toHaveLength(0);
    expect(cards).toHaveLength(0);
    // 跳题只是不出选择题；卡片模式学习队列照常可用
    const learnQueue = await provider.loadQueue("learn");
    expect(learnQueue).toHaveLength(3);
  });

  it("4 词词库候选充足：4 题全出且每题恰好 4 选项（随机回退补齐）", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await importCsvWordlist(db!, CSV_4_WORDS, { source: "测试" });

    const { questions, cards } = await provider.loadMultipleChoiceQueue("learn");
    expect(questions).toHaveLength(4);
    expect(cards).toHaveLength(4);
    for (const question of questions) {
      expect(question.options).toHaveLength(4);
      expect(question.options.filter((option) => option.isCorrect)).toHaveLength(1);
    }
  });

  it("保底填充：三级回退不足时从剩余词条补齐（含同义词条），该题照常出题", async () => {
    // 4 词词库（含同义词条 forsake）：三级回退剔除同义词条后 abandon 只有
    // band(形近) + ban(随机) 两个干扰项，保底填充补入 forsake 凑满 4 选项。
    const target = makeSense({ term: "abandon", definitions: ["放弃"], synonyms: ["forsake"] });
    const synSense = makeSense({ term: "forsake", definitions: ["遗弃"] });
    const bandSense = makeSense({ term: "band", definitions: ["乐队"] });
    const banSense = makeSense({ term: "ban", definitions: ["禁令"] });
    for (const sense of [target, synSense, bandSense, banSense]) {
      const item = makeItem(sense.id);
      await db!.senses.put(sense);
      await db!.items.put(item);
      await db!.memoryStates.put(makeMemory(item.id));
    }
    window.localStorage.setItem("lexilexi:quiz-direction", "zh-en");

    const provider = createIndexedDbReviewDataProvider(db!);
    const { questions, cards } = await provider.loadMultipleChoiceQueue("learn");
    // 每个词都会被出题——不会被「永远跳过」
    expect(questions).toHaveLength(4);
    expect(cards).toHaveLength(4);
    const abandonQuestion = questions.find((question) =>
      question.options.some((option) => option.isCorrect && option.text === "abandon"),
    );
    expect(abandonQuestion).toBeDefined();
    expect(abandonQuestion!.options).toHaveLength(4);
    // 同义词条经保底填充层进入选项（仅排除目标词本身，不再剔除同义词条）
    expect(abandonQuestion!.options.some((option) => option.text === "forsake")).toBe(true);
  });

  it("示例词表（14 词）不触发跳题：questions 与 cards 一一对应", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();

    const { questions, cards } = await provider.loadMultipleChoiceQueue("learn");
    expect(questions.length).toBeGreaterThan(0);
    expect(questions).toHaveLength(cards.length);
    expect(questions.every((question) => question.options.length >= 4)).toBe(true);
  });

  it("无释义义项（没有任何正确项）同样跳题", async () => {
    // 直接落一条 definitions 为空的义项：卡片模式队列会带上它（完整性校验
    // 不查释义），但选择题没有正确项可出，必须跳题。
    const sense = makeSense({ term: "nodef", definitions: [] });
    const item = makeItem(sense.id);
    const memory = makeMemory(item.id);
    await db!.senses.put(sense);
    await db!.items.put(item);
    await db!.memoryStates.put(memory);

    const provider = createIndexedDbReviewDataProvider(db!);
    const learnQueue = await provider.loadQueue("learn");
    expect(learnQueue.some((card) => card.item.id === item.id)).toBe(true);

    const { questions, cards } = await provider.loadMultipleChoiceQueue("learn");
    expect(questions).toHaveLength(0);
    expect(cards).toHaveLength(0);
  });
});

describe("生词本开关（RAY-284，数据源集成）", () => {
  it("开关关闭（localStorage 0）时：生词本条目从学习队列排除，词书条目保留", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    const imported = await provider.importSampleWordlist();
    expect(imported).toBe(SAMPLE_WORDLIST_ROW_COUNT);

    // 从示例词表中取第一个义项加入生词本（独立调度实例）
    const learnQueue = await provider.loadQueue("learn");
    const firstCard = learnQueue[0];
    if (!firstCard) {
      throw new Error("学习队列应非空");
    }
    await provider.addToNotebook(firstCard.sense.id);

    // 默认（未设置偏好）：生词本条目包含在学习队列中
    const withNotebook = await provider.loadQueue("learn");
    expect(withNotebook).toHaveLength(SAMPLE_WORDLIST_ROW_COUNT + 1);

    // 关闭开关：生词本条目排除，回到示例词表规模
    window.localStorage.setItem("lexilexi:include-notebook", "0");
    const withoutNotebook = await provider.loadQueue("learn");
    expect(withoutNotebook).toHaveLength(SAMPLE_WORDLIST_ROW_COUNT);
    // 生词本条目的独立实例不在队列中
    const notebookItemIds = new Set(
      (await db!.notebookEntries.where("status").equals("active").toArray()).map(
        (entry) => entry.itemId,
      ),
    );
    for (const card of withoutNotebook) {
      expect(notebookItemIds.has(card.item.id)).toBe(false);
    }
    // 词书条目仍全部在列
    expect(withoutNotebook.filter((card) => !notebookItemIds.has(card.item.id))).toHaveLength(
      SAMPLE_WORDLIST_ROW_COUNT,
    );
  });

  it("addToNotebook 幂等：重复加同一义项返回 already", async () => {
    const provider = createIndexedDbReviewDataProvider(db!);
    await provider.importSampleWordlist();
    const learnQueue = await provider.loadQueue("learn");
    const card = learnQueue[0];
    if (!card) {
      throw new Error("学习队列应非空");
    }

    expect(await provider.addToNotebook(card.sense.id)).toBe("added");
    expect(await provider.addToNotebook(card.sense.id)).toBe("already");
    expect(await db!.notebookEntries.count()).toBe(1);
  });
});
