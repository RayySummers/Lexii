/**
 * 设置页数据源（IndexedDB 实现）。
 *
 * 所有数据操作经由 @lexilexi/core 的公开 API：
 * - exportBackup：exportLexilexiData（完整 JSON 快照）
 * - exportWordlistCsv：exportCsvWordlist（词表 CSV，仅未删除条目）
 * - importBackup：parseLexilexiExport → importLexilexiData（单事务、同 id 覆盖）
 * - getPresetSummaries：内置词表安装状态（RAY-258「数据来源与许可」页）
 * - getWordbookSummaries / installWordbook：词书库状态与选装（RAY-262；
 *   词书目录与共享池来自 @lexilexi/core 的 WORDBOOK_CATALOG / getWordbookPackage，
 *   安装落库复用 installPreset 的分块/可恢复/幂等/按 term 去重能力）
 * - RAY-294 扩展词包：getDictionaryPackageSummaries / fetchDictionaryManifest /
 *   installDictionaryPackage / markTier1CoveredByTier2
 *
 * RAY-253 反馈 6：loadOverview（数据概览）已随设置页概览区删除。
 */
import {
  detectDecompression,
  downloadAndVerifyPackage,
  exportCsvWordlist,
  exportLexilexiData,
  fetchManifest,
  getDictionaryPackageState,
  getPresetInstallState,
  importLexilexiData,
  installDictionaryPackage as coreInstallDictionaryPackage,
  installPreset,
  markTier1CoveredByTier2 as coreMarkTier1CoveredByTier2,
  openDatabase,
  parseLexilexiExport,
  TIER0_PRESET,
} from "@lexilexi/core";
import type {
  DictionaryManifest,
  LexilexiDatabase,
  LexilexiExportData,
  PresetPackage,
  WordbookDefinition,
} from "@lexilexi/core";
import type {
  DictionaryInstallResult,
  DictionaryManifestInfo,
  DictionaryPackageSummary,
  ImportBackupResult,
  PresetSummary,
  SettingsDataProvider,
  WordbookInstallResult,
  WordbookSummary,
} from "./types";

/** 随包内置的预设词表（Tier 0；未来扩展包接入时在此登记） */
const BUNDLED_PRESETS: readonly PresetPackage[] = [TIER0_PRESET];

// ─── RAY-294 扩展词包定义 ────────────────────────────────────────────────────

/** 扩展词包定义（稳定标识 + 面向用户名称 + 词条总数） */
const DICTIONARY_PACKAGES: readonly {
  id: string;
  name: string;
  totalCount: number;
}[] = [
  { id: "core-en-tier1", name: "Tier 1 标准词包", totalCount: 58_244 },
  { id: "core-en-tier2", name: "Tier 2 全量词包", totalCount: 401_222 },
];

/**
 * manifest 相对路径（与 SW 排除口径一致：resolveUrl("./presets/manifest.json")）。
 *
 * RAY-294 Phase 3：默认从当前部署的 presets/ 路径获取（GitHub Pages 子路径兼容）。
 * 可通过环境变量 LEXILEXI_MANIFEST_URL 覆盖（如指向 GitHub Releases 的绝对 URL）。
 * 启动时不发任何网络请求——仅用户进入扩展词包设置页时触发。
 */
function getManifestUrl(): string {
  // 构建时注入的绝对 URL（可选，指向 GitHub Releases 等外部源）
  const injected = import.meta.env.VITE_MANIFEST_URL as string | undefined;
  if (injected) {
    return injected;
  }
  // 默认：相对路径，兼容 Pages 子路径部署（rayysummers.github.io/Lexilexi/presets/）
  return new URL("./presets/manifest.json", window.location.href).href;
}

/**
 * 词书模块按需加载（RAY-262 Oscar 评审 suggestion 3）：词书目录与共享池
 * 约 2 MB，经 "@lexilexi/core/presets/books" 子路径 + 动态 import 拆为
 * 独立 async chunk，只有打开词书库 / 安装词书时才加载，主 bundle 不再
 * 携带词书数据（tier0 数据仍随主 bundle，首启安装依赖）。
 */
type WordbookModule = typeof import("@lexilexi/core/presets/books");

let wordbookModulePromise: Promise<WordbookModule> | null = null;

function loadWordbookModule(): Promise<WordbookModule> {
  wordbookModulePromise ??= import("@lexilexi/core/presets/books");
  return wordbookModulePromise;
}

/**
 * 富化数据包按需加载（RAY-276 修复范围 2）：
 * 词书库安装的词条与 Tier 0 内置词表同口径内联填充富化字段
 * （只补缺失字段，见 @lexilexi/core 的 mergeEnrichmentIntoContent）。
 * 安装后立即受益，不依赖下一次富化包版本递增触发回填。
 * 3.6MB 数据包仅在用户安装词书时装载（与词书数据 chunk 同策略）。
 */
type EnrichmentModule = typeof import("@lexilexi/core/presets/enrichment");

let enrichmentModulePromise: Promise<EnrichmentModule> | null = null;

function loadEnrichmentModule(): Promise<EnrichmentModule> {
  enrichmentModulePromise ??= import("@lexilexi/core/presets/enrichment");
  return enrichmentModulePromise;
}

/** 词书包惰性缓存：首次访问时 join 共享池（9k+ 词条目引用），避免轮询反复构造 */
const wordbookPackageCache = new Map<string, PresetPackage>();

async function getCachedWordbookPackage(book: WordbookDefinition): Promise<PresetPackage> {
  let preset = wordbookPackageCache.get(book.id);
  if (!preset) {
    const { getWordbookPackage } = await loadWordbookModule();
    preset = getWordbookPackage(book);
    wordbookPackageCache.set(book.id, preset);
  }
  return preset;
}

/** 基于已打开的 Lexilexi 数据库创建设置页数据源（测试注入 fake-indexeddb 实例） */
export function createIndexedDbSettingsDataProvider(db: LexilexiDatabase): SettingsDataProvider {
  return {
    async exportBackup(): Promise<LexilexiExportData> {
      return exportLexilexiData(db, new Date().toISOString());
    },

    async exportWordlistCsv(): Promise<string> {
      return exportCsvWordlist(db);
    },

    async importBackup(jsonText: string): Promise<ImportBackupResult> {
      const data = parseLexilexiExport(jsonText);
      await importLexilexiData(db, data);
      return {
        items: data.items.length,
        senses: data.senses.length,
        memoryStates: data.memoryStates.length,
        events: data.events.length,
      };
    },

    async getPresetSummaries(): Promise<PresetSummary[]> {
      return Promise.all(
        BUNDLED_PRESETS.map(async (preset) => {
          const state = await getPresetInstallState(db, preset);
          return {
            id: state.presetId,
            name: preset.name,
            status: state.status,
            installedCount: state.installedCount,
            totalCount: state.totalCount,
            ...(state.installedVersion ? { installedVersion: state.installedVersion } : {}),
          };
        }),
      );
    },

    async getWordbookSummaries(): Promise<WordbookSummary[]> {
      const { WORDBOOK_CATALOG } = await loadWordbookModule();
      return Promise.all(
        WORDBOOK_CATALOG.map(async (book) => {
          const state = await getPresetInstallState(db, await getCachedWordbookPackage(book));
          return {
            id: state.presetId,
            status: state.status,
            installedCount: state.installedCount,
            totalCount: state.totalCount,
            ...(state.installedVersion ? { installedVersion: state.installedVersion } : {}),
          };
        }),
      );
    },

    async installWordbook(bookId: string): Promise<WordbookInstallResult> {
      const { WORDBOOK_CATALOG } = await loadWordbookModule();
      const book = WORDBOOK_CATALOG.find((candidate) => candidate.id === bookId);
      if (!book) {
        throw new Error(`未知词书：${bookId}`);
      }
      // 富化内联（RAY-276 修复范围 2）：安装时按 term 补富化字段——
      // 与 Tier 0 新装路径同口径，安装即生效；覆盖不到的词条（如 GRE
      // 剔除词）不受影响，只补缺失字段、不覆盖已有内容。
      const { ENRICHMENT_TIER0_PRESET } = await loadEnrichmentModule();
      const result = await installPreset(db, await getCachedWordbookPackage(book), {
        enrichment: ENRICHMENT_TIER0_PRESET,
      });
      if (result.status === "already-installed") {
        return { installedCount: 0, skippedCount: 0 };
      }
      return { installedCount: result.installedCount, skippedCount: result.skippedCount };
    },

    // ─── RAY-294 扩展词包 ─────────────────────────────────────────────────

    async getDictionaryPackageSummaries(): Promise<DictionaryPackageSummary[]> {
      return Promise.all(
        DICTIONARY_PACKAGES.map(async (pkg) => {
          const state = await getDictionaryPackageState(db, pkg.id, pkg.totalCount);
          return {
            id: state.packageId,
            name: pkg.name,
            status: state.status,
            installedCount: state.installedCount,
            totalCount: state.totalCount,
            ...(state.installedVersion ? { installedVersion: state.installedVersion } : {}),
          };
        }),
      );
    },

    async fetchDictionaryManifest(): Promise<DictionaryManifestInfo[] | null> {
      try {
        const manifest: DictionaryManifest = await fetchManifest(getManifestUrl());
        // 按浏览器实际解压能力选择 variant（§5.2/§5.3 降级矩阵）
        const encoding = await detectDecompression();
        return manifest.packages.map((pkg) => {
          const variant = pkg.variants[encoding] ?? pkg.variants.gzip ?? pkg.variants.raw;
          return {
            id: pkg.id,
            version: pkg.version,
            sourceCommit: pkg.sourceCommit,
            ...(variant
              ? {
                  bestVariant: {
                    url: variant.url,
                    size: variant.size,
                    sha256: variant.sha256,
                  },
                }
              : {}),
          };
        });
      } catch (err: unknown) {
        // 区分错误类型：网络错误 vs 格式错误（供 UI 展示更精确的提示）
        if (err instanceof Error && err.message.includes("manifest 格式非法")) {
          // 格式错误：manifest 文件损坏或版本不兼容，静默返回 null
          console.warn("manifest 格式异常：", err.message);
        } else if (err instanceof TypeError) {
          // 网络错误（fetch 失败、CORS 等）
          console.warn("manifest 网络不可达");
        }
        return null;
      }
    },

    async installDictionaryPackage(
      packageId: string,
      signal?: AbortSignal,
    ): Promise<DictionaryInstallResult> {
      // 查找包定义
      const pkgDef = DICTIONARY_PACKAGES.find((p) => p.id === packageId);
      if (!pkgDef) {
        throw new Error(`未知扩展词包：${packageId}`);
      }

      // 检查取消
      if (signal?.aborted) {
        throw new DOMException("下载已取消", "AbortError");
      }

      // 获取 manifest 中的包信息
      const manifestInfos = await this.fetchDictionaryManifest();
      if (!manifestInfos) {
        throw new Error("无法获取词包 manifest，请检查网络连接");
      }
      const manifestInfo = manifestInfos.find((info) => info.id === packageId);
      if (!manifestInfo?.bestVariant) {
        throw new Error(`manifest 中未找到词包 ${packageId} 的下载信息`);
      }

      // 再次检查取消
      if (signal?.aborted) {
        throw new DOMException("下载已取消", "AbortError");
      }

      // 下载 + 校验 + 解压（signal 传递给 fetch，下载中途可中止）
      const entries = await downloadAndVerifyPackage(manifestInfo.bestVariant, signal);

      // 安装前检查取消
      if (signal?.aborted) {
        throw new DOMException("安装已取消", "AbortError");
      }

      // 安装到 dictionarySenses 表（signal 传递给安装循环，块间可中止）
      const result = await coreInstallDictionaryPackage(
        db,
        {
          id: packageId,
          version: manifestInfo.version,
          name: pkgDef.name,
          lang: "en",
          entries,
        },
        { signal },
      );

      if (result.status === "already-installed") {
        return { status: "already-installed", installedVersion: result.installedVersion };
      }
      return {
        status: "installed",
        installedCount: result.installedCount,
        skippedCount: result.skippedCount,
        updatedCount: result.updatedCount,
        deletedCount: result.deletedCount,
      };
    },

    async markTier1CoveredByTier2(): Promise<void> {
      return coreMarkTier1CoveredByTier2(db);
    },
  };
}

/**
 * 浏览器默认数据源：打开真实 IndexedDB（window.indexedDB）。
 * 仅可在浏览器环境调用；测试通过注入 mock / fake-indexeddb 实例绕过。
 */
export function createDefaultSettingsDataProvider(): SettingsDataProvider {
  return createIndexedDbSettingsDataProvider(openDatabase());
}
