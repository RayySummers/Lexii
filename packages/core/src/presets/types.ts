/**
 * 预设词表数据模型（Tier 0 内置核心 / Tier 1・2 扩展包同构）。
 *
 * 对应 RAY-258：预设词表作为 PWA 内置数据打包（local-first，离线可用）。
 * 条目在打包脚本（scripts/presets/build.mjs）内完成清洗与分级，
 * 运行时只消费已校验的产物（见 tier0.ts 的 parse-don't-validate 装载）。
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
 * - `source` 来源与许可声明（与 LearningItem.source、许可溯源挂钩）。
 */
export interface PresetPackage {
  id: string;
  version: string;
  /** 面向用户的名称 */
  name: string;
  /** 来源与许可声明（许可证溯源） */
  source: string;
  /** 词条语言（Tier 0 固定 "en"） */
  lang: LanguageCode;
  /** 词条列表（打包侧已排序去重） */
  entries: PresetWordEntry[];
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
