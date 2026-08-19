/**
 * 设置页：数据安全 + 导出 / 导入（RAY-245），导航改版（RAY-253），
 * 每日新卡上限（RAY-260），主题三档选单（RAY-261）。
 *
 * - 数据安全：监听 `lexii:storage-permission` 事件（经 usePersistenceStatus），
 *   状态为 "denied" 时提示「当前数据可能被清理，建议导出」并提供直达导出入口；
 *   "unsupported" 环境静默降级、不提示（验收点 6）。
 * - 导出：JSON 完整备份（可原样导回）+ CSV 词表（可经 importCsvWordlist 导回）。
 * - 导入：JSON 备份恢复（同 id 覆盖）；解析失败 / 版本不兼容有明确错误提示。
 * - RAY-280（真机反馈）：导出备份入口从学习/复习页移到本页。原「数据安全」
 *   与「导出数据」两个分组合并为顶部显眼的「数据安全与备份」分组（含持久化
 *   提示与 JSON/CSV 导出），其后紧跟「导入数据」；导出功能本身不变。
 * - RAY-253 反馈 5/6：统一导航头（左侧返回箭头、标题右对齐，同统计页）；
 *   数据概览已删除（与统计页功能重复）。
 * - 关于（RAY-251）：GitHub 仓库链接 + 反馈问题入口（纯外链跳转，新窗口打开）；
 *   页面底部展示构建时注入的版本号（`APP_VERSION`，来源 package.json，不硬编码）。
 * - 每日新卡上限（RAY-260 评审 suggestion 2）：默认 20/日，输入框可调
 *   （1–999），持久化到 localStorage（与主题设置同一模式）。
 * - 主题（RAY-261）：外观分组下拉选单三档（浅色 / 深色 / 跟随系统）。
 *   状态与持久化由 App 级 `useTheme` 单一数据源持有，本页仅渲染选单并
 *   经 `onThemePreferenceChange` 回调；header 不再常驻主题开关。
 * - 选择题出题方向（RAY-293）：学习分组三档选单（英译中 / 中译英 / 混合），
 *   与评分档位、发音口音同一 localStorage 持久化模式；方向只影响题目
 *   呈现，不影响评分与 FSRS 调度（见 docs/quiz-fsrs-mapping.md）。
 * - RAY-324 发音源选择：学习分组新增下拉选单二档（系统自带 / 线上发音），
 *   持久化到 localStorage（与发音口音同一模式）；线上源为候选级联
 *   （Free Dictionary API 真人录音 + Lingva 在线合成，均实测可跨域），
 *   失败时自动回落系统朗读（见 lib/pronunciation.ts）。
 * - 卡片字体（RAY-323）：外观分组内 2×2 卡片选择器（4 档：现代简约 /
 *   现代圆润 / 手写温润 / 优雅衬线），每张卡片用对应字体渲染示例单词，
 *   让用户选择前看清字面特征；选中立即写入 localStorage，并通过
 *   <html data-card-font="..."> 同步到全局 CSS 变量 --lex-card-font，
 *   复习卡本体（ReviewCard 词条）下次渲染即生效。
 * - 隐藏开发者面板（RAY-297）：页面底部版本号连点 5 次解锁「开发者」分组
 *   （再次连点 5 次折叠，解锁状态存 localStorage）；分组内为通道切换器 /
 *   构建信息 / 版本回退 / 数据库调试 / FSRS 调试 / Feature flags，
 *   信息全部构建时注入或本机读取，无联网、无埋点（详见 devPanel/）。
 * - RAY-303：「学习列表包含生词本」开关从首页移至本页（学习分组）。
 *   关闭后生词本词条从学习/复习/混合队列与到期统计中排除（词书条目不受
 *   影响）；切换后队列在下次进入复习页加载时生效。
 *
 * 导出/导入/提示状态提升到本组件（SettingsScreen）而非 SettingsMainView：
 * 进入「数据来源与许可」二级页时 SettingsMainView 卸载，进行中的导出状态与
 * 结果提示不再丢失（RAY-260 评审 nit 2）。
 *
 * 全部颜色走 design tokens（浅色/深色两套自动生效），不硬编码颜色。
 */
import { lazy, Suspense, useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import { ScreenHeader } from "../components/ScreenHeader";
import { APP_VERSION } from "../lib/appVersion";
import type { CardFont } from "../lib/cardFont";
import {
  DAILY_NEW_CARD_LIMIT_MAX,
  DAILY_NEW_CARD_LIMIT_MIN,
  isValidDailyNewCardLimit,
  readDailyNewCardLimit,
  writeDailyNewCardLimit,
} from "../lib/dailyNewCardLimit";
import { datedFilename, downloadTextFile, serializeBackup } from "../lib/download";
import { readIncludeNotebook, writeIncludeNotebook } from "../lib/notebookPreference";
import {
  isPronunciationAccent,
  isPronunciationSource,
  readPronunciationAccent,
  readPronunciationSource,
  writePronunciationAccent,
  writePronunciationSource,
} from "../lib/pronunciation";
import type { PronunciationAccent, PronunciationSource } from "../lib/pronunciation";
import { isRatingTierMode, readRatingTierMode, writeRatingTierMode } from "../lib/ratingTiers";
import type { RatingTierMode } from "../lib/ratingTiers";
import {
  isQuizDirectionPreference,
  readQuizDirectionPreference,
  writeQuizDirectionPreference,
} from "../lib/quizDirection";
import type { QuizDirectionPreference } from "../lib/quizDirection";
import { isThemePreference, type ThemePreference } from "../theme/resolve";
import { DataSourcesScreen } from "./DataSourcesScreen";
import { DeveloperPanel } from "./devPanel/DeveloperPanel";
import { createDefaultDeveloperDataProvider } from "./devPanel/data";
import type { DeveloperDataProvider } from "./devPanel/types";
import { nextTapState, readDevPanelUnlocked, writeDevPanelUnlocked } from "./devPanel/unlock";
import { FontPicker } from "./FontPicker";
import { usePersistenceStatus } from "./persistenceStatus";
import type { SettingsDataProvider } from "./types";

/**
 * 词书库页按需加载（RAY-262 Oscar 评审 suggestion 3）：词书目录与共享池
 * 约 2 MB，经 React.lazy + core 子路径拆为独立 async chunk，仅打开词书库
 * 时加载，主 bundle 不再携带词书数据。
 */
const WordbookLibraryScreen = lazy(() =>
  import("./WordbookLibraryScreen").then((module) => ({ default: module.WordbookLibraryScreen })),
);

/**
 * 扩展词包页按需加载（RAY-294）：扩展词包管理 UI 独立 chunk，
 * 仅进入扩展词包设置页时加载。
 */
const DictionaryPackagesScreen = lazy(() =>
  import("./DictionaryPackagesScreen").then((module) => ({
    default: module.DictionaryPackagesScreen,
  })),
);

/** 项目 GitHub 仓库与反馈入口（RAY-251）：纯外链跳转，不请求任何外部数据 */
const GITHUB_REPO_URL = "https://github.com/RayySummers/Lexii";
const GITHUB_ISSUES_URL = "https://github.com/RayySummers/Lexii/issues";

export interface SettingsScreenProps {
  provider: SettingsDataProvider;
  onExit(): void;
  /** 主题偏好（RAY-261：App 级 useTheme 单一数据源，本页仅选择与回调，不自行持久化） */
  themePreference: ThemePreference;
  onThemePreferenceChange(preference: ThemePreference): void;
  /** 卡片字体（RAY-323：App 级 useCardFont 单一数据源，本页仅选择与回调，不自行持久化） */
  cardFont: CardFont;
  onCardFontChange(font: CardFont): void;
  /** 开发者面板数据源工厂（RAY-297：默认浏览器 IndexedDB；测试注入 mock，解锁时才创建） */
  developerDataProviderFactory?: () => DeveloperDataProvider;
}

/** 数据源错误 → 用户可见文案（不暴露内部实现细节） */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 读取本地文件文本（FileReader 兼容 jsdom 与各浏览器） */
function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.readAsText(file);
  });
}

export function SettingsScreen({
  provider,
  onExit,
  themePreference,
  onThemePreferenceChange,
  cardFont,
  onCardFontChange,
  developerDataProviderFactory = createDefaultDeveloperDataProvider,
}: SettingsScreenProps) {
  // 二级视图分发（hooks 规则：主视图的全部 hooks 在 SettingsMainView 内，此处仅一个 state）
  const [view, setView] = useState<"main" | "licenses" | "wordbooks" | "dictionary">("main");

  // 导出/导入/提示状态提升到本层（RAY-260 评审 nit 2）：二级页切换时
  // SettingsMainView 卸载，进行中的导出与结果提示不再随卸载丢失。
  const [exporting, setExporting] = useState<"json" | "csv" | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 每日新卡上限输入（初始值读 localStorage；文本态随输入走，合法值即时持久化）
  const [newCardLimitText, setNewCardLimitText] = useState(() => String(readDailyNewCardLimit()));
  // 评分档位（RAY-265：三档默认，可切四档）、发音口音（美/英）与
  // 发音源（RAY-324：系统 / 线上），与每日新卡上限同一 localStorage
  // 持久化模式；选单只产出合法值。
  const [ratingTier, setRatingTier] = useState<RatingTierMode>(() => readRatingTierMode());
  const [pronunciationAccent, setPronunciationAccent] = useState<PronunciationAccent>(() =>
    readPronunciationAccent(),
  );
  const [pronunciationSource, setPronunciationSource] = useState<PronunciationSource>(() =>
    readPronunciationSource(),
  );
  // 选择题出题方向（RAY-293：英译中 / 中译英 / 混合），同一 localStorage 持久化模式
  const [quizDirection, setQuizDirection] = useState<QuizDirectionPreference>(() =>
    readQuizDirectionPreference(),
  );
  // 生词本开关（RAY-284 / RAY-303）：学习列表是否包含生词本（默认开），
  // 从首页移至设置页（学习分组）；切换写回 localStorage，队列在下次进入
  // 复习页加载时生效。
  const [includeNotebook, setIncludeNotebook] = useState<boolean>(() => readIncludeNotebook());
  // 开发者面板连点状态（RAY-297：版本号连点 N 次解锁/折叠；初始解锁态读 localStorage）
  const [devPanelTapState, setDevPanelTapState] = useState(() => ({
    unlocked: readDevPanelUnlocked(),
    taps: 0,
    lastTapAt: 0,
  }));

  const handleExportJson = useCallback(async () => {
    setExporting("json");
    setError(null);
    setNotice(null);
    try {
      const data = await provider.exportBackup();
      downloadTextFile(
        datedFilename("lexii-backup", "json"),
        serializeBackup(data),
        "application/json",
      );
      setNotice("已导出 JSON 完整备份。");
    } catch (err) {
      setError(`导出失败：${toErrorMessage(err)}`);
    } finally {
      setExporting(null);
    }
  }, [provider]);

  const handleExportCsv = useCallback(async () => {
    setExporting("csv");
    setError(null);
    setNotice(null);
    try {
      const csv = await provider.exportWordlistCsv();
      downloadTextFile(datedFilename("lexii-wordlist", "csv"), csv, "text/csv;charset=utf-8");
      setNotice("已导出 CSV 词表。");
    } catch (err) {
      setError(`导出失败：${toErrorMessage(err)}`);
    } finally {
      setExporting(null);
    }
  }, [provider]);

  const handleImportFile = useCallback(
    async (file: File) => {
      setImporting(true);
      setError(null);
      setNotice(null);
      try {
        const text = await readFileAsText(file);
        const result = await provider.importBackup(text);
        setNotice(
          `已恢复 ${result.items} 个词条、${result.senses} 个义项、${result.events} 条学习记录`,
        );
      } catch (err) {
        setError(`导入失败：${toErrorMessage(err)}`);
      } finally {
        setImporting(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = ""; // 允许重复选择同一文件
        }
      }
    },
    [provider],
  );

  const handleNewCardLimitChange = useCallback((text: string) => {
    setNewCardLimitText(text);
    const value = Number(text);
    if (isValidDailyNewCardLimit(value)) {
      writeDailyNewCardLimit(value);
    }
  }, []);

  // 失焦回落（Oscar 复评 nit 1）：输入被清空或非法时不持久化，但显示文本
  // 须回落到实际生效值（存储中最近一次合法值），消除显示与生效的短暂不一致。
  const handleNewCardLimitBlur = useCallback(() => {
    setNewCardLimitText((current) => {
      const value = Number(current);
      return isValidDailyNewCardLimit(value) ? String(value) : String(readDailyNewCardLimit());
    });
  }, []);

  /** 评分档位切换（RAY-265）：选单只产出合法值，直接持久化 */
  const handleRatingTierChange = useCallback((value: string) => {
    if (isRatingTierMode(value)) {
      setRatingTier(value);
      writeRatingTierMode(value);
    }
  }, []);

  /** 发音口音切换（RAY-265）：选单只产出合法值，直接持久化 */
  const handlePronunciationAccentChange = useCallback((value: string) => {
    if (isPronunciationAccent(value)) {
      setPronunciationAccent(value);
      writePronunciationAccent(value);
    }
  }, []);

  /** 发音源切换（RAY-324）：选单只产出合法值，直接持久化 */
  const handlePronunciationSourceChange = useCallback((value: string) => {
    if (isPronunciationSource(value)) {
      setPronunciationSource(value);
      writePronunciationSource(value);
    }
  }, []);

  /** 选择题出题方向切换（RAY-293）：选单只产出合法值，直接持久化 */
  const handleQuizDirectionChange = useCallback((value: string) => {
    if (isQuizDirectionPreference(value)) {
      setQuizDirection(value);
      writeQuizDirectionPreference(value);
    }
  }, []);

  /** 生词本开关切换（RAY-284 / RAY-303）：写回 localStorage，队列在下次进入复习页时生效 */
  const handleIncludeNotebookToggle = useCallback(() => {
    setIncludeNotebook((previous) => {
      const next = !previous;
      writeIncludeNotebook(next);
      return next;
    });
  }, []);

  /**
   * 卡片字体切换（RAY-323）：选档只产出合法值（FontPicker 的 onChange 来自
   *  CARD_FONT_OPTIONS，类型已收敛）；与主题（RAY-261）同一模式——App 级
   *  useCardFont 单一数据源持有状态与持久化、DOM 同步，本页只透传回调
   *  onCardFontChange（Oscar 评审 nit：不再包一层无意义别名）。
   *  持久化与 <html data-card-font> 同步由 useCardFont 统一处理，避免两处
   *  state 漂移（评审 C-12 可维护性）。
   */

  /** 版本号连点（RAY-297）：累计 N 次翻转解锁状态并持久化；未到阈值只计数。
   *  Oscar 评审 nit 1：localStorage 写入放在 updater 外（updater 保持纯函数）。 */
  const handleVersionTap = useCallback(() => {
    const next = nextTapState(devPanelTapState, Date.now());
    if (next.unlocked !== devPanelTapState.unlocked) {
      writeDevPanelUnlocked(next.unlocked);
    }
    setDevPanelTapState(next);
  }, [devPanelTapState]);

  if (view === "licenses") {
    return <DataSourcesScreen provider={provider} onBack={() => setView("main")} />;
  }
  if (view === "wordbooks") {
    return (
      <Suspense
        fallback={
          <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
            <ScreenHeader title="词书库" onBack={() => setView("main")} backLabel="返回设置" />
            <p className="text-sm text-text-muted">正在加载词书目录…</p>
          </main>
        }
      >
        <WordbookLibraryScreen provider={provider} onBack={() => setView("main")} />
      </Suspense>
    );
  }
  if (view === "dictionary") {
    return (
      <Suspense
        fallback={
          <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
            <ScreenHeader title="扩展词包" onBack={() => setView("main")} backLabel="返回设置" />
            <p className="text-sm text-text-muted">正在加载扩展词包…</p>
          </main>
        }
      >
        <DictionaryPackagesScreen provider={provider} onBack={() => setView("main")} />
      </Suspense>
    );
  }
  return (
    <SettingsMainView
      onExit={onExit}
      onOpenLicenses={() => setView("licenses")}
      onOpenWordbooks={() => setView("wordbooks")}
      onOpenDictionary={() => setView("dictionary")}
      exporting={exporting}
      importing={importing}
      notice={notice}
      error={error}
      fileInputRef={fileInputRef}
      onExportJson={handleExportJson}
      onExportCsv={handleExportCsv}
      onImportFile={handleImportFile}
      newCardLimitText={newCardLimitText}
      onNewCardLimitChange={handleNewCardLimitChange}
      onNewCardLimitBlur={handleNewCardLimitBlur}
      ratingTier={ratingTier}
      onRatingTierChange={handleRatingTierChange}
      pronunciationAccent={pronunciationAccent}
      onPronunciationAccentChange={handlePronunciationAccentChange}
      pronunciationSource={pronunciationSource}
      onPronunciationSourceChange={handlePronunciationSourceChange}
      quizDirection={quizDirection}
      onQuizDirectionChange={handleQuizDirectionChange}
      includeNotebook={includeNotebook}
      onIncludeNotebookToggle={handleIncludeNotebookToggle}
      cardFont={cardFont}
      onCardFontChange={onCardFontChange}
      themePreference={themePreference}
      onThemePreferenceChange={onThemePreferenceChange}
      devPanelUnlocked={devPanelTapState.unlocked}
      onVersionTap={handleVersionTap}
      developerDataProviderFactory={developerDataProviderFactory}
    />
  );
}

interface SettingsMainViewProps {
  onExit(): void;
  /** 进入「数据来源与许可」二级页 */
  onOpenLicenses(): void;
  /** 进入「词书库」二级页（RAY-262） */
  onOpenWordbooks(): void;
  /** 进入「扩展词包」二级页（RAY-294） */
  onOpenDictionary(): void;
  /** 导出/导入进行态与结果提示（状态由 SettingsScreen 持有，二级页切换不丢失） */
  exporting: "json" | "csv" | null;
  importing: boolean;
  notice: string | null;
  error: string | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onExportJson(): void;
  onExportCsv(): void;
  onImportFile(file: File): void;
  /** 每日新卡上限输入框（文本态 + 变更/失焦回调；合法值由父级即时持久化，失焦回落） */
  newCardLimitText: string;
  onNewCardLimitChange(text: string): void;
  onNewCardLimitBlur(): void;
  /** 评分档位（RAY-265：三档默认 / 四档 Anki 传统） */
  ratingTier: RatingTierMode;
  onRatingTierChange(value: string): void;
  /** 发音口音（RAY-265：美式 / 英式，浏览器语音合成） */
  pronunciationAccent: PronunciationAccent;
  onPronunciationAccentChange(value: string): void;
  /** 发音源（RAY-324：系统自带 / 线上发音） */
  pronunciationSource: PronunciationSource;
  onPronunciationSourceChange(value: string): void;
  /** 选择题出题方向（RAY-293：英译中 / 中译英 / 混合） */
  quizDirection: QuizDirectionPreference;
  onQuizDirectionChange(value: string): void;
  /** 生词本开关（RAY-284 / RAY-303）：学习列表是否包含生词本 */
  includeNotebook: boolean;
  onIncludeNotebookToggle(): void;
  /** 卡片字体（RAY-323）：4 档（inter / google-sans / playpen / newsreader） */
  cardFont: CardFont;
  onCardFontChange(next: CardFont): void;
  /** 主题偏好三档（RAY-261）：App 级 useTheme 单一数据源下发 */
  themePreference: ThemePreference;
  onThemePreferenceChange(preference: ThemePreference): void;
  /** 开发者面板（RAY-297）：是否已解锁 + 版本号连点回调 + 面板数据源工厂 */
  devPanelUnlocked: boolean;
  onVersionTap(): void;
  developerDataProviderFactory: () => DeveloperDataProvider;
}

function SettingsMainView({
  onExit,
  onOpenLicenses,
  onOpenWordbooks,
  onOpenDictionary,
  exporting,
  importing,
  notice,
  error,
  fileInputRef,
  onExportJson,
  onExportCsv,
  onImportFile,
  newCardLimitText,
  onNewCardLimitChange,
  onNewCardLimitBlur,
  ratingTier,
  onRatingTierChange,
  pronunciationAccent,
  onPronunciationAccentChange,
  pronunciationSource,
  onPronunciationSourceChange,
  quizDirection,
  onQuizDirectionChange,
  includeNotebook,
  onIncludeNotebookToggle,
  cardFont,
  onCardFontChange,
  themePreference,
  onThemePreferenceChange,
  devPanelUnlocked,
  onVersionTap,
  developerDataProviderFactory,
}: SettingsMainViewProps) {
  const persistence = usePersistenceStatus();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <ScreenHeader title="设置" onBack={onExit} />

      <Section title="数据安全与备份">
        <PersistenceBanner
          status={persistence}
          onExport={onExportJson}
          exporting={exporting === "json"}
        />
        <p className="text-sm text-text-muted">
          学习数据只存本机（IndexedDB），可能因清理网站数据或卸载而丢失，建议定期导出备份。
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onExportJson}
            disabled={exporting !== null}
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exporting === "json" ? "导出中…" : "导出 JSON 完整备份"}
          </button>
          <button
            type="button"
            onClick={onExportCsv}
            disabled={exporting !== null}
            className="rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            {exporting === "csv" ? "导出中…" : "导出 CSV 词表"}
          </button>
        </div>
        <p className="text-xs text-text-muted">
          JSON 含词库、学习记录与进度，可原样导回；CSV 仅词表（词条 / 释义 / 词性），不含学习进度。
        </p>
      </Section>

      <Section title="导入数据">
        <p className="text-sm text-text-muted">
          从之前导出的 JSON 备份恢复数据（同 ID 记录会被覆盖）。
        </p>
        <input
          ref={fileInputRef}
          id="import-backup-input"
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void onImportFile(file);
            }
          }}
        />
        <label
          htmlFor="import-backup-input"
          className="inline-flex w-fit cursor-pointer rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:border-primary focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring"
        >
          {importing ? "正在恢复…" : "选择备份文件…"}
        </label>
      </Section>

      <Section title="外观">
        <label
          htmlFor="theme-preference"
          className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <span>
            主题
            <span className="mt-1 block text-xs text-text-muted">
              浅色、深色或跟随系统（随设备主题自动切换）。
            </span>
          </span>
          <select
            id="theme-preference"
            value={themePreference}
            onChange={(event) => {
              if (isThemePreference(event.target.value)) {
                onThemePreferenceChange(event.target.value);
              }
            }}
            className="w-40 rounded-full border border-border bg-surface px-4 py-2 text-sm text-text transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <option value="light">浅色</option>
            <option value="dark">深色</option>
            <option value="system">跟随系统</option>
          </select>
        </label>
        {/* 卡片字体（RAY-323）：2×2 卡片选单，每张以对应字体渲染示例单词，
            让用户选择前直接看到字面特征；选档立即持久化并同步到复习卡 */}
        <div className="flex flex-col gap-2">
          <div>
            <span className="text-sm font-semibold">卡片字体</span>
            <span className="mt-1 block text-xs text-text-muted">
              复习卡上单词本体的字体（4 档可选，选档立即生效）。
            </span>
          </div>
          <FontPicker value={cardFont} onChange={onCardFontChange} groupLabel="卡片字体" />
        </div>
      </Section>

      <Section title="学习">
        <label
          htmlFor="daily-new-card-limit"
          className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <span>
            每日新卡上限
            <span className="mt-1 block text-xs text-text-muted">
              每天最多学习的新词数（1–999，默认 20）；超出部分顺延到之后的日子，复习不受限制。
            </span>
          </span>
          <input
            id="daily-new-card-limit"
            type="number"
            inputMode="numeric"
            min={DAILY_NEW_CARD_LIMIT_MIN}
            max={DAILY_NEW_CARD_LIMIT_MAX}
            step={1}
            value={newCardLimitText}
            onChange={(event) => onNewCardLimitChange(event.target.value)}
            onBlur={onNewCardLimitBlur}
            className="w-28 rounded-full border border-border bg-surface px-4 py-2 text-sm text-text transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          />
        </label>
        <label
          htmlFor="rating-tiers"
          className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <span>
            评分档位
            <span className="mt-1 block text-xs text-text-muted">
              默认三档（认识 / 模糊 / 不认识）；可选四档（Anki 传统，含 Easy）。
            </span>
          </span>
          <select
            id="rating-tiers"
            value={ratingTier}
            onChange={(event) => onRatingTierChange(event.target.value)}
            className="w-40 rounded-full border border-border bg-surface px-4 py-2 text-sm text-text transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <option value="three">三档（默认）</option>
            <option value="four">四档（Anki 传统）</option>
          </select>
        </label>
        <label
          htmlFor="pronunciation-accent"
          className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <span>
            发音口音
            <span className="mt-1 block text-xs text-text-muted">
              美式 / 英式；同时影响系统与线上两种发音源。
            </span>
          </span>
          <select
            id="pronunciation-accent"
            value={pronunciationAccent}
            onChange={(event) => onPronunciationAccentChange(event.target.value)}
            className="w-40 rounded-full border border-border bg-surface px-4 py-2 text-sm text-text transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <option value="us">美式</option>
            <option value="uk">英式</option>
          </select>
        </label>
        {/* 发音源选择（RAY-324）：系统自带 vs 线上发音；线上失败自动回落系统 */}
        <label
          htmlFor="pronunciation-source"
          className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <span>
            发音源
            <span className="mt-1 block text-xs text-text-muted">
              系统自带：浏览器语音合成，离线可用；线上发音：词典真人录音与在线合成（需联网），
              发音更标准清晰，失败时自动回落系统语音。
            </span>
          </span>
          <select
            id="pronunciation-source"
            value={pronunciationSource}
            onChange={(event) => onPronunciationSourceChange(event.target.value)}
            className="w-40 rounded-full border border-border bg-surface px-4 py-2 text-sm text-text transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <option value="system">系统自带</option>
            <option value="online">线上发音</option>
          </select>
        </label>
        <label
          htmlFor="quiz-direction"
          className="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <span>
            选择题出题方向
            <span className="mt-1 block text-xs text-text-muted">
              英译中：看单词选释义；中译英：看释义选单词；混合：每道题随机方向。
            </span>
          </span>
          <select
            id="quiz-direction"
            value={quizDirection}
            onChange={(event) => onQuizDirectionChange(event.target.value)}
            className="w-40 rounded-full border border-border bg-surface px-4 py-2 text-sm text-text transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <option value="en-zh">英译中</option>
            <option value="zh-en">中译英</option>
            <option value="mixed">混合</option>
          </select>
        </label>
        {/* 生词本开关（RAY-284 / RAY-303）：从首页移至设置页学习分组；N1 用 label 包裹保持一致 */}
        <label className="flex items-start justify-between gap-4">
          <span>
            <span className="text-sm font-semibold">学习队列包含生词本</span>
            <span className="mt-1 block text-xs text-text-muted">
              关闭后，生词本的词不再进入学习 / 复习 / 混合队列，词书不受影响。
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={includeNotebook}
            aria-label="学习队列是否包含生词本"
            onClick={onIncludeNotebookToggle}
            className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
              includeNotebook ? "border-primary bg-primary" : "border-border bg-surface-raised"
            }`}
          >
            <span
              aria-hidden="true"
              className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-primary-contrast transition-all ${
                includeNotebook ? "left-[calc(100%-1.25rem)]" : "left-1"
              }`}
            />
          </button>
        </label>
      </Section>

      <Section title="词书库">
        <p className="text-sm text-text-muted">
          考试分级词书（中考 / 高考 / 四六级 / 考研 / 托福 / 雅思 / GRE
          与冲刺词书）随应用内置，按需选装、全程离线；与已学词条相同的词会自动跳过。
        </p>
        <button
          type="button"
          onClick={onOpenWordbooks}
          className="w-fit rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          浏览并安装词书
        </button>
      </Section>

      <Section title="扩展词包">
        <p className="text-sm text-text-muted">
          下载 Tier 1/2 扩展词包（需联网，下载后可离线使用），将词典检索范围从内置 7,195 词扩展到
          ECDICT 全量覆盖（如 kaleidoscope、menstrual 等 Tier 0 未收录词均可搜到）。
          词包仅扩充检索层，加入词书/生词本后才进入学习队列。
        </p>
        <button
          type="button"
          onClick={onOpenDictionary}
          className="w-fit rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          管理扩展词包
        </button>
      </Section>

      <Section title="数据来源与许可">
        <p className="text-sm text-text-muted">
          预设词表由开源数据（ECDICT、NGSL 1.2）清洗打包，随应用内置、离线可用。
        </p>
        <button
          type="button"
          onClick={onOpenLicenses}
          className="w-fit rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          查看数据来源与许可
        </button>
      </Section>

      <Section title="关于">
        <p className="text-sm text-text-muted">
          乐希 Lexii 是开源软件（local-first，学习数据只存本机）。欢迎在 GitHub
          上查看源码、反馈问题或提出建议。
        </p>
        {/* 规格称「反馈问题」为按钮，这里实现为按钮样式的语义化 <a>（RAY-251 评审
            nit 已确认）：外链跳转场景下 <a> 保留中键新开、复制链接、无 JS 降级等
            原生链接能力，视觉与交互样式与主/次按钮一致。勿改回 <button> + window.open。 */}
        <div className="flex flex-col gap-3 sm:flex-row">
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center rounded-full border border-border bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            GitHub 仓库
          </a>
          <a
            href={GITHUB_ISSUES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            反馈问题
          </a>
        </div>
      </Section>

      {devPanelUnlocked ? <DeveloperPanel providerFactory={developerDataProviderFactory} /> : null}

      <div aria-live="polite">
        {notice ? (
          <p
            role="status"
            className="rounded-xl border border-border bg-surface p-4 text-sm text-success"
          >
            {notice}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-xl border border-danger/40 bg-surface p-4 text-sm text-text"
          >
            {error}
          </p>
        ) : null}
      </div>

      {/* RAY-297：版本号为隐藏彩蛋入口——连点 5 次解锁「开发者」分组，
          再次连点 5 次折叠；解锁状态存 localStorage。样式上仍是普通脚注文本，
          但语义上可点（按钮），键盘可聚焦、可用（无障碍不破坏）。 */}
      <footer className="border-t border-border pt-4 text-center">
        <button
          type="button"
          onClick={onVersionTap}
          className="rounded-full px-3 py-1 text-xs text-text-muted transition-colors hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          乐希 Lexii v{APP_VERSION}
        </button>
      </footer>
    </main>
  );
}

/** 设置分组容器 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** 持久化提示：denied 时警告并直达导出；persisted/granted 时静默确认；其余不渲染 */
function PersistenceBanner({
  status,
  onExport,
  exporting,
}: {
  status: ReturnType<typeof usePersistenceStatus>;
  onExport(): void;
  exporting: boolean;
}) {
  if (status === "denied") {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-accent/40 bg-surface p-4">
        <p className="text-sm">当前数据可能被浏览器清理，建议导出备份。</p>
        <button
          type="button"
          onClick={onExport}
          disabled={exporting}
          className="w-fit rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-contrast transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          {exporting ? "导出中…" : "导出 JSON 备份"}
        </button>
      </div>
    );
  }
  if (status === "persisted" || status === "granted") {
    return <p className="text-sm text-text-muted">本地数据已受浏览器持久化保护。</p>;
  }
  return null;
}
