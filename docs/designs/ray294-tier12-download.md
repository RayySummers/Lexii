# RAY-294 Tier 1/2 扩展词包离线下载技术方案

> 版本：draft-3（Harvey，2026-08-16）— 基于 Oscar 复审 `edd1178c` suggestion + nit 落实
> 状态：已通过 Oscar 复审（draft-2 放行），本版落实实施前清单 + nit
> 前置依赖：RAY-257/258 分级口径（已定）、RAY-262 词书库（已定）、RAY-266 搜词排序口径（已定）、RAY-276 版本升级先例（已定）、RAY-284 生词本（已定）

---

## 0. 目标与范围

**目标**：用户可在应用内主动下载 Tier 1（58,244 词）/ Tier 2（401,222 词）扩展词包，离线检索覆盖 ECDICT 全量词条（如 kaleidoscope / menstrual 等 Tier 0 未收录词）。

**非目标**：本方案不改变 Tier 0 内置词表（7,195 词）的打包/安装路径；不引入网络请求（全程离线 local-first）；不涉及学习调度变更。

**与 RAY-284「加词入口」的边界**：Tier 1/2 词包仅扩充**词典检索层**（只读数据），用户在搜词结果中看到扩展词条后，可选择「加入词书/生词本」——此操作走 RAY-284 的 `addToNotebook` 路径（创建 LearningItem + MemoryState + Event），将词条从词典层「晋升」为学习数据。本方案不修改 `addToNotebook`，只保证晋升时 Sense 已存在于词典层。

---

## 1. 存储形态

### 1.1 现状分析

| 表             | 现有用途                           | Tier 2 装入后影响                            |
| -------------- | ---------------------------------- | -------------------------------------------- |
| `senses`       | 学习义项（Tier 0 词书 + 用户导入） | 40 万+ 条，term 索引可承受，但与学习四表耦合 |
| `items`        | LearningItem（调度载体）           | **不应**为词典条目创建                       |
| `memoryStates` | FSRS 记忆状态                      | **不应**为词典条目创建                       |
| `events`       | 学习事件                           | **不应**为词典条目创建                       |

Oscar 评审指出：按 `installPreset` 路径装 Tier 2 → 401,222 × 4 = **~160 万条 IDB 记录、~1,000 个分块事务**；复习队列按 `due` 索引取数 → 40 万张新卡涌入「今日待学」；统计页、导出备份同步爆炸。

### 1.2 方案：独立词典表 `dictionarySenses`

**Dexie schema v6**（纯新增表，无数据迁移，存量数据原样保留）：

```
db.version(6).stores({
  items: "id",
  senses: "id, term",           // 不变
  memoryStates: "id, fields.due",
  events: "id, time, type",
  meta: "key",
  notebookEntries: "id, senseId, status",
  dictionarySenses: "id, term, source", // 新增：词典检索层（只读）；source 索引供增量替换删除检测
});
```

**数据模型**：`DictionarySense` 为独立类型（不复用 `Sense`——现有 `Sense` 类型无 `source` 字段，已核实 `domain.ts`），扩展为 `Sense & { source: string }`（或独立字段，Phase 1 PR 中按实际类型体系统一）：

- `source`：所属包标识（如 `"core-en-tier1"` / `"core-en-tier2"`），写入 IDB 时附带，供增量替换按 source 范围删除；
- 不产生 `LearningItem` / `MemoryState` / `Event`；
- 仅用于检索，不参与复习队列、统计、导出（`exportLexilexiData` 不导出此表）。

**安装函数**：`installDictionaryPackage`（新函数，不复用 `installPreset`），每词条仅写 1 条 `dictionarySense` 记录（vs `installPreset` 的 4 条），分块 400、可恢复、幂等、并发安全——沿用 `installPreset` 的 progress + done + check-and-set 三件套。

**晋升路径**（与 RAY-284 衔接）：

```
用户在搜词结果页看到 Tier 1/2 词条
  → 点击「加入词书/生词本」
    → RAY-284 addToNotebook(senseId)
      → 从 senses 表取 Sense（若 senses 表无该条目，先 promote，再继续）
        → 创建 LearningItem + MemoryState + Event（晋升完成）
```

具体衔接：`addToNotebook` 的 sense 查找逻辑扩展为 **senses 表优先 → dictionarySenses 表兜底**；若从 dictionarySenses 命中，调用 `promoteDictionarySense` 将词条复制到 senses 表（此时该词才真正进入学习四表的关联域），再走正常流程。此变更由 RAY-284 实现，本方案只保证 dictionarySenses 表存在且可读。

**promote 生成新 SenseId**：`promoteDictionarySense` 从 dictionarySenses 复制到 senses 表时，**新生成 SenseId**（不复用字典条目 id），避免与词典条目 id 命名空间冲突。字典条目保留原 id 不变（仍可通过 dictionarySenses 检索），senses 表副本使用独立 id（与 `importCsvWordlist` / `installPreset` 新建 Sense 的 id 生成方式一致）。

**导出/备份**：`dictionarySenses` **不随 `exportLexilexiData` 导出**——它属于可重建的下载数据，不属于用户学习数据。备份恢复到新设备后需重新下载扩展包（安装幂等，done 标记已含版本，重装无副作用）。已晋升到 senses 表的副本属于学习数据，正常随导出/备份。

---

## 2. 检索路径

### 2.1 现状分析

`searchLexilexiSenses`（`packages/core/src/search.ts`）当前实现：

```typescript
const senses = await db.senses.toArray(); // 全量读入内存
return searchSenses(senses, query, options); // 内存过滤+排序
```

Tier 0（7,195 条）：可行。Tier 1/2 安装后 senses + dictionarySenses 合计 **~40 万条**：全量 `toArray()` 内存不可接受（~100 MB+），且每次击键执行。

### 2.2 方案：全局合并检索 + 索引化

**新增函数** `searchAllSenses(db, query, options)`：从 senses + dictionarySenses 两层完整取回命中结果 → 按 term（大小写不敏感）去重、学习义项优先 → 同一比较器全局排序 → 截断 `DEFAULT_SEARCH_LIMIT`。

**检索策略**（三种命中类型，与 RAY-266 口径完全一致）：

| 命中类型                 | 检索方式                                                       | 数据源         |
| ------------------------ | -------------------------------------------------------------- | -------------- |
| `term-prefix`（前缀）    | `where("term").startsWithIgnoreCase(q)` → IDB 索引区间查询     | 各表 term 索引 |
| `term-substring`（子串） | 全量 `toArray()` → 内存 `term.includes(q)`                     | 各表全量       |
| `definition`（释义）     | 全量 `toArray()` → 内存 `definitions.some(d => d.includes(q))` | 各表全量       |

**前缀命中**：Dexie `startsWithIgnoreCase` 底层走 IDB `IDBKeyRange.bound(q.toLowerCase(), q.toLowerCase() + '\uffff')`，O(log N) 索引定位，40 万条毫秒级返回。此路径覆盖最常见用户输入（输入前几个字母）。

**子串命中**：**全量内存扫描，不按首字母裁剪**。按首字母裁剪会丢失词中命中（如搜 `scope` 时 `microscope` / `kaleidoscope` / `telescope` 的首字母 m/k/t 均不匹配——RAY-294 的动机词 `kaleidoscope` 恰是此类）。正确做法：

```typescript
// 子串命中：全量取回 → 内存 includes（RAY-266 口径：词条任意位置子串）
const allTerms = await db.dictionarySenses.toArray(); // ~40 万条
const hits = allTerms.filter((sense) => sense.term.toLowerCase().includes(q));
```

**性能预算**：dictionarySenses 表 40 万条，每条 ~200 字节，全量 `toArray()` ≈ 80 MB 内存、~200–500 ms（IDB 读取）；内存 `includes` 过滤 ~10–50 ms。总耗时 ~300–600 ms，可接受（实测目标 < 500 ms）。

**优化**：采用**模块级单例**缓存（非 `WeakRef`——`WeakRef` 在 GC 不确定时可能导致缓存意外失效，且搜索屏生命周期内缓存应稳定存在）。缓存使用单一键 `_all` 合并所有已装包的全量 `DictionarySense[]`（因子串/释义扫描需全量数据），后续击键查询直接走内存过滤，不重复读 IDB。

**缓存失效**：扩展包安装/卸载/升级时全量清除缓存（`cache.clear()`）；`invalidateDictionaryCache()` 在安装/升级完成后由内部调用。

**跨标签页限制**：模块级单例是 per-tab 的，另一标签页安装/升级后本页缓存仍旧。刷新后生效。后续可按 focus/版本探测刷新。

**低内存设备降级**：前缀命中路径不依赖缓存（直接走 IDB 索引查询 `startsWithIgnoreCase`，O(log N)），在缓存未加载或被清除时仍可用；子串/释义命中路径在缓存未命中时回退到按需 `toArray()`（首次击键 200–500 ms，与无缓存时一致）。低内存设备可选择不预热缓存（`installDictionaryPackage` 完成后不主动加载），仅在用户输入 ≥ 2 字符时按需加载。

**释义命中**：与子串命中同理，全量 `toArray()` → 内存过滤 `definitions.some(d => d.toLowerCase().includes(q))`。释义命中天然走全量扫描（无 IDB 索引可用于释义字段的子串查询），无需辅助索引。

### 2.3 跨表合并口径（与 RAY-266 完全一致）

两层**完整取回** → 同一比较器**全局排序** → 截断 `DEFAULT_SEARCH_LIMIT`（不得分层 top-N 后拼接，否则会破坏全局排序——senses 层的释义命中可能排在 dictionary 层的前缀命中之前）。

```typescript
export async function searchAllSenses(
  db: LexilexiDatabase,
  query: string,
  options: SenseSearchOptions = {},
): Promise<SenseSearchHit[]> {
  const q = query.trim().toLowerCase().slice(0, MAX_QUERY_LENGTH);
  if (q.length === 0) return [];
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;

  // 两层并行取回（学习表通常很小，词典表可能很大）
  const [learningHits, dictHits] = await Promise.all([
    searchLexilexiSenses(db, q, { limit: 0 }), // 不截断，取全部命中
    searchDictionarySenses(db, q, { limit: 0 }),
  ]);

  // 按 term（大小写不敏感）去重，学习义项优先
  const seen = new Map<string, SenseSearchHit>(); // lowercased term → hit
  for (const hit of learningHits) {
    seen.set(hit.sense.term.toLowerCase(), hit);
  }
  for (const hit of dictHits) {
    const key = hit.sense.term.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, hit);
    }
    // 学习义项已存在 → 跳过词典义项（学习义项优先）
  }

  // 全局排序 → 截断
  const merged = [...seen.values()];
  merged.sort(compareHits);
  return limit > 0 ? merged.slice(0, limit) : merged;
}
```

**去重规则**：

- **层内**（senses 表或 dictionarySenses 表各自内部）：按 `sense.id` 去重（与 RAY-266 现有口径一致——senses 表内可存在同 term 多个 Sense，如 CSV 导入不去重，已核实 `importWords.ts` 无 term 查重，RAY-266 按 `sense.id` 去重各显一条）；
- **跨层**（dictionarySenses ↔ senses）：按 **term（大小写不敏感）** 去重、学习义项优先（senses 表晋升后副本的 id 与 dictionarySenses 不同，但 term 相同，保留学习版本）。

**预算**（实测目标）：

- 前缀命中（最常见）：< 50 ms（IDB 索引查询，两表各一次）；
- 子串命中（2+ 字母）：< 500 ms（两表各一次全量 toArray + 内存过滤，含首次缓存加载）；后续击键 < 50 ms（内存缓存命中）；
- 释义命中：< 500 ms（同子串命中路径）。

---

## 3. 版本升级

### 3.1 现状分析

现有 `preset:<id>:done` 标记存储的是 `preset.version` 字符串，但 `installPreset` 只做 `if (done) return already-installed`——无版本比较、无升级逻辑。

### 3.2 方案：done 标记带版本、版本失配触发增量替换

泛化 RAY-276 先例（`preset:<id>:done` 值即为版本号，已具备）：

```typescript
// installDictionaryPackage 的完成检查
const done = await db.meta.get(dictionaryDoneKey(packageId));
if (done) {
  if (done.value === packageVersion) {
    return { status: "already-installed", installedVersion: done.value };
  }
  // 版本失配 → 触发升级流程
}
```

**升级流程**：

1. **不清库**：不调用 `db.delete()`，不删除 dictionarySenses 表——禁止清库重来是红线；
2. **增量替换**：读取新包 entries → 按 term 与 dictionarySenses 表 diff → 只写入新增/变更词条（term 相同且内容未变的跳过）；
3. **删除已移除词条**：新包中不再出现的旧词条，从 dictionarySenses 表删除（仅删该包 source 的条目，不影响其它包）；
4. **已晋升副本不受影响**：已从 dictionarySenses 晋升到 senses 表的 Sense（通过 `promoteDictionarySense` 生成新 SenseId 写入 senses 表）是独立记录，不因 dictionarySenses 表的删除而受影响——它们已属于学习数据，由用户管理；
5. **更新 done 标记**：完成后 `db.meta.put({ key: dictionaryDoneKey(packageId), value: newVersion })`；
6. **进度与中断恢复**：与新装一致（progress 标记 + 分块事务）。

**已移除词条检测策略**：安装前读取旧版 dictionarySenses 中该包 source 的全部 term 集合（`db.dictionarySenses.where("source").equals(packageId).toArray()`），与新包 entries 的 term 集合做差集 → 差集中的 term 即为「已移除词条」→ 从 dictionarySenses 表按 term + source 删除。

**版本号格式**：沿用 `PACKAGE_VERSION`（`build.mjs` 中定义，当前 `"1.0.0"`），随内容变更递增（semver 语义：patch = 构建修复、minor = 新增词条、major = 条目结构变更）。

---

## 4. 下载通道与 SW 缓存

### 4.1 现状分析

`public/sw.js` 对同源 GET 一律 stale-while-revalidate + `cache.put`：

```javascript
// sw.js 第 153-165 行
const fetched = fetch(request)
  .then((response) => {
    if (response.ok) {
      caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
    }
    return response;
  })
  .catch(() => cached);
```

问题：若包 URL 不带版本号，更新后的包会被旧缓存顶掉；25 MB 包进 Cache API 与解压后落库重复占配额。

### 4.2 方案

**包 URL 版本化**：包文件 URL 包含版本号和内容哈希：

```
https://<host>/presets/core-en-tier1-v1.0.0-a1b2c3d4.json.br
https://<host>/presets/core-en-tier2-v1.0.0-e5f6g7h8.json.br
```

- 版本号（`v1.0.0`）+ 内容哈希前 8 位（`a1b2c3d4`）= URL 唯一；
- 版本化 URL 保证每版内容对应唯一地址，便于审计与回溯。

**SW 排除**（双重保险）：在 `sw.js` 的 `fetch` 事件处理器中，**沿用 `resolveUrl` 相对口径**（Pages 部署在 `/Lexilexi/` 子路径），显式排除 presets 路径和 manifest URL：

```javascript
// 在现有 fetch handler 的同源检查之后、navigate 检查之前追加
const presetsUrl = resolveUrl("./presets/");
if (url.href.startsWith(presetsUrl)) {
  return; // 不拦截、不缓存扩展包请求（含 manifest.json 与包文件）
}
```

- `resolveUrl("./presets/")` 在 Pages 子路径下解析为 `https://<host>/Lexilexi/presets/`，根路径下解析为 `https://<host>/presets/`——与 sw.js 其它路径（`APP_SHELL` / `INDEX_URL`）口径一致；
- manifest URL（`/presets/manifest.json`）同样被排除（`startsWith` 匹配）。

**下载请求**：`fetch(packageUrl, { cache: "no-store" })`——绕过浏览器 HTTP 缓存（`no-store` = 不读缓存、不写缓存），确保每次下载都是最新版本。

**存储位置与配额核算**：

| 数据                            | 存储位置                                             | 体积估算                                                         |
| ------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| 包文件（下载的 JSON/Brotli）    | **不持久化**：下载 → 校验 → 解压 → 落库 → 丢弃原始包 | Tier 1: 1.2 MB / Tier 2: 6.4 MB（Brotli）                        |
| 落库数据（dictionarySenses 表） | IndexedDB `dictionarySenses` 表                      | Tier 1: ~15 MB / Tier 2: ~80 MB（估算，每条 ~200 字节 × 条目数） |

**总配额**：Tier 2 全量安装 ≈ 80 MB（落库），远低于浏览器 IDB 配额上限（Chrome: 磁盘 60%/可用空间、Firefox: 50% 可用空间、Safari: 1 GB 起步）。`navigator.storage.persist()` 尽力申请持久化（§6 详述）。

---

## 5. 校验与解压矩阵

### 5.1 发布 manifest

每次 CI 构建生成 `manifest.json`（发布到与包文件同目录）：

```json
{
  "packages": [
    {
      "id": "core-en-tier1",
      "version": "1.0.0",
      "variants": {
        "brotli": {
          "url": "/presets/core-en-tier1-v1.0.0-a1b2c3d4.json.br",
          "size": 1258304,
          "sha256": "..."
        },
        "gzip": {
          "url": "/presets/core-en-tier1-v1.0.0-a1b2c3d4.json.gz",
          "size": 1740800,
          "sha256": "..."
        },
        "raw": {
          "url": "/presets/core-en-tier1-v1.0.0-a1b2c3d4.json",
          "size": 4613120,
          "sha256": "..."
        }
      },
      "sourceCommit": "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b"
    },
    {
      "id": "core-en-tier2",
      "version": "1.0.0",
      "variants": {
        "brotli": {
          "url": "/presets/core-en-tier2-v1.0.0-e5f6g7h8.json.br",
          "size": 6710886,
          "sha256": "..."
        },
        "gzip": {
          "url": "/presets/core-en-tier2-v1.0.0-e5f6g7h8.json.gz",
          "size": 8912896,
          "sha256": "..."
        },
        "raw": {
          "url": "/presets/core-en-tier2-v1.0.0-e5f6g7h8.json",
          "size": 26419200,
          "sha256": "..."
        }
      },
      "sourceCommit": "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b"
    }
  ],
  "generatedAt": "2026-08-16T00:00:00.000Z"
}
```

### 5.2 校验流程

```
fetch manifest.json（cache: "no-store"）
  → 读取目标包的 version / sha256 / url（按浏览器能力选择 variant）
  → fetch 包文件（cache: "no-store"）
  → crypto.subtle.digest("SHA-256", decompressedBytes)
  → 比对 sha256
  → 校验通过 → 解析 JSON → 落库
```

**`crypto.subtle` 前提**：仅安全上下文可用（`window.isSecureContext === true`）。GitHub Pages（HTTPS）满足；本地开发（`localhost`）也满足（`localhost` 视为安全上下文）。方案要求应用必须部署在 HTTPS 下（PWA 本身已要求 HTTPS，无新增约束）。

### 5.3 Brotli 支持矩阵与降级

**`DecompressionStream("br")`** 支持矩阵：

- **Chrome 80+ / Edge 80+**：✅ 原生（`DecompressionStream` 自 Chrome 80 起可用，`"br"` 同期支持）
- **Safari 16.4+**：✅ 原生
- **Firefox 113+**：✅ 原生

> 注：方案采用运行时探测（`detectDecompression()`），矩阵仅作参考；实际能力以探测结果为准。

**降级通道**：

| 浏览器                                      | Brotli 支持 | 降级方案                                       |
| ------------------------------------------- | ----------- | ---------------------------------------------- |
| Chrome 80+ / Edge 80+                       | ✅          | —                                              |
| Safari 16.4+                                | ✅          | —                                              |
| Firefox 113+                                | ✅          | —                                              |
| Chrome < 80 / Safari < 16.4 / Firefox < 113 | ❌          | gzip 降级包（Tier 1: 1.7 MB / Tier 2: 8.5 MB） |
| 不支持 `DecompressionStream`                | ❌          | raw JSON（Tier 1: 4.4 MB / Tier 2: 25.2 MB）   |

**运行时检测**：

```typescript
async function detectDecompression(): Promise<"brotli" | "gzip" | "raw"> {
  try {
    const stream = new DecompressionStream("br");
    stream.writable.close();
    return "brotli";
  } catch {
    try {
      const stream = new DecompressionStream("gzip");
      stream.writable.close();
      return "gzip";
    } catch {
      return "raw";
    }
  }
}
```

### 5.4 校验对象与传输编码

**校验对象**：校验**解压后**的原始 JSON 字节（而非传输字节）。原因：

- 应用层解压（`DecompressionStream`）时，校验解压后内容更自然；
- 三种编码（brotli/gzip/raw）解压后内容一致 → SHA256 一致 → manifest 只需一个 sha256 值。

**传输编码选定**：采用**应用层解压**（非 `Content-Encoding`）：

- 包文件以 `.br` / `.gz` 后缀存储在静态服务器上，`Content-Type: application/octet-stream`（不设 `Content-Encoding`）；
- `fetch` 返回原始压缩字节 → 应用层 `DecompressionStream` 解压 → 校验解压后 SHA256；
- manifest 中三种 variant 共用同一 sha256（解压后内容一致），仅 url/size 不同。

**与断点续传的兼容性**：方案选择 **整包重试**（非 Range 续传）：下载中断后从头重新下载（6.4 MB Brotli 包在宽带下 < 5 秒，移动网络 < 30 秒，可接受）。

---

## 6. 配额与失败恢复

### 6.1 存储预算

| 场景                             | 估算              |
| -------------------------------- | ----------------- |
| Tier 0（内置）+ 学习数据         | ~5 MB（现有用户） |
| + Tier 1 词典层                  | +15 MB ≈ 20 MB    |
| + Tier 2 词典层                  | +80 MB ≈ 85 MB    |
| + Tier 1 富化包（可选，RAY-268） | +12 MB ≈ 97 MB    |

**Safari 7 天逐出**：Safari 对非持久化 IDB 有 7 天无访问自动清除策略。应对：

- 启动时调用 `navigator.storage.persist()` 尽力申请持久化（已有的 `domain-model.md §10` 逻辑）；
- 持久化申请成功 → 数据安全；
- 持久化申请失败 → 在设置页展示提示「扩展词包可能在 7 天未使用后被清除，建议定期打开应用」；
- 检测 eviction：启动时读 `dictionaryDoneKey` → 若存在但 `dictionarySenses` 表为空（eviction 发生）→ 标记为「需重新下载」。

### 6.2 失败恢复

**下载中断**：整包重试（见 §5.4）。UI 展示下载进度（`Content-Length` 已知时显示百分比；未知时显示已下载字节数）。

**校验失败**：SHA256 不匹配 → 丢弃已下载数据 → 提示用户重试（可能是网络传输错误或包文件损坏）。

**落库中断**：`installDictionaryPackage` 的分块事务 + progress 标记保证可恢复——中断后重装从断点续装，已完成的块不重复写入（term 查重跳过）。

**原子提交**：整个落库过程（从 progress=0 到 done 标记写入）是渐进式的——部分落库的词条可被检索使用（有结果但不完整），done 标记写入才视为安装完成。不存在「半安装」的不可用状态。

### 6.3 双标签页互斥

沿用 `installPreset` 的 check-and-set 方案：

- 起始事务写 `progress=0` 占位（条件写入，不覆盖并发安装者已推进的进度）；
- 每块事务校验进度未被并发安装者推进（`ConcurrentInstallError` 回滚 + 重读续装）；
- `dictionarySenses` 表的 term 索引去重保证并发写入不产生重复记录。

### 6.4 取消与进度 UI

**下载前**：展示包名称、版本、体积（从 manifest 读取）；许可声明文案（仅 ECDICT MIT——Tier 1/2 数据仅来自 ECDICT，NGSL 是 Tier 0 选词基准，不在 Tier 1/2 包内）。

**下载中**：进度条（`response.headers.get("Content-Length")` 可知时显示百分比）+ 已下载字节数 + 取消按钮（`AbortController` 取消 fetch）。

**安装中**：进度条（已处理词条数 / 总词条数，从 `installDictionaryPackage` 的 yield 回调获取）+ 取消按钮（中断后可续装）。

**完成**：提示安装成功，可开始搜词。

---

## 7. Tier 1 ⊆ Tier 2 安装关系

Tier 2（401,222 条）包含 Tier 1（58,244 条）的全部词条（Tier 1 的筛选条件是 Tier 2 的子集）。

**互斥策略**：

- Tier 2 安装完成 → 自动标记 Tier 1 也为已覆盖（`dictionaryDoneKey("core-en-tier1")` 写入特殊值 `"covered-by-tier2"`）；
- 设置页展示：Tier 2 已安装时，Tier 1 显示为「已包含在全量词表中」，不提供独立下载按钮；
- Tier 1 已安装 → 安装 Tier 2 时，Tier 2 的 term 去重跳过 Tier 1 已有的词条（`installDictionaryPackage` 的 term 查重天然处理），Tier 2 安装完成后标记 Tier 1 为 covered。
- **卸载不在本期范围**：`covered-by-tier2` 标记的回退（Tier 2 卸载时恢复 Tier 1 独立状态）待后续「扩展包卸载」功能实现时一并处理。本期仅处理安装方向，文档明确此限制以免实现期歧义。

---

## 8. 发布通道

**CI 构建**：GitHub Actions workflow → `node scripts/presets/build.mjs --tier 1/2` → 产出 `tier1.json` / `tier2.json` → Brotli/gzip 压缩 → 生成 `manifest.json` → 上传到 GitHub Releases 资产或 GitHub Pages（`/presets/` 路径）。

**manifest 分发**：**用户进入扩展词包设置页时**发起 fetch `resolveUrl("./presets/manifest.json")`（相对口径，与 SW 排除一致），检查本地已安装版本与远程最新版本的差异，提示用户更新。**启动时不发任何网络请求**——与 RAY-257/258「用户主动发起」口径一致（应用默认离线，联网仅由用户显式触发）。

**体积审计**：Tier 2 Brotli 包 6.4 MB，远低于 GitHub Releases 单文件 2 GB 上限和 GitHub Pages 单文件 100 MB 上限。

---

## 9. 许可展示

下载确认界面展示许可声明：

- **Tier 1/2 数据仅来自 ECDICT（MIT，© 2025 Linwei）**——Tier 1/2 包的打包脚本（`build.mjs --tier 1/2`）仅使用 ECDICT 数据，不包含 NGSL 词表；
- NGSL 1.2（CC BY-SA 4.0）是 Tier 0 的选词基准，**不在 Tier 1/2 包内**——Tier 0 的打包口径（`build.mjs --tier 0`）才包含 NGSL join，Tier 1/2 的筛选条件（`hasExamTag` / `isTier1Core`）仅基于 ECDICT 字段；
- 复用现有「数据来源与许可」页的 ECDICT MIT 声明，下载确认弹窗中以简短文案说明。

---

## 10. Tier 1 富化包分发归属

`docs/presets/experiment-enrichment.md` 记录 Tier 1 富化包（brotli 5.78 MB）「走按需加载子路径」。

**方案**：Tier 1 富化包与 Tier 1 词条包**共用同一下载通道**：

- manifest 中 Tier 1 条目包含 `enrichment` 子字段（指向富化包 URL/SHA256/体积）；
- 用户下载 Tier 1 词条包时，可选「同时下载富化数据（例句/近反义/词根等）」或单独下载；
- 富化包落库路径沿用 `backfillEnrichment`（不改 schema，按 term 合并到已有 Sense 的 content 字段）；
- **富化 join 对象为 senses 表（学习义项）**：dictionarySenses 词条在晋升前不带富化字段（富化数据仅作用于学习数据）；晋升时（`promoteDictionarySense`）若 senses 表中尚无该 term 的副本，晋升后再由 `backfillEnrichment` 按 term 回填富化字段——即「先晋升，后富化」；
- 避免两套下载通道。

---

## 11. DB Schema 升级路径

**v5 → v6**（本方案引入）：

```typescript
db.version(6).stores({
  items: "id",
  senses: "id, term",
  memoryStates: "id, fields.due",
  events: "id, time, type",
  meta: "key",
  notebookEntries: "id, senseId, status",
  dictionarySenses: "id, term, source", // 新增：词典检索层（只读）；source 索引供增量替换删除检测
});
```

纯新增表，无数据迁移，存量数据原样保留（与 v2→v5 的升级模式一致）。`DictionarySense` 类型独立于 `Sense`（含 `source` 字段），见 §1.2。

---

## 12. API 清单（`@lexilexi/core` 新增导出）

| 函数                                             | 说明                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| `installDictionaryPackage(db, package, options)` | 安装/升级扩展词包到 dictionarySenses 表                                    |
| `getDictionaryPackageState(db, packageId)`       | 查询扩展包安装状态（not-installed / installing / installed + 版本）        |
| `searchAllSenses(db, query, options)`            | 合并检索 senses + dictionarySenses，term 去重 + 学习优先 + 全局排序 + 截断 |
| `promoteDictionarySense(db, dictSenseId)`        | 从 dictionarySenses 复制到 senses 表（新生成 SenseId，晋升为学习数据）     |
| `fetchManifest(url)`                             | 获取远程 manifest（含包列表、版本、SHA256）                                |
| `detectDecompression()`                          | 运行时检测浏览器解压能力（brotli / gzip / raw）                            |

---

## 13. 实施节奏

1. **Phase 1**（本方案）：schema v6 + `installDictionaryPackage` + `searchAllSenses` + 版本升级 + 下载/校验/解压管线 + 配额/失败恢复。
2. **Phase 2**（RAY-284 衔接）：`addToNotebook` 扩展为 senses → dictionarySenses 兜底查找 + `promoteDictionarySense` 调用。
3. **Phase 3**（UI）：设置页「扩展词包」入口 + 下载确认弹窗 + 进度 UI + 许可展示。
4. **Phase 4**（发布）：CI 构建 + manifest 生成 + GitHub Pages/Releases 发布。

Phase 1 可与 RAY-288/284/270 并行推进，不阻塞。
