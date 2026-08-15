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
export type { DexieConstructor, LexilexiDatabase, LexilexiTables, MetaRecord } from "./persistence";
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
export { DEFAULT_WORDLIST_LANG, CsvFormatError, parseCsvWordlist, TERM_PATTERN } from "./csv";
export type { CsvParseResult, CsvWordEntry } from "./csv";
export { exportCsvWordlist, serializeWordlistCsv } from "./exportCsv";
export { SAMPLE_WORDLIST, SAMPLE_WORDLIST_CSV, SAMPLE_WORDLIST_ROW_COUNT } from "./sampleWordlist";
export { importCsvWordlist, toMemoryState, toSense } from "./importWords";
export type { ImportWordsOptions, ImportWordsResult, WordEntryContent } from "./importWords";
export {
  getPresetInstallState,
  installPreset,
  presetDoneKey,
  presetProgressKey,
  PRESET_CHUNK_SIZE,
} from "./presets/install";
export type {
  PresetInstallOptions,
  PresetInstallResult,
  PresetInstallState,
  PresetInstallStatus,
} from "./presets/install";
export type {
  PresetPackage,
  PresetWordEntry,
  ThirdPartyDataSource,
  WordbookCategory,
  WordbookDefinition,
} from "./presets/types";
export { THIRD_PARTY_DATA_SOURCES, THIRD_PARTY_NOTICES } from "./presets/notices";
export { TIER0_PRESET, TIER0_PRESET_ROW_COUNT } from "./presets/tier0";
// 词书库运行时 API（WORDBOOK_CATALOG / WORDBOOK_POOL / getWordbookPackage 等）
// 走 "@lexilexi/core/presets/books" 子路径导出：books.data.json 约 2 MB，
// 静态 re-export 会把词书数据打进所有消费者主 bundle；子路径 + 动态 import
// 使 Vite 将其拆为按需加载的 async chunk（RAY-262 Oscar 评审 suggestion 3）。
export {
  getDueItemIds,
  getDueItemIdsInRange,
  getStudyQueueItemIds,
  gradeReview,
  memoryFieldsToCardInput,
} from "./studyLoop";
export type {
  GradeReviewInput,
  GradeReviewResult,
  StudyMode,
  StudyQueueOptions,
} from "./studyLoop";
