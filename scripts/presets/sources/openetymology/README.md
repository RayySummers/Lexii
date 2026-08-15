# OpenEtymology 单词本数据来源（下载缓存，不 vendored）

- **文件**（`.data/openetymology/`）：`CET4.epub` / `CET6.epub` / `TOEFL.epub` /
  `TEM8.epub` / `GRE8000.epub` + `DATA_LICENSE.md` + `LICENSE`
- **来源**：https://github.com/openetymology/OpenEtymology
  （固定 commit `7d89f3697abf26e305fe2627f181b692c2c10b28`，EPUB 文件 SHA256
  硬编码于 `fetch-openetymology.mjs`）
- **许可**：CC BY-SA 4.0（repo `DATA_LICENSE.md`；
  https://creativecommons.org/licenses/by-sa/4.0/）
- **署名**：OpenEtymology contributors. Data licensed CC BY-SA 4.0.
- **检索日期**：2026-08-15
- **结构**：五册 TXT 为纯词表，结构化内容（词根词缀拆解 / 中文词源 / 双语例句 /
  UK+US 双音标）在 EPUB 的 XHTML 章节 `word-entry` 区块内；
  解析见 `lib/openetymology.mjs`（最小 ZIP 读取器 + 词条区块正则，无第三方依赖）。
- **摄取口径**（RAY-268 批次 A）：仅取「词根词缀中文内容」——`wordParts`
  （如 `a<加强> · bandon<控制（拉丁语 bannum “公告/法令”）>`）与 `etymologyZh`
  （中文词源说明）；音标与例句字段解析后仅作统计（本批次富化管线例句走
  Tatoeba + kaikki，双音标走 ipa-dict + kaikki 校验），结构保留在解析结果里
  供后续批次复用。跨册去重：CET4 → CET6 → TOEFL → TEM8 → GRE8000 首现优先。

原始数据不 vendored 进仓库；复现流程见 `fetch-openetymology.mjs`（固定 commit +
SHA256 校验）。按词表裁剪后的词根词缀/中文词源字段随富化包声明修改
（见 `packages/core/src/presets/notices.ts`）。
