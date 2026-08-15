/**
 * 预设词表数据模型（Tier 0 内置核心 / 词书库共享池 / Tier 1・2 扩展包同构）。
 *
 * 对应 RAY-258 / RAY-262：预设词表与考试分级词书作为 PWA 内置数据打包
 * （local-first，离线可用）。条目在打包脚本（scripts/presets/build.mjs）内
 * 完成清洗与分级，运行时只消费已校验的产物（见 tier0.ts / books.ts 的
 * parse-don't-validate 装载）。
 */
import type { LanguageCode } from "../domain";

/** 预设词表条目（内容快照，无调度状态） */
export interface PresetWordEntry {
  /** 词条原文（打包侧已按词条模式清洗：英文单词，无短语/词缀） */
  term: string;
  /** 中文释义（≥1 条，第一条为主释义；全角分号分隔） */
  definitions: string[];
  /** 词性（可选），如 "n." / "vt." */
  pos?: string;
  /** 音标（可选，ECDICT 提供） */
  ipa?: string;
  /** 标签，如 ["四级", "高频"] */
  tags: string[];
}

/**
 * 预设词表包：内置数据的顶层容器。
 *
 * - `id` 稳定标识（如 "core-en-tier0"），安装状态以 id 为键持久化；
 * - `version` 内容版本，随来源数据更新递增；
 * - `description` 面向用户的说明文案（可选；词书库词书必填，冲刺词书
 *   须注明「层次近似词书，非官方专四/专八名单」，RAY-262 口径红线）；
 * - `source` 来源与许可声明（与 LearningItem.source、许可溯源挂钩）。
 */
export interface PresetPackage {
  id: string;
  version: string;
  /** 面向用户的名称 */
  name: string;
  /** 面向用户的说明文案（可选） */
  description?: string;
  /** 来源与许可声明（许可证溯源） */
  source: string;
  /** 词条语言（Tier 0 固定 "en"） */
  lang: LanguageCode;
  /** 词条列表（打包侧已排序去重） */
  entries: PresetWordEntry[];
}

/** 词书分组：考试词汇 / 冲刺词书（词书库页分组展示用） */
export type WordbookCategory = "exam" | "sprint";

/**
 * 词书定义（词书库目录条目，RAY-262）。
 *
 * 与 PresetPackage 的区别：词书目录只存元数据 + term 索引（"terms"），
 * 词条内容（释义/词性/音标/标签）在共享池（books.data.json 的 pool）
 * 按 term join 得到，池内每条释义只存一份，独立打包省 4.2 倍体积（实测）。
 */
export interface WordbookDefinition {
  /** 稳定标识（如 "book-cet6"），安装状态以 id 为键持久化 */
  id: string;
  /** 面向用户的名称（冲刺词书名称须注明「近似词书」，RAY-262 口径红线） */
  name: string;
  /** 面向用户的说明文案（冲刺词书须注明「层次近似词书，非官方专四/专八名单」） */
  description: string;
  /** 分组：考试词汇 / 冲刺词书 */
  category: WordbookCategory;
  /** 词条索引（term 升序，与共享池一致；打包侧已去重） */
  terms: string[];
}

/** 第三方数据来源与许可声明（供「数据来源与许可」页与 NOTICE 渲染） */
export interface ThirdPartyDataSource {
  /** 稳定标识，如 "ecdict" */
  id: string;
  /** 来源名称 */
  name: string;
  /** 许可名称（如 "MIT" / "CC BY-SA 4.0"） */
  license: string;
  /** 许可证文本链接（可核对出处） */
  licenseUrl: string;
  /** 来源主页链接 */
  sourceUrl: string;
  /** 署名要求（许可证义务） */
  attribution: string;
  /** 乐希的使用方式（中文说明） */
  usage: string;
  /** 该来源数据随哪些包分发（空数组 = 未随包分发） */
  bundledIn: readonly string[];
}
