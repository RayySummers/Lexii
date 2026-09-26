/**
 * 词条模式：单词（字母、撇号、连字符、点，如 "well-known"、"Mr."）与
 * 多词短语（词与词之间单个空格，如 "de jure"，RAY-492）。
 * 运行时定义在 termPattern.js（纯 JS，脚本侧 Node ESM 直接 import 同一文件）；
 * 本文件为 TS 侧提供类型。
 */
export declare const TERM_PATTERN: RegExp;

/**
 * 多词短语判定（词条内部含空格）；与 TERM_PATTERN 同处一个物理定义，
 * 打包侧（scripts/presets/build.mjs / lib/books.mjs）按此把短语挡在
 * Tier 0 / Tier 1 与内置词书之外（RAY-492）。
 */
export declare function isPhraseTerm(term: string): boolean;
