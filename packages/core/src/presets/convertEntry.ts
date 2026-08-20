/**
 * 预设词条元组转换（tier0.ts / books.ts 共享，装载校验同一口径）。
 *
 * 打包侧生成格式为紧凑元组 [term, definitions, pos, ipa, tags, posByDefinition]：
 * - definitions 以换行符连接（清洗阶段保证释义文本内不含换行与字面 "\n"，
 *   换行连接是唯一无损分隔符，RAY-260 评审 nit 3）；
 * - posByDefinition（RAY-349，第 6 位）与 definitions 逐条对齐、同样以换行
 *   连接，无词性标记的段为空串；整串为空表示该词无逐条词性。RAY-349 之前
 *   的生成物是 5 元组（无此位），仍接受并按字段缺失处理——卡片退回按 pos
 *   汇总串推断的口径（见 ../definitionPos.ts）；
 * - 词条已按 TERM_PATTERN 过滤、按 term 去重、释义非空；
 * 本函数为「同一口径的第二道防线」（防御式，不重复清洗逻辑）。
 */
import { TERM_PATTERN } from "../csv";
import type { PresetWordEntry } from "./types";

/** 词条元组定长（与打包侧 toTuple 输出一致；5 = RAY-349 之前的旧生成物） */
const TUPLE_LENGTH = 6;
const TUPLE_LENGTH_LEGACY = 5;

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
  if (raw.length !== TUPLE_LENGTH && raw.length !== TUPLE_LENGTH_LEGACY) {
    throw new Error(`${sourceName} 词条 #${index} 元组长度非法：${raw.length}`);
  }
  const [term = "", defs = "", pos = "", ipa = "", tags = "", defPos = ""] = raw;
  if (!term || term === "") {
    throw new Error(`${sourceName} 词条 #${index} 词条为空`);
  }
  if (!TERM_PATTERN.test(term)) {
    throw new Error(`${sourceName} 词条 #${index} 词条形状非法："${term}"`);
  }
  // 释义与逐条词性同索引对齐：先按索引配对再过滤空释义段，
  // 保证任何一侧被丢弃的位置在另一侧也一并丢弃（对齐不可破）。
  const rawDefs = defs.split("\n");
  const rawDefPos = defPos === "" ? [] : defPos.split("\n");
  const definitions: string[] = [];
  const posByDefinition: string[] = [];
  rawDefs.forEach((part, defIndex) => {
    const definition = part.trim();
    if (definition === "") {
      return;
    }
    definitions.push(definition);
    posByDefinition.push((rawDefPos[defIndex] ?? "").trim());
  });
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
    ...(posByDefinition.some((item) => item !== "") ? { posByDefinition } : {}),
    tags: tagList,
  };
}
