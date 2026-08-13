/**
 * 持久化权限状态：启动时申请 + 设置页订阅。
 *
 * 对接 @lexilexi/core 的 requestPersistence / STORAGE_PERMISSION_EVENT：
 * - `initPersistenceStatus()` 在应用启动时调用一次（main.tsx），
 *   内部调用 requestPersistence(navigator) 并监听其派发的事件；
 * - 结果缓存在模块级，供设置页通过 `usePersistenceStatus()` 读取——
 *   即使事件在设置页挂载前就已派发，也不会漏掉；
 * - 不支持 StorageManager 的环境返回 "unsupported"，静默降级、不提示。
 */
import { useSyncExternalStore } from "react";
import {
  STORAGE_PERMISSION_EVENT,
  requestPersistence,
  type PersistenceStatus,
  type StoragePermissionRequestedDetail,
} from "@lexilexi/core";

let current: PersistenceStatus | null = null;
const listeners = new Set<() => void>();

function setStatus(status: PersistenceStatus): void {
  current = status;
  for (const listener of listeners) {
    listener();
  }
}

/** requestPersistence 派发的 CustomEvent 处理器（事件与返回值双保险，幂等） */
function onStoragePermission(event: Event): void {
  const detail = (event as CustomEvent<StoragePermissionRequestedDetail>).detail;
  if (detail?.status) {
    setStatus(detail.status);
  }
}

/**
 * 应用启动时调用一次：申请持久存储并订阅结果事件。
 * 任何异常都静默降级为 "unsupported"，绝不阻塞启动（local-first 红线）。
 */
export function initPersistenceStatus(): void {
  if (typeof window !== "undefined") {
    window.addEventListener(STORAGE_PERMISSION_EVENT, onStoragePermission);
  }
  void requestPersistence(navigator)
    .then(setStatus)
    .catch(() => setStatus("unsupported"));
}

export function getPersistenceStatus(): PersistenceStatus | null {
  return current;
}

export function subscribePersistenceStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 当前持久化权限状态（启动前为 null；"unsupported" 表示环境不支持，静默不提示） */
export function usePersistenceStatus(): PersistenceStatus | null {
  return useSyncExternalStore(subscribePersistenceStatus, getPersistenceStatus);
}
