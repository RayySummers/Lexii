/**
 * 单词词条模式：字母、撇号、连字符、点（如 "well-known"、"Mr."）。
 * 运行时定义在 termPattern.js（纯 JS，脚本侧 Node ESM 直接 import 同一文件）；
 * 本文件为 TS 侧提供类型。
 */
export declare const TERM_PATTERN: RegExp;
