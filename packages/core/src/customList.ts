/**
 * 自定义单词列表（Custom List，RAY-325）：用户自己创建 / 管理 / 命名的
 * 词组集合，把散落的词条按主题归类（如「工作中常用」「阅读里遇过」）。
 *
 * 与既有生词本（Notebook，RAY-284）的关系：
 * - 生词本是预置、单一、内置的学习入口（加入即创建学习条目 + 进入 FSRS 调度）；
 * - 自定义列表是用户主动管理的多对一容器（同一词可同时归入多个列表），
 *   默认不创建学习条目，仅作为「词条的收藏 / 标签」使用，不参与学习调度。
 *
 * 数据模型（RAY-325）：
 * - CustomList：列表元数据（id / name / description / status / createdAt /
 *   updatedAt / removedAt）。name 必填且 trim 后非空，length 1-60；
 *   description 可选，trim 后 ≤ 200 字符；按 createdAt 倒序展示。
 * - CustomListEntry：词条加入列表的记录（id / listId / senseId / addedAt），
 *   1─1 锚定 senseId（不复用学习条目 / 记忆状态），加入幂等
 *   （同 listId + senseId 的 active 条目已存在 → 直接返回既有记录）。
 *
 * 隐私 / local-first：所有操作在本机 IndexedDB 事务内完成，
 * 无网络、无埋点；导出 / 导入沿用既有 JSON 备份口径（customLists 与
 * customListEntries 两表随 JSON 备份原样往返）。
 */
import type { IsoDate } from "./domain";
import { createId, toCustomListEntryId, toCustomListId, toSenseId } from "./id";
import type { CustomListEntryId, CustomListId, SenseId } from "./id";
import type { LexiiDatabase } from "./persistence";

/** 列表状态：active（在册）⇢ removed（已移除，记录保留为历史） */
export type CustomListStatus = "active" | "removed";

/** 列表条目状态：active（在列表中）⇢ removed（已移出，记录保留为历史） */
export type CustomListEntryStatus = "active" | "removed";

/** 列表名称最大长度（用户可见口径：覆盖「词书名」等场景，不至于撑破卡片） */
export const CUSTOM_LIST_NAME_MAX = 60;

/** 列表名称最小长度（trim 后非空） */
export const CUSTOM_LIST_NAME_MIN = 1;

/** 列表描述最大长度（trim 后字符数） */
export const CUSTOM_LIST_DESCRIPTION_MAX = 200;

/**
 * 自定义单词列表（用户创建的词组容器）。
 *
 * - name：列表名称（用户主键，可重名；展示按 createdAt 倒序）；
 * - description：可空描述，写明主题 / 场景；
 * - status / removedAt：软删除字段，removed 后不再出现在「我的列表」中
 *   但 entry 记录保留为历史（防止删除列表后追溯不到曾经的归类）。
 */
export interface CustomList {
  id: CustomListId;
  name: string;
  description: string;
  status: CustomListStatus;
  createdAt: IsoDate;
  updatedAt: IsoDate;
  /** 移除时刻（active 时恒为 null） */
  removedAt: IsoDate | null;
}

/**
 * 列表条目：一条「把词加入自定义列表」的记录。
 *
 * - listId / senseId：联合决定唯一性（同一 list 内同 sense 不重复）；
 * - 移出（remove）：条目标记 removed（保留为历史），列表元数据不受影响；
 * - 列表被整体删除（deleteCustomList）：条目批量标记 removed，
 *   词条本身（Sense / Learning Item / Memory State）不受影响。
 */
export interface CustomListEntry {
  id: CustomListEntryId;
  listId: CustomListId;
  senseId: SenseId;
  addedAt: IsoDate;
  status: CustomListEntryStatus;
  /** 移出时刻（active 时恒为 null） */
  removedAt: IsoDate | null;
}

/** 创建列表输入 */
export interface CreateCustomListInput {
  /** 列表名称（必填，trim 后非空，长度 1-60） */
  name: string;
  /** 列表描述（可选，trim 后 ≤ 200 字符） */
  description?: string;
  /** 创建时刻（ISO；默认调用方当前时间） */
  now?: IsoDate;
}

/** 更新列表输入（name / description 至少传一个） */
export interface UpdateCustomListInput {
  /** 目标列表 id */
  id: CustomListId;
  /** 新名称（trim 后非空，长度 1-60） */
  name?: string;
  /** 新描述（trim 后 ≤ 200 字符；undefined = 不改；null = 清空） */
  description?: string | null;
  /** 更新时刻（ISO；默认调用方当前时间） */
  now?: IsoDate;
}

/** 删除列表输入 */
export interface DeleteCustomListInput {
  id: CustomListId;
  /** 删除时刻（ISO；默认调用方当前时间） */
  now?: IsoDate;
}

/** 把词加入列表输入 */
export interface AddWordToCustomListInput {
  listId: CustomListId;
  senseId: SenseId;
  /** 加入时刻（ISO；默认调用方当前时间） */
  now?: IsoDate;
}

/** 把词移出列表输入 */
export interface RemoveWordFromCustomListInput {
  entryId: CustomListEntryId;
  /** 移出时刻（ISO；默认调用方当前时间） */
  now?: IsoDate;
}

/** 列表统计（卡片展示用：词条数 + 最近加入时刻） */
export interface CustomListSummary {
  list: CustomList;
  /** active 条目数 */
  entryCount: number;
  /** 最近一次加入时刻（无 active 条目时为 null） */
  latestAddedAt: IsoDate | null;
}

/** 列表条目 + 义项内容（详情页列表项，复用生词本 Notion 类型） */
export interface CustomListEntryItem {
  entry: CustomListEntry;
  /** 该义项所属列表的元数据（供面包屑 / 返回按钮） */
  list: CustomList;
}

/**
 * 校验列表名称（trim 后非空，长度 1-60）。
 *
 * 抛出错误供调用方 try/catch；UI 层把错误原文展示给用户。
 */
export function validateCustomListName(name: string): void {
  const trimmed = name.trim();
  if (trimmed.length < CUSTOM_LIST_NAME_MIN) {
    throw new Error("列表名称不能为空");
  }
  if (trimmed.length > CUSTOM_LIST_NAME_MAX) {
    throw new Error(`列表名称不能超过 ${CUSTOM_LIST_NAME_MAX} 个字符`);
  }
}

/**
 * 校验列表描述（trim 后 ≤ 200 字符；空字符串视为未填）。
 *
 * 抛出错误供调用方 try/catch。
 */
export function validateCustomListDescription(description: string): void {
  const trimmed = description.trim();
  if (trimmed.length > CUSTOM_LIST_DESCRIPTION_MAX) {
    throw new Error(`列表描述不能超过 ${CUSTOM_LIST_DESCRIPTION_MAX} 个字符`);
  }
}

/**
 * 创建自定义列表（单事务原子落库）。
 *
 * 校验 name / description；事务内只插入 CustomList 一条记录，不触及义项 /
 * 学习条目 / 记忆状态。空 description 规范化为 ""，避免 UI 层展示 undefined。
 */
export async function createCustomList(
  db: LexiiDatabase,
  input: CreateCustomListInput,
): Promise<CustomList> {
  validateCustomListName(input.name);
  const description = (input.description ?? "").trim();
  validateCustomListDescription(description);
  const now = input.now ?? new Date().toISOString();
  const list: CustomList = {
    id: toCustomListId(createId("cl")),
    name: input.name.trim(),
    description,
    status: "active",
    createdAt: now,
    updatedAt: now,
    removedAt: null,
  };
  await db.customLists.put(list);
  return list;
}

/**
 * 更新自定义列表的名称 / 描述（单事务原子落库）。
 *
 * 至少传 name 或 description 之一；description 传 null = 清空描述；
 * 列表不存在或 status === "removed" 报错并回滚。
 */
export async function updateCustomList(
  db: LexiiDatabase,
  input: UpdateCustomListInput,
): Promise<CustomList> {
  if (input.name === undefined && input.description === undefined) {
    throw new Error("至少传入 name 或 description 之一");
  }
  const now = input.now ?? new Date().toISOString();
  let updated: CustomList | undefined;
  await db.transaction("rw", db.customLists, async () => {
    const existing = await db.customLists.get(input.id);
    if (!existing) {
      throw new Error(`自定义列表不存在：${input.id}`);
    }
    if (existing.status !== "active") {
      throw new Error(`自定义列表不可编辑（当前状态：${existing.status}）`);
    }
    const next: CustomList = {
      ...existing,
      updatedAt: now,
    };
    if (input.name !== undefined) {
      validateCustomListName(input.name);
      next.name = input.name.trim();
    }
    if (input.description !== undefined) {
      if (input.description === null) {
        next.description = "";
      } else {
        validateCustomListDescription(input.description);
        next.description = input.description.trim();
      }
    }
    await db.customLists.put(next);
    updated = next;
  });
  if (!updated) {
    // 不可达分支：transaction 抛出时函数提前中止；为类型守卫保留。
    throw new Error("更新失败");
  }
  return updated;
}

/**
 * 删除自定义列表（软删除 + 条目批量标记 removed，单事务原子落库）。
 *
 * 列表元数据标记 removed（记录保留为历史）；其下所有 active 条目
 * 一并标记 removed（保留为历史，词条本身（Sense / 学习条目 / 记忆
 * 状态）不受影响，词书 / 生词本 / 其他列表也不受影响）。
 * 重复删除报错；列表不存在报错，事务回滚。
 */
export async function deleteCustomList(
  db: LexiiDatabase,
  input: DeleteCustomListInput,
): Promise<void> {
  const now = input.now ?? new Date().toISOString();
  await db.transaction("rw", db.customLists, db.customListEntries, async () => {
    const list = await db.customLists.get(input.id);
    if (!list) {
      throw new Error(`自定义列表不存在：${input.id}`);
    }
    if (list.status !== "active") {
      throw new Error(`自定义列表不可重复删除（当前状态：${list.status}）`);
    }
    await db.customLists.put({ ...list, status: "removed", removedAt: now, updatedAt: now });
    const activeEntries = await db.customListEntries
      .where("listId")
      .equals(input.id)
      .filter((entry) => entry.status === "active")
      .toArray();
    for (const entry of activeEntries) {
      await db.customListEntries.put({ ...entry, status: "removed", removedAt: now });
    }
  });
}

/**
 * 把义项加入自定义列表（单事务原子落库，幂等）。
 *
 * 事务内：校验列表存在且 active + 校验义项存在；同 listId + senseId 的
 * active 条目已存在 → 直接返回既有记录（幂等，连点 / 重复加词不产生
 * 重复条目）；否则创建 CustomListEntry 一条。
 *
 * 列表被删除（removed）或义项不存在时整个事务中止。
 */
export async function addWordToCustomList(
  db: LexiiDatabase,
  input: AddWordToCustomListInput,
): Promise<CustomListEntry> {
  const now = input.now ?? new Date().toISOString();
  return db.transaction("rw", db.customLists, db.customListEntries, db.senses, async () => {
    const list = await db.customLists.get(input.listId);
    if (!list) {
      throw new Error(`自定义列表不存在：${input.listId}`);
    }
    if (list.status !== "active") {
      throw new Error(`自定义列表不可加入词条（当前状态：${list.status}）`);
    }
    // 校验义项存在（避免幽灵条目）。Sense 的 get 必然返回完整记录或 undefined；
    // 我们不强校验 term 一致，UI 层自行展示义项快照。
    const sense = await db.senses.get(toSenseId(input.senseId));
    if (!sense) {
      throw new Error(`义项不存在：${input.senseId}`);
    }
    const existing = await db.customListEntries
      .where("[listId+senseId]")
      .equals([input.listId, input.senseId])
      .filter((entry) => entry.status === "active")
      .first();
    if (existing) {
      return existing;
    }
    const entry: CustomListEntry = {
      id: toCustomListEntryId(createId("cle")),
      listId: input.listId,
      senseId: input.senseId,
      addedAt: now,
      status: "active",
      removedAt: null,
    };
    await db.customListEntries.put(entry);
    return entry;
  });
}

/**
 * 把义项从自定义列表中移出（单事务原子落库）。
 *
 * 条目标记 removed（保留为历史），列表元数据与义项本身不受影响。
 * 列表中的其他词不受影响；同一义项在其他列表中的条目不受影响。
 * 重复移出报错；条目不存在报错，事务回滚。
 */
export async function removeWordFromCustomList(
  db: LexiiDatabase,
  input: RemoveWordFromCustomListInput,
): Promise<void> {
  const now = input.now ?? new Date().toISOString();
  await db.transaction("rw", db.customListEntries, async () => {
    const entry = await db.customListEntries.get(input.entryId);
    if (!entry) {
      throw new Error(`自定义列表条目不存在：${input.entryId}`);
    }
    if (entry.status !== "active") {
      throw new Error(`自定义列表条目不可重复移出（当前状态：${entry.status}）`);
    }
    await db.customListEntries.put({ ...entry, status: "removed", removedAt: now });
  });
}

/**
 * 列出当前所有 active 自定义列表（按 createdAt 倒序，最新创建在前）。
 *
 * 列表展示按 createdAt 倒序（ISO-8601 同格式字符串可直接字典序比较）。
 * 注意：本函数只返回元数据（CustomList 数组），不含 entryCount / latestAddedAt；
 * 卡片展示用 listCustomListsWithSummary（一次取齐词条数 + 最近加入时刻，
 * 避免 UI 层 N+1 查询）。
 */
export async function listCustomLists(db: LexiiDatabase): Promise<CustomList[]> {
  const lists = await db.customLists.where("status").equals("active").toArray();
  return lists.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * 列出所有 active 自定义列表（带统计：词条数 + 最近加入时刻）。
 *
 * 实现：先 listCustomLists 拿元数据，再批量 bulkGet 各列表的 active 条目
 * （按 listId 索引），按列表聚合 entryCount + latestAddedAt，单次完成
 * N 列表的统计计算（避免 UI 层对每个列表单独查询）。
 */
export async function listCustomListsWithSummary(db: LexiiDatabase): Promise<CustomListSummary[]> {
  const lists = await listCustomLists(db);
  if (lists.length === 0) {
    return [];
  }
  // 先按 listId 索引批量取所有列表的 active 条目，避免 N+1。
  // Dexie 的 where("listId").anyOf(listIds) 一次往返完成。
  const listIds = lists.map((list) => list.id);
  const allActiveEntries = await db.customListEntries
    .where("listId")
    .anyOf(listIds)
    .filter((entry) => entry.status === "active")
    .toArray();
  const counts = new Map<CustomListId, { count: number; latest: string | null }>();
  for (const entry of allActiveEntries) {
    const bucket = counts.get(entry.listId) ?? { count: 0, latest: null };
    bucket.count += 1;
    if (bucket.latest === null || entry.addedAt > bucket.latest) {
      bucket.latest = entry.addedAt;
    }
    counts.set(entry.listId, bucket);
  }
  return lists.map((list) => {
    const stat = counts.get(list.id);
    return {
      list,
      entryCount: stat?.count ?? 0,
      latestAddedAt: stat?.latest ?? null,
    };
  });
}

/**
 * 读取单个自定义列表的元数据（按 id）。
 *
 * 返回 undefined 表示列表不存在；UI 层据此判定是否显示空态。
 */
export async function getCustomList(
  db: LexiiDatabase,
  id: CustomListId,
): Promise<CustomList | undefined> {
  return db.customLists.get(id);
}

/**
 * 列出包含指定义项的自定义列表（仅 active，按 createdAt 倒序）。
 *
 * 供「加入列表」对话框预勾选：已加入的列表默认勾选。查询走 listId 索引，
 * 一次扫所有 entry → 命中 listId → 按 listId 反查元数据并按 createdAt 排序。
 */
export async function getCustomListsContainingSense(
  db: LexiiDatabase,
  senseId: SenseId,
): Promise<CustomList[]> {
  const activeEntries = await db.customListEntries
    .where("senseId")
    .equals(senseId)
    .filter((entry) => entry.status === "active")
    .toArray();
  if (activeEntries.length === 0) {
    return [];
  }
  const listIds = activeEntries.map((entry) => entry.listId);
  const uniqueListIds = Array.from(new Set(listIds));
  const lists = await db.customLists.where("id").anyOf(uniqueListIds).toArray();
  return lists
    .filter((list) => list.status === "active")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * 列出指定列表下的所有 active 条目（按 addedAt 倒序，最新加入在前）。
 *
 * 详情页词条列表展示；调用方自行按 senseId 取义项内容（不在循环里逐条查询）。
 */
export async function listCustomListEntries(
  db: LexiiDatabase,
  listId: CustomListId,
): Promise<CustomListEntry[]> {
  const entries = await db.customListEntries
    .where("listId")
    .equals(listId)
    .filter((entry) => entry.status === "active")
    .toArray();
  return entries.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}
