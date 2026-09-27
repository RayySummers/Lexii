/**
 * 词条模式：单词（字母、撇号、连字符、点，如 "well-known"、"Mr."）与
 * 多词短语（词与词之间**单个空格**，如 "de jure"，RAY-492）。
 *
 * 允许 / 拒绝口径（RAY-492）：
 * - 允许：`de jure`、`well-known`、`don't`、`Mr.`、`as a matter of fact`；
 * - 拒绝：首尾空格（` well-known`）、连续空格（`a  b`）、词内多重点（`U.S.`）、
 *   数字与非英文字符（`apple2`、`苹 果`）、内部点（`e.g`）；
 * - 结尾至多一个点（`Mr.` 合法，`Mr..` 非法）——沿用 RAY-242 的单词口径。
 *
 * 本文件是 TERM_PATTERN 的唯一定义（RAY-260 评审 nit 1：消除 core 与
 * 打包脚本双处维护的漂移风险）。两个消费方 import 同一物理文件：
 * - TS 侧：packages/core（csv.ts 用户词表校验、tier0.ts 预设词表装载校验）
 *   经 termPattern.d.ts 拿到类型；
 * - 脚本侧：scripts/presets/lib/ecdict.mjs（Node ESM，不经构建）直接
 *   import 本文件——纯 JS，任何 Node 版本均可运行。
 *
 * 放宽的是**形状校验**：用户 CSV 导入与词包装载都会因此接受短语；
 * 「短语进哪一档」是打包分级口径，见 `isPhraseTerm` 与
 * scripts/presets/build.mjs（短语只进 Tier 2 全量包，RAY-492）。
 *
 * @type {RegExp}
 */
export const TERM_PATTERN = /^[A-Za-z][A-Za-z'-]*(?: [A-Za-z][A-Za-z'-]*)*[.]?$/;

/**
 * 多词短语判定：词条内部含空格（即 TERM_PATTERN 允许的单个内部分隔空格）。
 *
 * 唯一定义与 TERM_PATTERN 同处一个文件，供打包侧共享（RAY-492）：
 * Tier 0 / Tier 1 与内置词书仍按「单词」口径筛选，短语只进 Tier 2 全量包——
 * 否则短语会顺着考试标签与词频口径漏进内置档（实测：`ice cream` 带 zk 标签、
 * `a few` / `according to` 等 889 条达 Tier 1 口径）。
 *
 * @param {string} term 词条
 * @returns {boolean} true = 多词短语
 */
export function isPhraseTerm(term) {
  return term.includes(" ");
}
