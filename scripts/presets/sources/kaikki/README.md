# kaikki.org 英语词典提取来源（下载缓存，不 vendored）

- **文件**：`kaikki.org-dictionary-English.jsonl`（约 3.2GB，每周更新的当前快照；
  下载后 SHA256 与 Last-Modified 记入 `.data/kaikki/manifest.json` 作为固定凭据）
- **来源**：https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl
  （提取自 https://kaikki.org/dictionary/rawdata.html，上游为 Wiktionary 英文版）
- **许可**：CC BY-SA 4.0 + GFDL（https://en.wiktionary.org/wiki/Wiktionary:Copyrights）
- **署名**：Wiktionary contributors. Text licensed CC BY-SA 4.0 / GFDL.
- **检索日期**：2026-08-15（以 manifest.json 的 `fetchedAt` / `lastModified` 为准）
- **使用口径**（RAY-267/268 拍板）：
  - 例句仅取 `type === "example"` 的编者自造句；`quotation` 引用句涉 fair use，
    商用必须过滤（RAY-257 既定口径）；
  - 近反义词 / 派生词 / `etymology_text` 词源 / sounds 双音标校验同源提取；
  - 按 Tier 0/1 词表裁剪后才进入富化包（`build-enrichment.mjs`），全量数据
    不随包分发。

原始数据因体积不 vendored 进仓库；复现流程见 `fetch-kaikki.mjs`（多连接分段 +
断点续传，`--connections N`）。派生筛选结果随富化包声明修改
（见 `packages/core/src/presets/notices.ts`）。
