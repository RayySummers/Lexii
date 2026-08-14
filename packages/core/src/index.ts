/**
 * @lexilexi/core — Lexilexi 核心领域模型与本地数据层
 *
 * 本包承载与 UI 无关的领域概念与本地持久化（local-first）：
 * - 领域模型：Learning Item / Sense / Memory State / Event（event schema v0）
 *   设计文档见 docs/domain-model.md，接口契约与 @lexilexi/fsrs 对齐。
 * - IndexedDB/Dexie 持久化：schema 升级必须走版本迁移（禁止清库重来）。
 * - 数据防线：navigator.storage.persist() / persisted() 申请与状态上报。
 * - 导出/导入：完整可恢复的 JSON 快照。
 *
 * 不含任何算法实现（FSRS 在 @lexilexi/fsrs，评测在 @lexilexi/eval，
 * 统计在 @lexilexi/stats），不依赖浏览器 UI 层。
 */
export {
  APP_NAME,
  APP_NAME_ZH,
  DB_SCHEMA_VERSION,
  EVENT_SCHEMA_VERSION,
  EXPORT_FORMAT_VERSION,
} from "./constants";
export { createId, hasIdPrefix, toEventId, toItemId, toSenseId } from "./id";
export type { EventId, IdPrefix, ItemId, SenseId } from "./id";
export type {
  ExampleSentence,
  IsoDate,
  ItemKind,
  ItemStatus,
  LanguageCode,
  LearningItem,
  Sense,
} from "./domain";
export type { MemoryState, MemoryStateFields, MemoryStatus } from "./memory";
export {
  isDeleteItemEvent,
  isEditItemEvent,
  isEditSenseEvent,
  isImportEvent,
  isReviewEvent,
  isSuspendEvent,
  isUnsuspendEvent,
} from "./events";
export type {
  BaseEvent,
  DeleteItemEvent,
  Diff,
  EditItemEvent,
  EditSenseEvent,
  Event,
  EventType,
  ExerciseType,
  ImportEvent,
  ReviewEvent,
  ReviewRating,
  SuspendEvent,
  UnsuspendEvent,
} from "./events";
export {
  createLexilexiDatabase,
  deleteItem,
  openDatabase,
  openLexilexiDatabase,
  recordReview,
  suspendItem,
  unsuspendItem,
} from "./persistence";
export type { DexieConstructor, LexilexiDatabase, LexilexiTables } from "./persistence";
export {
  STORAGE_PERMISSION_EVENT,
  dispatchStoragePermissionRequested,
  getStorageManager,
  requestPersistence,
} from "./persistenceGuard";
export type {
  PersistenceStatus,
  StorageManagerLike,
  StoragePermissionRequestedDetail,
} from "./persistenceGuard";
export { exportLexilexiData, importLexilexiData, parseLexilexiExport } from "./export";
export type { LexilexiExportData } from "./export";
export { DEFAULT_WORDLIST_LANG, CsvFormatError, parseCsvWordlist } from "./csv";
export type { CsvParseResult, CsvWordEntry } from "./csv";
export { exportCsvWordlist, serializeWordlistCsv } from "./exportCsv";
export { SAMPLE_WORDLIST, SAMPLE_WORDLIST_CSV, SAMPLE_WORDLIST_ROW_COUNT } from "./sampleWordlist";
export { importCsvWordlist } from "./importWords";
export type { ImportWordsOptions, ImportWordsResult } from "./importWords";
export {
  getDueItemIds,
  getDueItemIdsInRange,
  gradeReview,
  memoryFieldsToCardInput,
} from "./studyLoop";
export type { GradeReviewInput, GradeReviewResult } from "./studyLoop";
