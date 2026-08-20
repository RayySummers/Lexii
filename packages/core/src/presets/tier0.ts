/**
 * Tier 0 内置核心词表（随 PWA 打包，开箱离线可用）。
 *
 * 数据由 scripts/presets/build.mjs 生成（ECDICT MIT + NGSL 1.2 CC BY-SA 4.0，
 * 清洗 → 分级 → 紧凑元组 JSON），本文件在模块加载时做 parse-don't-validate：
 * 结构与词条形状不合法立即抛错（生成物损坏在启动即暴露，绝不带病运行）。
 *
 * 词条在打包侧已按 TERM_PATTERN 过滤、按 term 去重、释义非空；
 * 装载校验为「同一口径的第二道防线」（防御式，不重复清洗逻辑）。
 *
 * 释义连接符：打包侧（scripts/presets/build.mjs）以换行符连接多条释义——
 * 清洗阶段已保证释义文本内不含真实换行与字面 "\n"，换行连接与装载侧
 * split("\n") 是无损往返（全角分号可能出现在释义文本内，不作分隔符，
 * RAY-260 评审 nit 3）。
 */
import { convertPresetEntry } from "./convertEntry";
import type { PresetPackage } from "./types";
import tier0Data from "./tier0.data.json" with { type: "json" };

/** 生成物原始形态（紧凑元组：[term, definitions, pos, ipa, tags]，全字符串） */
type RawTier0Data = {
  id: string;
  version: string;
  name: string;
  generatedAt: string;
  source: string;
  entries: string[][];
};

const SOURCE_NAME = "tier0.data.json";

function loadTier0(): PresetPackage {
  const raw = tier0Data as unknown as RawTier0Data;
  if (typeof raw.id !== "string" || raw.id === "") {
    throw new Error("tier0.data.json 缺少包 id");
  }
  if (typeof raw.version !== "string" || raw.version === "") {
    throw new Error("tier0.data.json 缺少版本号");
  }
  if (typeof raw.name !== "string" || raw.name === "") {
    throw new Error("tier0.data.json 缺少包名称");
  }
  if (typeof raw.source !== "string" || raw.source === "") {
    throw new Error("tier0.data.json 缺少来源与许可声明");
  }
  if (!Array.isArray(raw.entries) || raw.entries.length === 0) {
    throw new Error("tier0.data.json 词条为空或格式非法");
  }
  return {
    id: raw.id,
    version: raw.version,
    name: raw.name,
    source: raw.source,
    lang: "en",
    entries: raw.entries.map((entry, index) => convertPresetEntry(entry, index, SOURCE_NAME)),
  };
}

/** Tier 0 内置核心词表（模块加载即校验，损坏立即抛错） */
export const TIER0_PRESET: PresetPackage = loadTier0();

/** Tier 0 词条数（表头除外——无表头；供 UI 展示与测试断言） */
export const TIER0_PRESET_ROW_COUNT = TIER0_PRESET.entries.length;
