/**
 * 「著」/「妳」分类器（RAY-338 第三轮，词级白名单 + 字符邻居 + 动词前缀三重校验）。
 *
 * 历史：
 *   - 第一轮（commit 06beff3）仅用 `t2s`，漏检「著(zhe)」「妳」。
 *   - 第二轮（commit 22c63f8）改为 KEEP_PRE/KEEP_POST 字符邻居规则，
 *     修好 147+4=155 处，但仍有 2 处边界误判：
 *       1. 「土著」未在 KEEP 集 → 被误转为「土着」（goddess，新引入错字）
 *       2. 「意味著作」中后随字「作」∈ KEEP_POST → 误保留（speaker）
 *   - 第三轮（本轮）升级为**词级白名单 + 字符邻居兜底 + 动词前缀触发**三重校验：
 *       - 词级白名单：显式枚举所有合法简化词（白名单命中 → keep）
 *       - KEEP_PRE + KEEP_POST 字符邻居兜底（命中 → keep）
 *       - VERB_PREFIXES_BEFORE_ZHU：表示「<verb>+著(zhe)+<verb>X」pattern 的2字动词
 *         （命中 + 后面是 KEEP_POST → 强行 convert，覆盖白名单）
 *
 * 关联：
 *   - `scripts/presets/scan_traditional.mjs`：检测入口（CI 集成）
 *   - `scripts/presets/unify_traditional.mjs`：替换入口（一次性补丁）
 *   - `packages/core/src/presets/toSimplified.test.ts`：t2s 转换器口径回归
 *
 * 回归用例（不可破坏，本轮 2 句）：
 *   - `goddess`：「土著」必须保留（KEEP_PRE 补「土」）
 *   - `speaker`：「意味著作」必须替换为「意味着作」（VERB_PREFIXES 含「意味」）
 *
 * 用法：
 *   import { isKeptZhù, scanTraditional, selfTest } from "./lib/traditional-classify.mjs";
 *   if (!isKeptZhù(text, i)) { convertAt(i); }
 */

const ZH = "著";
const KRU = "妳";
const YOU_HAN = "你";

/**
 * 词级白名单：所有含「著」字符的合法简体词。
 * 来源：
 *   - Vega 提供的命中清单（著作/著名/显著/卓著/昭著/原著/译著/专著/编著/...）
 *   - Oscar 第二轮评审补充（土著）
 *   - 第二轮 32 处现存「著」逐一 audit（确保不漏）
 *   - 常见 zhù 词（著录/著述/著书/著说/著作权）
 */
export const KEEP_WORDS_ZHU = Object.freeze([
  // 2 字词（zhù 名词/形容词）
  "显著",
  "卓著",
  "昭著",
  "土著",
  "专著",
  "拙著",
  "巨著",
  "名著",
  "原著",
  "译著",
  "编著",
  "撰著",
  "创著",
  "鸿著",
  "杰著",
  "遗著",
  "论著",
  "旧著",
  "新著",
  "大著",
  "典著",
  // 2 字词（著 + 名词/作品后缀）
  "著作",
  "著名",
  "著者",
  "著录",
  "著述",
  "著书",
  "著说",
  // 3 字词（著 + 作品 + 范畴）
  "著作权",
  "著作物",
  "著作人",
]);

/**
 * KEEP_PRE 字符集：合法 zhù 化合词的前导字符（形容词/名词修饰）。
 * 第二轮 +「土」（修复 goddess / 土著）。
 */
export const KEEP_PRE = new Set("卓昭显原译专拙巨名编撰创鸿杰遗论旧新大典土".split(""));

/**
 * KEEP_POST 字符集：合法著X 化合词的后随字符（名词/作品后缀）。
 */
export const KEEP_POST = new Set("名作录述权者书说".split(""));

/**
 * 触发「<verb> + 著(zhe) + 作」强制拆分的 2 字动词前缀。
 *
 * 触发条件：prev2 = text[i-2..i] (即「著」前 2 字) ∈ 此集合，
 * 且 next char ∈ KEEP_POST (即「著」后是「作」等 X 化合词) 时，
 * 强制 convert (覆盖词级白名单 + 字符邻居的所有 keep 路径)。
 *
 * 来源：本轮 Corpus 实证仅 1 处（speaker / 意味著作）。
 * 余下的「暗示/标志/体现/蕴涵/蕴藏/反映/显露/显示/表明/证明/充满/象征/印证/隐藏/保持/维持/占据/拥有/实行/实践/蕴含/翻译/描述/阐述/预示/证实/蕴藏/揭示/允诺/阻止/忍受/主张/包含/聘请/宣称/...」
 * 为「meaning verb」族但「+著作」pattern 在 corpus 暂未出现，仅做扩展占位。
 * 注：list 中排除「体现」等易误伤的（体现+名词=正常的"embody work"）；
 *     若 corpus 后续出现「意味XX」以外的 X+著作，可按需扩列。
 */
export const VERB_PREFIXES_BEFORE_ZHU = new Set(["意味"]);

/**
 * 找出所有「著」的位置中被 KEEP_WORDS_ZHU 整词覆盖的位置。
 * 返回 `Set<number>`（覆盖到的字符 index 集合）。
 *
 * 策略：按字典顺序长得后短（先 3 字词，再 2 字词），避免「著」被 2 字词「著作」占据后
 * 3 字词「著作权」匹配不上前两个字符的子串。
 */
export function coveredPositionsByKeepWords(text, words = KEEP_WORDS_ZHU) {
  const covered = new Set();
  if (text == null || typeof text !== "string") return covered;
  const sorted = [...words].sort((a, b) => b.length - a.length);
  for (const word of sorted) {
    let pos = 0;
    while ((pos = text.indexOf(word, pos)) !== -1) {
      for (let k = 0; k < word.length; k++) covered.add(pos + k);
      pos += word.length;
    }
  }
  return covered;
}

/**
 * 判定位置 i 处「著」是否应保留。
 *
 * 决策层次（按顺序）：
 *   1. 词级白名单命中 → 再过 VERB_PREFIXES_BEFORE_ZHU 校验
 *      即「X著作」且 X ∈ 此集 → 视为「X+著(zhe)+作」动词后缀 → convert
 *   2. 词级白名单命中但未触发动词前缀 → keep
 *   3. 词级白名单未命中 → 字符邻居兜底（KEEP_PRE / KEEP_POST）
 *      KEEP_POST 命中时也再过 VERB_PREFIXES_BEFORE_ZHU 校验
 *   4. 字符邻居也未命中 → convert
 */
export function isKeptZhù(text, i) {
  if (text == null || typeof text !== "string" || text[i] !== ZH) {
    return { keep: false };
  }
  const prev = i > 0 ? text[i - 1] : "";
  const next = i + 1 < text.length ? text[i + 1] : "";
  const prev2 = i >= 2 ? text.substring(i - 2, i) : "";

  // 1. 词级白名单二次校验
  const covered = coveredPositionsByKeepWords(text);
  if (covered.has(i)) {
    const word = findCoveringWord(text, i);
    // 动词前缀检查：X著+作 pattern
    if (KEEP_POST.has(next) && VERB_PREFIXES_BEFORE_ZHU.has(prev2)) {
      return {
        keep: false,
        blocked_by: "VERB_PREFIXES_BEFORE_ZHU",
        verb: prev2,
        whitelisted_word: word,
      };
    }
    return { keep: true, source: "whitelist", word };
  }

  // 3. 字符邻居兜底
  if (KEEP_PRE.has(prev)) {
    return { keep: true, source: "KEEP_PRE", prev };
  }
  if (KEEP_POST.has(next)) {
    // 动词前缀检查：X著+作 pattern
    if (VERB_PREFIXES_BEFORE_ZHU.has(prev2)) {
      return { keep: false, blocked_by: "VERB_PREFIXES_BEFORE_ZHU", verb: prev2 };
    }
    return { keep: true, source: "KEEP_POST", next };
  }

  // 4. 默认 convert
  return { keep: false };
}

/**
 * 在文本中查找包含位置 i 的 KEEP_WORDS_ZHU 词。
 */
function findCoveringWord(text, i, words = KEEP_WORDS_ZHU) {
  for (const word of words) {
    let pos = 0;
    while ((pos = text.indexOf(word, pos)) !== -1) {
      if (i >= pos && i < pos + word.length) {
        return word;
      }
      pos += word.length;
    }
  }
  return null;
}

/**
 * 主检测入口（同 scan_traditional.mjs 旧版「findTraditional」行为升级版）。
 * 返回 [{ i, char, source, fixed }] 列表，按 i 排序。
 *
 * 三个来源：
 *   1. `t2s`：OpenCC t2s 通用 profile（与 tatoeba.mjs / toSimplified.test.ts 同口径）
 *   2. `context_著`：词级白名单之外 + 字符邻居未兜底的所有「著」 → 替换为「着」
 *   3. `explicit_妳`：「妳」无条件 → 「你」
 */
export function scanTraditional(text, t2sConverter) {
  const hits = [];
  if (text == null || typeof text !== "string") return hits;
  // 1. t2s 主检测
  const t2sOut = t2sConverter(text);
  if (t2sOut !== text) {
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c.charCodeAt(0) < 0x4e00 || c.charCodeAt(0) > 0x9fff) continue;
      const simChar = t2sOut[i] ?? "";
      if (simChar !== c) {
        hits.push({ i, char: c, source: "t2s", fixed: simChar });
      }
    }
  }
  // 2. 著(zhe) → 着（不在白名单中 & 不被字符邻居兜底）
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ZH) continue;
    const dec = isKeptZhù(text, i);
    if (dec.keep) continue;
    hits.push({ i, char: ZH, source: "context_著", fixed: "着" });
  }
  // 3. 妳 → 你
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== KRU) continue;
    hits.push({ i, char: KRU, source: "explicit_妳", fixed: YOU_HAN });
  }
  hits.sort((a, b) => a.i - b.i);
  return hits;
}

/**
 * 应用扫描结果（生成新文本），不改原串。
 * 注意：不做内容合并，所有命中按 source 字段独立处理。
 */
export function applyTraditionalFixes(text, t2sConverter) {
  const hits = scanTraditional(text, t2sConverter);
  if (hits.length === 0) return { text, hits: [] };
  const out = text.split("");
  for (const h of hits) {
    out[h.i] = h.fixed;
  }
  return { text: out.join(""), hits };
}

/**
 * 自身回归用例（RAY-338 第三轮要求）。
 *
 * 14 个用例覆盖：
 *   - 第二轮复审发现的 2 处误判（goddess「土著」、speaker「意味着作」）
 *   - 第二轮残留的 4 处典型 verb-particle 用法（顶著/等著/活著/虽活著）
 *   - 7 处 keep 词的合法用法（著作/著名/著述/著作权/显著/原著/体现）
 *   - 1 处「妳」用例（t2s / tw2s 均漏）
 *   - 1 处 t2s 基础命中（舖→铺）以确保 t2s 入口仍工作
 */
export function selfTest(t2sConverter) {
  const cases = [
    {
      label: "goddess 王子：土著保留（PRE 含 土）",
      text: "土著居民敬仰的女神",
      expectHits: [],
    },
    {
      label: "speaker 王子：意味着作（VERB_PREFIXES 触发拆分）",
      text: "意味著作一个",
      expectHits: [{ i: 2, char: "著", source: "context_著", fixed: "着" }],
    },
    {
      label: "verb-particle（顶著强风）",
      text: "顶著强风",
      expectHits: [{ i: 1, char: "著", source: "context_著", fixed: "着" }],
    },
    {
      label: "verb-particle（等著看）",
      text: "等著看",
      expectHits: [{ i: 1, char: "著", source: "context_著", fixed: "着" }],
    },
    {
      label: "verb-particle（活著）",
      text: "活著",
      expectHits: [{ i: 1, char: "著", source: "context_著", fixed: "着" }],
    },
    {
      label: "verb-particle（虽然下著雨）",
      text: "虽然下著雨",
      expectHits: [{ i: 3, char: "著", source: "context_著", fixed: "着" }],
    },
    {
      label: "keep 词：著名作家（POST=名）",
      text: "著名作家",
      expectHits: [],
    },
    {
      label: "keep 词：著述丰富（POST=述）",
      text: "著述丰富",
      expectHits: [],
    },
    {
      label: "keep 词：著作权保护（3 字词）",
      text: "著作权保护",
      expectHits: [],
    },
    {
      label: "keep 词：显著增加（PRE=显）",
      text: "显著增加",
      expectHits: [],
    },
    {
      label: "keep 词：他的原著（POST=作 + VERB_PREFIXES 不命中）",
      text: "他的原著",
      expectHits: [],
    },
    {
      label: "keep 词：体现著作（verb+noun 合法用法）",
      text: "体现著作",
      expectHits: [],
    },
    {
      label: "妳→你（t2s/tw2s 均漏）",
      text: "妳好",
      expectHits: [{ i: 0, char: "妳", source: "explicit_妳", fixed: "你" }],
    },
    {
      label: "t2s 基础命中（舖→铺）",
      text: "舖平道路",
      expectHits: [{ i: 0, char: "舖", source: "t2s", fixed: "铺" }],
    },
  ];
  const failures = [];
  for (const { text, expectHits, label } of cases) {
    const hits = scanTraditional(text, t2sConverter);
    const got = hits.map(({ i, char, source, fixed }) => ({ i, char, source, fixed }));
    const expected = expectHits ?? [];
    const equal =
      expected.length === 0 && got.length === 0
        ? true
        : JSON.stringify(got) === JSON.stringify(expected);
    if (!equal) {
      failures.push({ label, text, expected, got });
    }
  }
  return { failures, total: cases.length };
}
