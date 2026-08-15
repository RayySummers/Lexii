# ipa-dict 来源（下载缓存，不 vendored）

- **文件**（`.data/ipa-dict/`）：`en_US.txt`、`en_UK.txt`（TSV：`word<TAB>/ipa/`）
- **来源**：https://github.com/open-dict-data/ipa-dict
  （固定 commit `43c3570eb3553bdd19fccd2bd0091534889af023`，文件 SHA256 硬编码
  于 `fetch-ipa-dict.mjs`）
- **许可**：
  - `en_US.txt`：MIT——数据链自 cmudict-ipa（CMU Pronouncing Dictionary 派生），
    repo 内标注 MIT；
  - `en_UK.txt`：GPL-3.0——数据链自 ipacards（Cambridge Advanced Learner's
    Dictionary 音标卡数据，ipacards 项目 GPL-3.0，repo 内标注）。
- **署名**：open-dict-data/ipa-dict contributors.
- **检索日期**：2026-08-15
- **摄取口径**（RAY-267/268 拍板，硬性要求）：**仅** en_US / en_UK 两个文件——
  repo 内个别语种文件为 CC BY-NC 许可，商用不可用，整库 clone/摄取禁止
  （Jack 拍板写入任务规格）。双音标主力：ipa-dict → kaikki sounds 补缺 →
  OpenEtymology 补缺（`build-enrichment.mjs`）。
- **GPL-3.0 分发条款**：en_UK 数据为 GPL-3.0 许可的衍生数据。富化包内嵌的
  音标字段属于「数据」分发；依据 GPL-3.0 §1/§5，随包分发需保留版权声明与许可
  文本（见 `packages/core/src/presets/notices.ts` 的 NOTICE 段，Vega 正式稿负责
  完整合规文案），并保证下游可获取对应源码（本文档 + `fetch-ipa-dict.mjs` 给出
  数据出处与完整复现路径）。乐希 PWA 本身不受 GPL 约束（数据与程序分离分发，
  数据文件以文件级许可对待）。

原始数据不 vendored 进仓库；复现流程见 `fetch-ipa-dict.mjs`（固定 commit +
SHA256 校验）。按词表裁剪后的双音标字段随富化包声明修改。
