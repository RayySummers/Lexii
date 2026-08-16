/**
 * 选择题混淆项生成（纯函数，无 React / DB 依赖）。
 *
 * 混淆项来源（Jack 拍板口径，RAY-269 立项 + RAY-293 后续修复）：
 * 1. 用户历史常错词——记忆状态中 lapses > 0 的条目定义
 * 2. 本地词库形近词——编辑距离最近的词条定义
 * 3. 随机回退——词库中随机取定义兜底
 *
 * 剔除规则（RAY-293 后续修复，Jack 裁定「剔除」方案）：与目标词同义的
 * 词条不进该题混淆池——同义选项「语义上也说得通」被判错属质量缺口。
 * 同义词条从全部来源（常错词 / 形近词 / 随机）剔除，覆盖英译中 +
 * 中译英两个方向；不采用「同义判对」（同义/近义边界模糊，会稀释记忆精度）。
 *
 * 隐私红线：全部基于本地数据，无跨用户统计。
 */
import type { Sense } from "./domain";

/** 选择题的一个选项 */
export interface DistractorOption {
  /** 选项文本（一条释义或一个词条原文，取决于出题方向） */
  text: string;
  /** 是否为正确答案 */
  isCorrect: boolean;
  /** 来源标识（调试 / 可选展示） */
  source: "correct" | "wrong-history" | "similar-spelling" | "random";
}

/**
 * 选择题出题方向（RAY-293）：
 * - `en-zh`（英译中）：题面词条原文 → 选项释义（原有行为）
 * - `zh-en`（中译英）：题面主释义 → 选项词条原文
 *
 * 方向只改变题目呈现，不改变评分与 FSRS 调度（见 docs/quiz-fsrs-mapping.md）。
 */
export type QuizDirection = "en-zh" | "zh-en";

/** 选项文本提取器：英译中取主释义，中译英取词条原文 */
type TextExtractor = (sense: Sense) => string;

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
 * 英译中方向（RAY-269 既有行为）：正确项为主释义，混淆项为其他义项的主释义。
 * 与目标词同义的词条不进混淆池（RAY-293 后续修复，见文件头说明）。
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
  return buildOptions(
    targetSense,
    allSenses,
    wrongTerms,
    optionCount,
    (sense) => sense.definitions[0] ?? "",
  );
}

/**
 * 为一道中译英选择题生成选项（1 正确 + N-1 混淆），RAY-293。
 *
 * 正确项为目标词条原文，混淆项为其他词条的原文。混淆项来源口径与
 * `generateOptions` 完全一致（历史常错词 / 形近词 / 随机回退，同义词条
 * 剔除），仅选项文本从「主释义」换成「词条原文」。
 *
 * @param targetSense  当前考查的义项
 * @param allSenses    词库中所有义项（用于形近词和随机回退）
 * @param wrongTerms   用户历史常错词的 term 列表（lapses > 0 的条目）
 * @param optionCount  选项总数（默认 4）
 */
export function generateTermOptions(
  targetSense: Sense,
  allSenses: readonly Sense[],
  wrongTerms: readonly string[],
  optionCount = 4,
): DistractorOption[] {
  return buildOptions(targetSense, allSenses, wrongTerms, optionCount, (sense) => sense.term);
}

/** 选项生成管线（两方向共用）：正确项 + 常错词/形近词池 + 随机回退，最后洗牌 */
function buildOptions(
  targetSense: Sense,
  allSenses: readonly Sense[],
  wrongTerms: readonly string[],
  optionCount: number,
  extract: TextExtractor,
): DistractorOption[] {
  const distractorCount = optionCount - 1;
  const correctText = extract(targetSense);
  if (!correctText) {
    // 防御：无文本可出的义项无法出题，全部用占位
    return Array.from({ length: optionCount }, () => ({
      text: "（无释义）",
      isCorrect: false,
      source: "random" as const,
    }));
  }

  // 同义词条剔除（RAY-293 后续修复）：双向口径——目标词的 synonyms 字段
  // 命中的词条、或自身 synonyms 含目标词的词条，都不进该题混淆池。
  const excluded = synonymExcludedTerms(targetSense, allSenses);

  const used = new Set<string>([correctText]);
  const distractors: DistractorOption[] = [];

  // 1. 历史常错词定义
  addFromPool(
    distractors,
    used,
    wrongDefs(allSenses, wrongTerms, excluded, extract),
    "wrong-history",
    distractorCount,
  );

  // 2. 形近词定义
  if (distractors.length < distractorCount) {
    addFromPool(
      distractors,
      used,
      similarDefs(targetSense, allSenses, excluded, extract),
      "similar-spelling",
      distractorCount,
    );
  }

  // 3. 随机回退
  if (distractors.length < distractorCount) {
    addFromPool(
      distractors,
      used,
      randomDefs(allSenses, excluded, extract),
      "random",
      distractorCount,
    );
  }

  const options: DistractorOption[] = [
    { text: correctText, isCorrect: true, source: "correct" },
    ...distractors,
  ];
  return shuffle(options);
}

/**
 * 该题目标的同义词条集合（小写 term，双向口径）：
 * - `target.synonyms` 中的每个词（同义词声明在目标侧）；
 * - 词库中 `synonyms` 字段包含目标 term 的词条（同义词声明在另一侧）。
 */
function synonymExcludedTerms(target: Sense, allSenses: readonly Sense[]): ReadonlySet<string> {
  const excluded = new Set<string>();
  if (target.synonyms) {
    for (const synonym of target.synonyms) {
      excluded.add(synonym.toLowerCase());
    }
  }
  const targetTerm = target.term.toLowerCase();
  for (const sense of allSenses) {
    if (sense.id === target.id || !sense.synonyms) {
      continue;
    }
    if (sense.synonyms.some((synonym) => synonym.toLowerCase() === targetTerm)) {
      excluded.add(sense.term.toLowerCase());
    }
  }
  return excluded;
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

/** 历史常错词的主释义列表（同义词条剔除） */
function wrongDefs(
  allSenses: readonly Sense[],
  wrongTerms: readonly string[],
  excluded: ReadonlySet<string>,
  extract: TextExtractor,
): string[] {
  const wrongSet = new Set(wrongTerms.map((term) => term.toLowerCase()));
  const result: string[] = [];
  for (const sense of allSenses) {
    const termKey = sense.term.toLowerCase();
    if (wrongSet.has(termKey) && !excluded.has(termKey)) {
      const text = extract(sense);
      if (text) {
        result.push(text);
      }
    }
  }
  return result;
}

/** 形近词主释义（按编辑距离排序，取最近的前 10 个；同义词条剔除） */
function similarDefs(
  target: Sense,
  allSenses: readonly Sense[],
  excluded: ReadonlySet<string>,
  extract: TextExtractor,
): string[] {
  const term = target.term.toLowerCase();
  const scored: Array<{ dist: number; def: string }> = [];
  for (const sense of allSenses) {
    if (sense.id === target.id) {
      continue;
    }
    const termKey = sense.term.toLowerCase();
    if (excluded.has(termKey)) {
      continue;
    }
    const dist = editDistance(term, termKey);
    if (dist > 0 && dist <= 3) {
      const text = extract(sense);
      if (text) {
        scored.push({ dist, def: text });
      }
    }
  }
  scored.sort((a, b) => a.dist - b.dist);
  return scored.slice(0, 10).map((s) => s.def);
}

/** 词库中随机取主释义（兜底；同义词条剔除） */
function randomDefs(
  allSenses: readonly Sense[],
  excluded: ReadonlySet<string>,
  extract: TextExtractor,
): string[] {
  const defs: string[] = [];
  for (const sense of allSenses) {
    if (excluded.has(sense.term.toLowerCase())) {
      continue;
    }
    const text = extract(sense);
    if (text) {
      defs.push(text);
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
