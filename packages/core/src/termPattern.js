/**
 * 单词词条模式：字母、撇号、连字符、点（如 "well-known"、"Mr."）。
 *
 * 本文件是 TERM_PATTERN 的唯一定义（RAY-260 评审 nit 1：消除 core 与
 * 打包脚本双处维护的漂移风险）。两个消费方 import 同一物理文件：
 * - TS 侧：packages/core（csv.ts 用户词表校验、tier0.ts 预设词表装载校验）
 *   经 termPattern.d.ts 拿到类型；
 * - 脚本侧：scripts/presets/lib/ecdict.mjs（Node ESM，不经构建）直接
 *   import 本文件——纯 JS，任何 Node 版本均可运行。
 *
 * @type {RegExp}
 */
export const TERM_PATTERN = /^[A-Za-z][A-Za-z'-]*[.]?$/;
