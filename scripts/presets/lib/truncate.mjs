/**
 * 富化包文本截断工具（RAY-344 起抽离为共享模块，RAY-365 修复括号截断）。
 *
 * 历史背景：truncateText / truncateAtBoundary / trimWordPartsNote 三个函数
 * 最初在 `scripts/presets/build-enrichment.mjs` 内联定义，RAY-344 把
 * wordPartsNote 上限 8 → 32 字、etymologyZh 64 → 384 字时同步修了一次；
 * 一次性回填脚本 `backfill/ray344.mjs` 因需要同样的口径复制粘贴了一份，
 * Oscar 评审指出两份副本容易在后续口径调整时漏改一处，故统一抽到本
 * 模块（build-enrichment.mjs + backfill/ray344.mjs 都从这里 import）。
 *
 * RAY-365（P0 截断根因）：
 * 32 字上限下 309 条 wordParts 注释仍以「只有左括号无右括号」收尾
 * （如 `able<能够的（拉丁语 habilis（易掌握的）>`），原 truncateAtBoundary
 * 仅在最后一个 `）` 切断，嵌套结构下会导致外层 `（` 未闭合。实测 p99=31
 * 但仍有 2.5% 词条触界（候选边界落在内层 `）`）。本版本增加括号平衡感知：
 * 优先选用平衡的句子边界，硬切后自动补全缺失的右括号，彻底消除左括号残段。
 *
 * 已修复：候选需 balanced + 硬切 ensureBalanced（RAY-365），保留 p95/p99 背景：
 * OE 源内 wordParts 注释长度 p95=24/p99=31，32 字上限下 `notesGt32≈0` 但嵌套
 * 括号导致的平衡失效仍有 309 例，64 字上限 + 平衡感知后 `fullDepth==0`。
 *
 * 调整本模块任一函数后，**两处调用方都会自动同步**；否则回填产物会与
 * 正式构建产物口径不一致（RAY-344 沉淀经验）。
 */

/** 枚举列表标记 `1) ` / `2) ` 等（半角 `)` 枚举，非括号），需在括号平衡计数时忽略 */
export const ENUM_LIST_RE = /(^|\s)\d+\)\s/g;

/** 按 Unicode 码点截断（中文按字计，避免代理对截半） */
export function truncateText(text, maxChars) {
  if ([...text].length <= maxChars) {
    return text;
  }
  return [...text].slice(0, maxChars).join("");
}

/**
 * 计算全角/半角括号深度（RAY-365：忽略枚举 `1) ` / `2) ` / `10) ` 中的 `)`，如 keen 的 `1) 物理层面的...`）。
 * 枚举正则与 `enrichmentTier0.test` 共用 `ENUM_LIST_RE`，避免两处漂移。
 * @returns {{full:number, half:number}} full = （/）, half = (/ )
 */
function bracketDepth(text) {
  // 去掉枚举标记后再计数，避免 `1) ` 被误判为不平衡的半角括号
  const normalized = text.replace(ENUM_LIST_RE, "$1");
  let full = 0;
  let half = 0;
  for (const ch of normalized) {
    if (ch === "（") full += 1;
    else if (ch === "）") full -= 1;
    else if (ch === "(") half += 1;
    else if (ch === ")") half -= 1;
  }
  return { full, half };
}

/** 括号是否平衡（且无中途负深度；同样忽略枚举 `1) ` / `2) ` / `10) `） */
function isBalanced(text) {
  const normalized = text.replace(ENUM_LIST_RE, "$1");
  let full = 0;
  let half = 0;
  for (const ch of normalized) {
    if (ch === "（") full += 1;
    else if (ch === "）") {
      full -= 1;
      if (full < 0) return false;
    } else if (ch === "(") half += 1;
    else if (ch === ")") {
      half -= 1;
      if (half < 0) return false;
    }
  }
  return full === 0 && half === 0;
}

/**
 * 硬切后的括号平衡修复（RAY-365）：
 * - 去掉悬空的左括号收尾（`（` / `(`）
 * - 去掉截在枚举逗号上的残段（`、` / `，` / `,` 在未闭合括号内时）
 * - 补全缺失的右括号
 */
function ensureBalanced(text) {
  let t = text;
  // 去掉末尾悬空的左括号（常见于 8 字截断残段 `坐（拉丁语 se`，32 字下仍有 2 例）
  while (t.endsWith("（") || t.endsWith("(")) {
    t = t.slice(0, -1);
  }
  const { full, half } = bracketDepth(t);
  // 截在枚举逗号上的残段：`（外部、` + `）` → `（外部、）` 不自然，删掉末尾逗号再闭合更干净
  if ((full > 0 || half > 0) && (t.endsWith("、") || t.endsWith("，") || t.endsWith(","))) {
    // 仅当逗号处在未闭合括号内时才视为残段（常见于 OE 注释列举被切断）
    t = t.slice(0, -1);
  }
  const afterDepth = bracketDepth(t);
  let result = t;
  if (afterDepth.full > 0) result += "）".repeat(afterDepth.full);
  if (afterDepth.half > 0) result += ")".repeat(afterDepth.half);
  // 异常：右括号多于左括号（不应由截断产生，防御性修掉多余的尾部右括号）
  let depthCheck = bracketDepth(result);
  while (depthCheck.full < 0 && result.endsWith("）")) {
    result = result.slice(0, -1);
    depthCheck = bracketDepth(result);
  }
  while (depthCheck.half < 0 && result.endsWith(")")) {
    result = result.slice(0, -1);
    depthCheck = bracketDepth(result);
  }
  return result;
}

/**
 * sentence-boundary 截断（RAY-344，RAY-365 增加括号平衡感知）：
 * 优先在 budget 内最后一个句子边界切断，避免「。前半句」/「sed 半截词」之
 * 类的视觉残段；无合适边界时降级为硬切（保留前 maxChars 字）。
 * RAY-365 新增：候选边界必须括号平衡，否则视为无效；硬切后自动补全括号。
 *
 * @param text 待截断文本
 * @param maxChars 上限（Unicode 码点）
 * @param kind "zh" | "en" — 中文优先在 。！？ 切，英文优先在 ". " / "? " / "! " 切
 * @returns 截断后的文本（含末尾标点，已保证括号平衡）
 */
export function truncateAtBoundary(text, maxChars, kind) {
  if ([...text].length <= maxChars) {
    return text;
  }
  const slice = [...text].slice(0, maxChars).join("");
  const candidates = kind === "zh" ? ["。", "！", "？", "」", "）"] : [". ", "? ", "! "];
  // 收集所有候选位置，按从后往前排序，优先取平衡的
  const allCandidates = [];
  for (const p of candidates) {
    let idx = slice.lastIndexOf(p);
    while (idx >= 0) {
      if (idx >= Math.floor(maxChars * 0.6)) {
        allCandidates.push({ idx, len: p.length, marker: p });
      }
      idx = slice.lastIndexOf(p, idx - 1);
    }
  }
  allCandidates.sort((a, b) => b.idx - a.idx);
  for (const cand of allCandidates) {
    const candText = slice.slice(0, cand.idx + cand.len);
    if (isBalanced(candText)) {
      return candText;
    }
  }
  // 无平衡候选：取最远的候选（原 RAY-344 行为）并做平衡修复
  if (allCandidates.length > 0) {
    const best = allCandidates[0];
    const candText = slice.slice(0, best.idx + best.len);
    return ensureBalanced(candText);
  }
  // 完全无句子边界：硬切并平衡
  return ensureBalanced(slice);
}

/** wordParts 词缀注释截断（词根词缀名保留，注释限 maxNote 字，优先段内完整注释） */
export function trimWordPartsNote(wordParts, maxNote) {
  if (!wordParts) {
    return "";
  }
  return wordParts
    .split(" · ")
    .map((part) => {
      const match = part.match(/^(.*?)<([^>]*)>$/);
      if (!match) {
        return part;
      }
      const head = match[1];
      const note = match[2];
      // 优先在中文标点 / 全角括号边界切断（OpenEtymology 注释常见「（拉丁语 xxx）」
      // 结构，硬切在 32 字内常把外层全角括号切断）—— RAY-365 追加括号平衡感知
      const trimmed = truncateAtBoundary(note, maxNote, "zh");
      const balanced = ensureBalanced(trimmed);
      return `${head}<${balanced}>`;
    })
    .join(" · ");
}

// 导出平衡工具供单测/数据修复脚本复用（非公开 API，但测试与回填需要）
export const __testOnly = { isBalanced, ensureBalanced, bracketDepth };
