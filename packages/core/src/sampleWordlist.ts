/**
 * 内置示例词表（许可干净）。
 *
 * 14 个基础英语词条，词条本身不构成版权客体；中文释义为本项目原创
 * （版权归 Lexii 项目，GPL-3.0-or-later）。无任何第三方词典数据，
 * 可随仓库任意分发。
 *
 * 以模板字符串内嵌而非文件导入：core 包的构建产物（dist）不复制资源文件，
 * 内嵌保证「示例词表」在发布产物中始终可用（local-first，无网络请求）。
 * 文本形态与 importCsvWordlist 的输入格式完全一致（表头 term,definition,pos）。
 */
import { parseCsvWordlist } from "./csv";
import type { CsvWordEntry } from "./csv";

/** 内置示例词表的原始 CSV 文本（与导入接口一致的输入形态） */
export const SAMPLE_WORDLIST_CSV = [
  "term,definition,pos",
  "apple,苹果（一种常见的圆形水果，通常为红色或绿色）,n.",
  "book,书（装订成册的阅读材料）,n.",
  "computer,电脑（能按程序自动处理数据的电子设备）,n.",
  "dictionary,词典（收录词语并按一定顺序编排以供查阅的工具书）,n.",
  "example,例子（用来说明或证明的事物）,n.",
  "friend,朋友（彼此有交情的人）,n.",
  "happy,快乐的（感到或表现出愉悦与满足）,adj.",
  "important,重要的（具有重大意义或影响的）,adj.",
  "learn,学习（通过阅读、听讲或实践获得知识或技能）,v.",
  "memory,记忆（人脑存储和回忆信息的能力）,n.",
  "music,音乐（用有组织的乐音表达情感的艺术形式）,n.",
  "study,学习（专心探究或研读）,v.",
  "word,单词（语言中能够独立运用的最小单位）,n.",
  "world,世界（地球上所有地方与事物的总称）,n.",
].join("\n");

/** 词条数（表头除外） */
export const SAMPLE_WORDLIST_ROW_COUNT = 14;

/**
 * 内置示例词表（解析后的词条；构造时为静态内容，任何时刻都应与
 * SAMPLE_WORDLIST_CSV 一致——模块加载即解析，不一致会立即抛错）。
 */
export const SAMPLE_WORDLIST: readonly CsvWordEntry[] =
  parseCsvWordlist(SAMPLE_WORDLIST_CSV).entries;
