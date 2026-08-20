/**
 * 近义词按义项分组（RAY-367）。
 *
 * 数据层：
 * - 新数据（0.10.0 起）：`Sense.synonymsByDefinition` 与 `definitions` 等长，第 i 项为第 i 条释义的近义词；
 * - 存量数据：仅有扁平 `synonyms`（富化数据提供，不区分义项）。
 *
 * UI 口径：
 * - 优先按 `synonymsByDefinition` 分组；
 * - 存量扁平数据回退为「单分组 + 义项标注」：把全部近义词归到最可能所属的义项（启发式挑 verb 义项，否则首条），
 *   分组标题带该义项的词性与释义预览，满足「标记具体哪个含义的近义词」；
 * - 无近义词返回空数组，调用方不渲染区块。
 *
 * 该文件为纯函数，无副作用，便于测试。
 */
import type { Sense } from "@lexii/core";
import { resolveDefinitionPos } from "@lexii/core";

export interface SynonymGroup {
  /** 所属释义下标 */
  definitionIndex: number;
  /** 所属释义文本（完整 definitions[i]） */
  definition: string;
  /** 所属释义的词性（已解析，空串表示未知） */
  pos: string;
  /** 该义项的近义词列表 */
  synonyms: string[];
}

/**
 * 按义项分组的近义词。
 *
 * @param sense 义项快照
 * @returns 分组列表（按 definitionIndex 升序；空分组已过滤；无需近义词时返回 []）
 */
export function getSynonymGroups(sense: Sense): SynonymGroup[] {
  const definitions = sense.definitions;
  const posList = resolveDefinitionPos(sense);

  // 1. 新数据优先：按 synonymsByDefinition 分组
  const byDef = sense.synonymsByDefinition;
  if (Array.isArray(byDef) && byDef.length === definitions.length) {
    const groups: SynonymGroup[] = [];
    for (let i = 0; i < definitions.length; i += 1) {
      const list = byDef[i] ?? [];
      if (list.length === 0) continue;
      groups.push({
        definitionIndex: i,
        definition: definitions[i] ?? "",
        pos: posList[i] ?? "",
        synonyms: [...list],
      });
    }
    return groups;
  }

  // 2. 存量数据：扁平 synonyms 回退为单分组 + 义项标注
  const flat = sense.synonyms ?? [];
  if (flat.length === 0) {
    return [];
  }
  // 只有一条释义 → 直接归属首条
  if (definitions.length <= 1) {
    return [
      {
        definitionIndex: 0,
        definition: definitions[0] ?? "",
        pos: posList[0] ?? "",
        synonyms: [...flat],
      },
    ];
  }

  // 多义项：启发式挑最可能归属的义项（优先动词，符合 abandon 等 verb 义项带 near-syn 的真实分布）
  let ownerIdx = 0;
  // resolveDefinitionPos 已给出每条释义的词性；找第一个含 'v' 的词性（vt./vi./v.）
  for (let i = 0; i < posList.length; i += 1) {
    const pos = posList[i] ?? "";
    if (pos.toLowerCase().includes("v")) {
      ownerIdx = i;
      break;
    }
  }
  return [
    {
      definitionIndex: ownerIdx,
      definition: definitions[ownerIdx] ?? "",
      pos: posList[ownerIdx] ?? "",
      synonyms: [...flat],
    },
  ];
}

/**
 * 是否为到自身的循环近义词（大小写不敏感）。
 * 循环跳转需特殊处理：点击自身不应发起新检索（避免无意义的同词循环）。
 */
export function isSelfSynonym(synonym: string, term: string): boolean {
  return synonym.trim().toLowerCase() === term.trim().toLowerCase();
}
