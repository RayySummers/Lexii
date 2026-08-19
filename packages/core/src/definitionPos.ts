/**
 * 释义级词性解析（RAY-349）：把「哪一条释义是什么词性」还原成与
 * definitions 等长的数组，供卡片按词性标注释义（而非只给序号 1. 2. 3.）。
 *
 * 两条数据来源，优先级从高到低：
 * 1. `sense.posByDefinition`——打包侧（scripts/presets/build.mjs）逐条剥离
 *    词性标记时保留的对齐数组，精确无歧义；
 * 2. `sense.pos`——整词去重汇总串（如 "a.；n.；vt."）。去重丢掉了对齐关系，
 *    只有「词性数与释义数相等」时才能一一对应（打包侧按出现顺序去重，
 *    顺序与释义一致）；其余情形一律返回空串，调用方退回序号展示。
 *    「只有一个词性就套用到全部释义」看似安全，实测（Tier 0 全量对照
 *    打包侧对齐数组）会给 2,634 条释义标上错误词性——只有部分释义带
 *    词性标记的词条（如 "a"：仅末条是 art.）会被全量误标。标错词性比
 *    只给序号更糟，因此不做这类推断。
 *
 * 存量数据（RAY-349 之前安装的义项、用户 CSV 导入的单列 pos）没有
 * posByDefinition，走第 2 条推断路径；覆盖不到的部分由
 * presets/definitionPosBackfill.ts 的存量回填补齐。
 */
import type { Sense } from "./domain";

/** pos 汇总串分隔符（与打包侧 stripPrefixMarkers 的 join 口径一致） */
const POS_SUMMARY_SEPARATOR = "；";

/** 解析所需的最小义项形状（便于对未落库的词条内容直接调用） */
export type DefinitionPosInput = Pick<Sense, "definitions"> &
  Partial<Pick<Sense, "pos" | "posByDefinition">>;

/**
 * 计算每条释义的词性标签。
 *
 * @returns 与 `definitions` 等长的数组；无法确定词性的位置为空串
 */
export function resolveDefinitionPos(sense: DefinitionPosInput): string[] {
  const count = sense.definitions.length;
  const aligned = sense.posByDefinition;
  if (aligned && aligned.some((item) => item.trim() !== "")) {
    return Array.from({ length: count }, (_, index) => (aligned[index] ?? "").trim());
  }
  const markers = (sense.pos ?? "")
    .split(POS_SUMMARY_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (markers.length === count && count > 0) {
    return markers.slice();
  }
  return Array.from({ length: count }, () => "");
}

/**
 * 是否至少有一条释义能标注词性（调用方据此决定标词性还是退回序号）。
 */
export function hasDefinitionPos(sense: DefinitionPosInput): boolean {
  return resolveDefinitionPos(sense).some((item) => item !== "");
}
