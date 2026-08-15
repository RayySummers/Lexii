/**
 * 第三方数据来源与许可登记（RAY-258「数据来源与许可」页的数据事实层）。
 *
 * 许可证出处均经 RAY-257 调研简报逐项核对（MIT LICENSE 文件 / 官方版权页 /
 * 官方下载页声明），RAY-268 富化批次新增 Tatoeba / ipa-dict / OpenEtymology
 * 登记（许可出处见各条 licenseUrl）。本登记只承载可核对的事实（来源、许可、
 * 署名要求），面向用户的中文文案由 Vega（RAY-259）提供后替换页面介绍区文案；
 * NOTICE 正式稿亦由 Vega 起草，本文件的 THIRD_PARTY_NOTICES 为过渡版
 * 事实性署名文本（满足 MIT 保留版权声明与 CC BY-SA 署名义务）。
 */
import type { ThirdPartyDataSource } from "./types";

/** 内置包（Tier 0）随包分发的数据来源登记 */
export const THIRD_PARTY_DATA_SOURCES: readonly ThirdPartyDataSource[] = [
  {
    id: "ecdict",
    name: "ECDICT",
    license: "MIT",
    licenseUrl: "https://github.com/skywind3000/ECDICT/blob/master/LICENSE",
    sourceUrl: "https://github.com/skywind3000/ECDICT",
    attribution: "Copyright © 2025 Linwei (ECDICT)，MIT License",
    usage: "预设词表主力词库：中文释义、词性、音标、考试分级标签（中考/高考/四级/六级等）",
    bundledIn: ["core-en-tier0", "core-en-tier1", "core-en-tier2"],
  },
  {
    id: "ngsl",
    name: "NGSL 1.2（New General Service List）",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    sourceUrl: "https://www.newgeneralservicelist.com/",
    attribution:
      "Browne, C., Culligan, B. & Phillips, J. (2013). The New General Service List. CC BY-SA 4.0.",
    usage: "「高频核心」选词基准（2,809 词），与 ECDICT 按词条 join 补中文释义，标记「高频」标签",
    bundledIn: ["core-en-tier0", "core-en-tier1", "core-en-tier2"],
  },
  {
    id: "wiktionary",
    name: "Wiktionary（经 kaikki.org 提取）",
    license: "CC BY-SA 4.0 + GFDL",
    licenseUrl: "https://en.wiktionary.org/wiki/Wiktionary:Copyrights",
    sourceUrl: "https://kaikki.org/dictionary/rawdata.html",
    attribution: "Wiktionary contributors. Text licensed CC BY-SA 4.0 / GFDL.",
    usage:
      "富化包例句（仅 type=example 的编者自造句，quotation 引用句已按 fair use 口径过滤）、近反义词、派生词、英文词源与双音标校验，按 Tier 0/1 词表裁剪后随富化包分发",
    bundledIn: ["core-en-tier0-enrichment", "core-en-tier1-enrichment"],
  },
  {
    id: "tatoeba",
    name: "Tatoeba 例句库（eng-cmn 句对）",
    license: "CC BY 2.0 FR（默认）+ CC0 子集",
    licenseUrl: "https://tatoeba.org/en/terms_of_use",
    sourceUrl: "https://downloads.tatoeba.org/exports/per_language/",
    attribution:
      "Tatoeba contributors. Sentences licensed CC BY 2.0 FR (https://creativecommons.org/licenses/by/2.0/fr/); CC0-marked subsets dedicated to the public domain.",
    usage:
      "富化包双语例句（每词至多 3 对，按句许可过滤：仅保留 CC BY / CC0 文本句；英文句与中文句均经质量过滤）",
    bundledIn: ["core-en-tier0-enrichment", "core-en-tier1-enrichment"],
  },
  {
    id: "ipa-dict",
    name: "ipa-dict（open-dict-data）",
    license: "MIT（en_US 文件）/ GPL-3.0（en_UK 文件）",
    licenseUrl: "https://github.com/open-dict-data/ipa-dict",
    sourceUrl: "https://github.com/open-dict-data/ipa-dict",
    attribution: "open-dict-data/ipa-dict contributors.",
    usage:
      "富化包双音标主力（仅摄取 en_US / en_UK 两个文件，避开仓库内个别 CC BY-NC 语种文件）；kaikki / OpenEtymology 音标仅作缺省补位",
    bundledIn: ["core-en-tier0-enrichment", "core-en-tier1-enrichment"],
  },
  {
    id: "openetymology",
    name: "OpenEtymology 单词本数据",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://github.com/openetymology/OpenEtymology/blob/main/DATA_LICENSE.md",
    sourceUrl: "https://github.com/openetymology/OpenEtymology",
    attribution: "OpenEtymology contributors. Data licensed CC BY-SA 4.0.",
    usage:
      "富化包词根词缀拆解与中文词源（CET4/CET6/TOEFL/TEM8/GRE8000 五册 EPUB 解析，词条去重）",
    bundledIn: ["core-en-tier0-enrichment", "core-en-tier1-enrichment"],
  },
];

/**
 * 打包 NOTICE（过渡版，事实性署名；正式稿由 Vega RAY-259 起草后替换）。
 *
 * 义务来源：MIT 要求保留版权声明与许可文本；CC BY-SA 4.0 要求署名 +
 * 相同方式共享（注明来源、许可与修改）。内置数据为「ECDICT 按考试标签
 * 过滤 + 释义清洗 + 与 NGSL 按词条合并」的派生产物。
 */
export const THIRD_PARTY_NOTICES = [
  "# 数据来源与许可声明（NOTICE）",
  "",
  "乐希（Lexilexi）内置预设词表包含以下第三方数据（本文件为过渡版事实性署名，",
  "正式文案由团队后续修订）：",
  "",
  "## ECDICT",
  "",
  "- 来源：https://github.com/skywind3000/ECDICT",
  "- 许可：MIT License（Copyright © 2025 Linwei）",
  "- 修改：按考试标签（中考/高考/四级/六级等）过滤词条；释义换行规范化为全角分号；",
  "  过滤短语与畸形条目；按词条去重；与 NGSL 词表合并补充释义。",
  "- MIT 许可证全文：",
  "",
  "  MIT License",
  "",
  "  Copyright (c) 2025 Linwei",
  "",
  "  Permission is hereby granted, free of charge, to any person obtaining a copy",
  '  of this software and associated documentation files (the "Software"), to deal',
  "  in the Software without restriction, including without limitation the rights",
  "  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell",
  "  copies of the Software, and to permit persons to whom the Software is",
  "  furnished to do so, subject to the following conditions:",
  "",
  "  The above copyright notice and this permission notice shall be included in",
  "  all copies or substantial portions of the Software.",
  "",
  '  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
  "  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,",
  "  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE",
  "  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER",
  "  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
  "  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN",
  "  THE SOFTWARE.",
  "",
  "## NGSL 1.2",
  "",
  "- 来源：https://www.newgeneralservicelist.com/（NGSL_12_stats.csv）",
  "- 许可：CC BY-SA 4.0（https://creativecommons.org/licenses/by-sa/4.0/）",
  "- 署名：Browne, C., Culligan, B. & Phillips, J. (2013). The New General",
  "  Service List. Retrieved from https://www.newgeneralservicelist.com.",
  "- 修改：词条与 ECDICT 释义按词条合并；未随包分发原始词频统计。",
  "- 内置数据中的 NGSL 衍生部分依相同方式共享（CC BY-SA 4.0）条款分发。",
  "",
  "## Wiktionary（经 kaikki.org 提取）",
  "",
  "- 来源：https://kaikki.org/dictionary/rawdata.html",
  "- 许可：CC BY-SA 4.0 + GFDL（https://en.wiktionary.org/wiki/Wiktionary:Copyrights）",
  "- 署名：Wiktionary contributors. Text licensed CC BY-SA 4.0 / GFDL.",
  "- 修改：仅取编者自造句（type=example，quotation 引用句已过滤）；按 Tier 0/1",
  "  词表裁剪；例句每词至多 2 条（Tier 0）/ 3 条（Tier 1），无句对词补 1 条",
  "  英文例句；近反义/派生词去重并按词表裁剪。",
  "",
  "## Tatoeba 例句库",
  "",
  "- 来源：https://downloads.tatoeba.org/exports/per_language/（eng/cmn 句库与",
  "  eng-cmn 链接表）",
  "- 许可：默认 CC BY 2.0 FR（https://creativecommons.org/licenses/by/2.0/fr/），",
  "  另有 CC0 子集文件显式标记（版权页与逐句许可见 ToU §6.2）。",
  "- 署名：Tatoeba contributors. Sentences licensed CC BY 2.0 FR.",
  "- 修改：仅保留 CC BY / CC0 文本句；按 eng-cmn 链接表 join 双语句对；",
  "  英文句/中文句质量过滤；同一英文文本只保留首个；每词至多 2 对（Tier 0）/",
  "  3 对（Tier 1）。",
  "",
  "## ipa-dict（open-dict-data）",
  "",
  "- 来源：https://github.com/open-dict-data/ipa-dict（仅 en_US / en_UK 文件）",
  "- 许可：en_US 文件 MIT；en_UK 文件 GPL-3.0。",
  "- 署名：open-dict-data/ipa-dict contributors.",
  "- 修改：按 Tier 0/1 词表裁剪为双音标字段；同词多行首现优先。",
  "",
  "## OpenEtymology 单词本数据",
  "",
  "- 来源：https://github.com/openetymology/OpenEtymology（CET4/CET6/TOEFL/",
  "  TEM8/GRE8000 五册 EPUB）",
  "- 许可：CC BY-SA 4.0（DATA_LICENSE.md，https://creativecommons.org/licenses/by-sa/4.0/）",
  "- 署名：OpenEtymology contributors. Data licensed CC BY-SA 4.0.",
  "- 修改：仅取词根词缀拆解与中文词源字段；按 Tier 0/1 词表裁剪；",
  "  跨册词条首现优先去重。",
  "",
].join("\n");
