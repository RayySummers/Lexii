/**
 * 预设词条元组转换（tier0.ts / books.ts 共享，装载校验同一口径）。
 *
 * 打包侧生成格式为紧凑元组 [term, definitions, pos, ipa, tags]：
 * - definitions 以换行符连接（清洗阶段保证释义文本内不含换行与字面 "\n"，
 *   换行连接是唯一无损分隔符，RAY-260 评审 nit 3）；
 * - 词条已按 TERM_PATTERN 过滤、按 term 去重、释义非空；
 * 本函数为「同一口径的第二道防线」（防御式，不重复清洗逻辑）。
 */
import { TERM_PATTERN } from "../csv";
import type { PresetWordEntry } from "./types";

/** 词条元组定长（与打包侧 toTuple 输出一致） */
const TUPLE_LENGTH = 5;

/**
 * 元组 → 类型化词条；形状非法立即抛错（生成物损坏在启动即暴露）。
 *
 * @param raw 元组（全字符串）
 * @param index 词条序号（错误信息定位用）
 * @param sourceName 数据文件名（错误信息前缀，如 "tier0.data.json"）
 */
export function convertPresetEntry(
  raw: readonly string[],
  index: number,
  sourceName: string,
): PresetWordEntry {
  if (raw.length !== TUPLE_LENGTH) {
    throw new Error(`${sourceName} 词条 #${index} 元组长度非法：${raw.length}`);
  }
  const [term = "", defs = "", pos = "", ipa = "", tags = ""] = raw;
  if (!term || term === "") {
    throw new Error(`${sourceName} 词条 #${index} 词条为空`);
  }
  if (!TERM_PATTERN.test(term)) {
    throw new Error(`${sourceName} 词条 #${index} 词条形状非法："${term}"`);
  }
  const definitions = defs
    .split("\n")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (definitions.length === 0) {
    throw new Error(`${sourceName} 词条 #${index}（${term}）缺少释义`);
  }
  const tagList = tags
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return {
    term,
    definitions,
    ...(pos !== "" ? { pos } : {}),
    ...(ipa !== "" ? { ipa } : {}),
    tags: tagList,
  };
}
