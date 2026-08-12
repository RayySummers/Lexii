/**
 * @lexilexi/core — Lexilexi 核心领域模型与共享类型
 *
 * 本包承载与 UI 无关的领域概念（学习条目、义项、记忆状态等），
 * 是唯一被所有包共享的基础层。骨架阶段仅声明最稳定的常量与基础类型，
 * 完整的领域模型在 MVP 迭代中逐步补充。
 */

/** 应用名（英文） */
export const APP_NAME = "Lexilexi";

/** 应用名（中文） */
export const APP_NAME_ZH = "乐希";

/** 学习条目 id（骨架阶段使用字符串，后续若需要可迁移为结构化 id） */
export type ItemId = string;

/** 义项（sense）id */
export type SenseId = string;
