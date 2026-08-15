# Tatoeba 例句库来源（下载缓存，不 vendored）

- **文件**（`.data/tatoeba/`，bz2 解压后）：
  - `eng_sentences.tsv` / `cmn_sentences.tsv`（句库，id + lang + text）
  - `eng-cmn_links.tsv`（英中句链接表，eng_id + cmn_id）
  - `eng_sentences_CC0.tsv` / `cmn_sentences_CC0.tsv`（CC0 子集，显式许可标记）
- **来源**：https://downloads.tatoeba.org/exports/per_language/
  （句库以语言代码分子目录：`eng/sentences.tsv.bz2`、`cmn/sentences.tsv.bz2`、
  `links.tsv.bz2`；CC0 子集位于仓库根目录）
- **许可**：默认 CC BY 2.0 FR（https://creativecommons.org/licenses/by/2.0/fr/，
  ToU §6.2），另有 CC0 子集文件显式标记（https://tatoeba.org/en/terms_of_use）
- **署名**：Tatoeba contributors. Sentences licensed CC BY 2.0 FR.
- **检索日期**：2026-08-15
- **使用口径**（RAY-267/268 拍板，「按句许可列过滤」实现点）：
  - 官方 per_language 导出**不含逐句 license 列**，许可以「默认 CC BY +
    CC0 子集显式标记」呈现，文本句仅这两种许可——过滤实现为
    `lib/tatoeba.mjs` 的 `licenseOf()`：CC0 子集命中 → CC0，否则 CC-BY，
    二者均保留；未来导出若引入其它许可形态，过滤点即在此函数；
  - 质量过滤：英句 5–200 字符含字母、中句 2–200 字符含 CJK、无 URL/@ 残留；
  - 去重：同一 (eng_id, cmn_id) 对与同一英文文本均只保留首个；
  - 每词至多 2 对（Tier 0 产物）/ 3 对（Tier 1 产物，`pairsForTerm` 的
    `maxPerTerm` 上限，默认 `MAX_PAIRS_PER_TERM = 3`），按词表裁剪后随富化包分发。

原始数据不 vendored 进仓库；复现流程见 `fetch-tatoeba.mjs`（下载 → bz2 解压 →
逐文件 SHA256 记入 manifest）。派生句对随富化包声明修改
（见 `packages/core/src/presets/notices.ts`）。
