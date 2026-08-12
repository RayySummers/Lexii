# @lexilexi/eval

Lexilexi 学习评测包（lexilexi_eval）。

## 职责

- 建立 evidence model：把用户作答过程转化为结构化学习证据
  - 正确性（correctness）、首次尝试（first-try）、提示/线索使用（hint）、
    作答时长（latency）、编辑行为（edit）、练习类型（exercise type）、混淆选项（confusion choice）
- 由证据得出 Review Rating（again / hard / good / easy），供 `@lexilexi/fsrs` 调度
- 支持多种练习类型：回忆（Recall）、产出（Production）、完形（Cloze）、
  选择（Multiple choice）、辨析（Confusion discrimination）、听写（Dictation，后续）

## 当前状态（骨架）

仅导出 `PACKAGE_NAME` 常量。evidence model 与评测逻辑在 MVP 迭代中实现。
