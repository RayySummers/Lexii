/**
 * 选择题混淆项生成（纯函数，无 React / DB 依赖）。
 *
 * 混淆项三类来源（Jack 拍板口径，RAY-269）：
 * 1. 用户历史常错词——记忆状态中 lapses > 0 的条目定义
 * 2. 本地词库形近词——编辑距离最近的词条定义
 * 3. 近义词——Sense.synonyms 字段
 *
 * 隐私红线：全部基于本地数据，无跨用户统计。
 */
import type { Sense } from "./domain";

/** 选择题的一个选项 */
export interface DistractorOption {
  /** 选项文本（一条释义） */
  text: string;
  /** 是否为正确答案 */
  isCorrect: boolean;
  /** 来源标识（调试 / 可选展示） */
  source: "correct" | "wrong-history" | "similar-spelling" | "synonym" | "random";
}

/**
 * Levenshtein 编辑距离（动态规划，O(mn)）。
 *
 * 纯函数，用于筛选形近词混淆项。词库规模（数千条）下性能足够；
 * 若未来词库膨胀到十万级，可换 BK-tree 索引。
 */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // 单行优化：只需前一行和当前行
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr: number[] = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr.push(Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost));
    }
    prev = curr;
  }
  return prev[n]!;
}

/** Fisher-Yates 洗牌（原地，返回同一引用） */
function shuffle<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j]!, array[i]!];
  }
  return array;
}

/**
 * 为一道选择题生成选项（1 正确 + N-1 混淆）。
 *
 * @param targetSense  当前考查的义项
 * @param allSenses    词库中所有义项（用于形近词和随机回退）
 * @param wrongTerms   用户历史常错词的 term 列表（lapses > 0 的条目）
 * @param optionCount  选项总数（默认 4）
 */
export function generateOptions(
  targetSense: Sense,
  allSenses: readonly Sense[],
  wrongTerms: readonly string[],
  optionCount = 4,
): DistractorOption[] {
  const distractorCount = optionCount - 1;
  const correctText = targetSense.definitions[0];
  if (!correctText) {
    // 防御：无释义的义项无法出题，全部用占位
    return Array.from({ length: optionCount }, () => ({
      text: "（无释义）",
      isCorrect: false,
      source: "random" as const,
    }));
  }

  const used = new Set<string>([correctText]);
  const distractors: DistractorOption[] = [];

  // 1. 历史常错词定义
  addFromPool(
    distractors,
    used,
    wrongDefs(allSenses, wrongTerms),
    "wrong-history",
    distractorCount,
  );

  // 2. 形近词定义
  if (distractors.length < distractorCount) {
    addFromPool(
      distractors,
      used,
      similarDefs(targetSense, allSenses),
      "similar-spelling",
      distractorCount,
    );
  }

  // 3. 近义词定义
  if (distractors.length < distractorCount) {
    addFromPool(distractors, used, synonymDefs(targetSense, allSenses), "synonym", distractorCount);
  }

  // 4. 随机回退
  if (distractors.length < distractorCount) {
    addFromPool(distractors, used, randomDefs(allSenses), "random", distractorCount);
  }

  const options: DistractorOption[] = [
    { text: correctText, isCorrect: true, source: "correct" },
    ...distractors,
  ];
  return shuffle(options);
}

/** 从候选池中取未使用的定义，直到填满 */
function addFromPool(
  target: DistractorOption[],
  used: Set<string>,
  candidates: string[],
  source: DistractorOption["source"],
  limit: number,
): void {
  for (const text of candidates) {
    if (target.length >= limit) {
      break;
    }
    if (used.has(text)) {
      continue;
    }
    used.add(text);
    target.push({ text, isCorrect: false, source });
  }
}

/** 历史常错词的主释义列表 */
function wrongDefs(allSenses: readonly Sense[], wrongTerms: readonly string[]): string[] {
  const wrongSet = new Set(wrongTerms);
  const result: string[] = [];
  for (const sense of allSenses) {
    if (wrongSet.has(sense.term) && sense.definitions[0]) {
      result.push(sense.definitions[0]);
    }
  }
  return result;
}

/** 形近词主释义（按编辑距离排序，取最近的前 10 个） */
function similarDefs(target: Sense, allSenses: readonly Sense[]): string[] {
  const term = target.term.toLowerCase();
  const scored: Array<{ dist: number; def: string }> = [];
  for (const sense of allSenses) {
    if (sense.id === target.id) {
      continue;
    }
    const dist = editDistance(term, sense.term.toLowerCase());
    if (dist > 0 && dist <= 3 && sense.definitions[0]) {
      scored.push({ dist, def: sense.definitions[0] });
    }
  }
  scored.sort((a, b) => a.dist - b.dist);
  return scored.slice(0, 10).map((s) => s.def);
}

/** 近义词在词库中的主释义 */
function synonymDefs(target: Sense, allSenses: readonly Sense[]): string[] {
  const synonyms = target.synonyms;
  if (!synonyms || synonyms.length === 0) {
    return [];
  }
  const synSet = new Set(synonyms.map((s) => s.toLowerCase()));
  const result: string[] = [];
  for (const sense of allSenses) {
    if (sense.id === target.id) {
      continue;
    }
    if (synSet.has(sense.term.toLowerCase()) && sense.definitions[0]) {
      result.push(sense.definitions[0]);
    }
  }
  return result;
}

/** 词库中随机取主释义（兜底） */
function randomDefs(allSenses: readonly Sense[]): string[] {
  const defs: string[] = [];
  for (const sense of allSenses) {
    if (sense.definitions[0]) {
      defs.push(sense.definitions[0]);
    }
  }
  // 简单随机排序（不修改原数组）
  const shuffled = [...defs];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}
