/**
 * 持久化防线：navigator.storage.persist() / persisted()。
 *
 * 对应 docs/domain-model.md §10：
 * - 启动时检查 navigator.storage.persisted()；未拿到持久化权限则调用
 *   navigator.storage.persist() 申请，并触发 storage-permission-requested 事件
 *   （前端设置页据此提示「当前数据可能被清理，建议导出」）。
 * - 不支持 StorageManager 的环境静默降级：返回 "unsupported"，绝不抛错、绝不阻塞启动。
 * - localStorage 仅存主题等非学习偏好；学习数据一律在 IndexedDB。
 */

export type PersistenceStatus = "persisted" | "granted" | "denied" | "unsupported";

/** 申请结果事件名（apps/web 监听并展示提示） */
export const STORAGE_PERMISSION_EVENT = "lexilexi:storage-permission";

export interface StoragePermissionRequestedDetail {
  status: PersistenceStatus;
}

export interface StorageManagerLike {
  persist(): Promise<boolean>;
  persisted(): Promise<boolean>;
}

/** 从任意对象安全取 StorageManager（环境不支持时返回 null） */
export function getStorageManager(nav?: Navigator): StorageManagerLike | null {
  const storage = nav?.storage;
  if (typeof storage?.persist === "function" && typeof storage?.persisted === "function") {
    return storage as StorageManagerLike;
  }
  return null;
}

/** 在 Window 上派发申请结果事件（Node 无 dispatchEvent 时静默跳过） */
export function dispatchStoragePermissionRequested(
  target: EventTarget,
  status: PersistenceStatus,
): void {
  if (typeof CustomEvent !== "function" || typeof target.dispatchEvent !== "function") {
    return;
  }
  const detail: StoragePermissionRequestedDetail = { status };
  target.dispatchEvent(
    new CustomEvent<StoragePermissionRequestedDetail>(STORAGE_PERMISSION_EVENT, { detail }),
  );
}

/**
 * 启动时申请持久存储（apps/web 入口调用一次）。
 *
 * 返回结果状态：
 * - "persisted"   之前已拿到持久化权限（无需再申请）
 * - "granted"     本次申请成功
 * - "denied"      申请被拒（浏览器策略限制），应提示导出
 * - "unsupported" 环境不支持 StorageManager（静默降级）
 */
export async function requestPersistence(
  nav: Navigator | undefined,
  dispatchTarget?: EventTarget,
): Promise<PersistenceStatus> {
  const storage = getStorageManager(nav);
  if (!storage) {
    return "unsupported";
  }
  const already = await storage.persisted();
  const status: PersistenceStatus = already
    ? "persisted"
    : (await storage.persist())
      ? "granted"
      : "denied";
  dispatchStoragePermissionRequested(dispatchTarget ?? globalThis, status);
  return status;
}
