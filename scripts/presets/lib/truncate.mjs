/**
 * 富化包文本截断工具（RAY-344 起抽离为共享模块）。
 *
 * 历史背景：truncateText / truncateAtBoundary / trimWordPartsNote 三个函数
 * 最初在 `scripts/presets/build-enrichment.mjs` 内联定义，RAY-344 把
 * wordPartsNote 上限 8 → 32 字、etymologyZh 64 → 384 字时同步修了一次；
 * 一次性回填脚本 `backfill/ray344.mjs` 因需要同样的口径复制粘贴了一份，
 * Oscar 评审指出两份副本容易在后续口径调整时漏改一处，故统一抽到本
 * 模块（build-enrichment.mjs + backfill/ray344.mjs 都从这里 import）。
 *
 * 调整本模块任一函数后，**两处调用方都会自动同步**；否则回填产物会与
 * 正式构建产物口径不一致（RAY-344 沉淀经验）。
 */

/** 按 Unicode 码点截断（中文按字计，避免代理对截半） */
export function truncateText(text, maxChars) {
  if (text.length <= maxChars) {
    return text;
  }
  return [...text].slice(0, maxChars).join("");
}

/**
 * sentence-boundary 截断（RAY-344）：
 * 优先在 budget 内最后一个句子边界切断，避免「。前半句」/「sed 半截词」之
 * 类的视觉残段；无合适边界时降级为硬切（保留前 maxChars 字）。
 *
 * @param text 待截断文本
 * @param maxChars 上限（Unicode 码点）
 * @param kind "zh" | "en" — 中文优先在 。！？ 切，英文优先在 ". " / "? " / "! " 切
 * @returns 截断后的文本（含末尾标点）
 *
 * 已知边界（Oscar nit #3）：
 * zh 候选包含 `）`，在嵌套全角括号场景下（如 `坐（拉丁语 sedere（坐））`）
 * 在最后一个 `）` 切断可能留下未闭合的外层 `（`。当前 OE 源内 wordParts
 * 注释长度 p95=24/p99=31，32 字上限下没有词条真的触到这条边界（实测
 * `notesGt32 = 0`），所以暂未触发；后续若扩到 64+ 字或换数据源需要重新
 * 评估（可改成「外层 `）` 优先」或加 paren-depth 跟踪）。
 */
export function truncateAtBoundary(text, maxChars, kind) {
  if (text.length <= maxChars) {
    return text;
  }
  const slice = [...text].slice(0, maxChars).join("");
  const candidates = kind === "zh" ? ["。", "！", "？", "」", "）"] : [". ", "? ", "! "];
  let bestIdx = -1;
  let bestLen = 0;
  for (const p of candidates) {
    const idx = slice.lastIndexOf(p);
    // 太靠近起点（< 60% budget）视为「退而求其次」，只在前一候选无解时接受
    if (idx > bestIdx && idx >= Math.floor(maxChars * 0.6)) {
      bestIdx = idx;
      bestLen = p.length;
    }
  }
  if (bestIdx >= 0) {
    return slice.slice(0, bestIdx + bestLen);
  }
  return slice;
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
      // 结构，硬切在 32 字内常把外层全角括号切断）
      const trimmed = truncateAtBoundary(note, maxNote, "zh");
      return `${head}<${trimmed}>`;
    })
    .join(" · ");
}
