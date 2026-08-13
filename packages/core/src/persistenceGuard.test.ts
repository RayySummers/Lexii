import { describe, expect, it, vi } from "vitest";
import {
  STORAGE_PERMISSION_EVENT,
  dispatchStoragePermissionRequested,
  getStorageManager,
  requestPersistence,
} from "./persistenceGuard";
import type { PersistenceStatus } from "./persistenceGuard";

function makeStorageManager(opts: { persisted: boolean; persistResult: boolean }): {
  storage: { persist: () => Promise<boolean>; persisted: () => Promise<boolean> };
} {
  return {
    storage: {
      persist: vi.fn().mockResolvedValue(opts.persistResult),
      persisted: vi.fn().mockResolvedValue(opts.persisted),
    },
  };
}

describe("getStorageManager", () => {
  it("无 navigator 或 StorageManager 时返回 null", () => {
    expect(getStorageManager(undefined)).toBeNull();
    expect(getStorageManager({} as Navigator)).toBeNull();
    expect(getStorageManager({ storage: {} } as unknown as Navigator)).toBeNull();
    expect(
      getStorageManager({ storage: { persist: () => {} } } as unknown as Navigator),
    ).toBeNull();
  });

  it("有 persist/persisted 时返回 storage", () => {
    const nav = makeStorageManager({ persisted: true, persistResult: true });
    expect(getStorageManager(nav as unknown as Navigator)).toBe(nav.storage);
  });
});

describe("requestPersistence", () => {
  it("已持久化时返回 persisted，且不再申请", async () => {
    const nav = makeStorageManager({ persisted: true, persistResult: false });
    const status = await requestPersistence(nav as unknown as Navigator);
    expect(status).toBe("persisted");
    expect(nav.storage.persist).not.toHaveBeenCalled();
  });

  it("未持久化但申请成功时返回 granted", async () => {
    const nav = makeStorageManager({ persisted: false, persistResult: true });
    const status = await requestPersistence(nav as unknown as Navigator);
    expect(status).toBe("granted");
    expect(nav.storage.persist).toHaveBeenCalledTimes(1);
  });

  it("申请被拒时返回 denied", async () => {
    const nav = makeStorageManager({ persisted: false, persistResult: false });
    const status = await requestPersistence(nav as unknown as Navigator);
    expect(status).toBe("denied");
  });

  it("环境不支持 StorageManager 时静默降级，不抛错", async () => {
    await expect(requestPersistence(undefined)).resolves.toBe("unsupported");
    await expect(requestPersistence({} as Navigator)).resolves.toBe("unsupported");
  });

  it("结果通过事件上报（可注入派发目标）", async () => {
    const nav = makeStorageManager({ persisted: false, persistResult: false });
    const listener = vi.fn();
    const target = new EventTarget();
    target.addEventListener(STORAGE_PERMISSION_EVENT, listener);

    const status = await requestPersistence(nav as unknown as Navigator, target);
    expect(status).toBe("denied");
    expect(listener).toHaveBeenCalledTimes(1);

    const event = listener.mock.calls[0]?.[0] as CustomEvent<{ status: PersistenceStatus }>;
    expect(event.detail.status).toBe("denied");
  });
});

describe("dispatchStoragePermissionRequested", () => {
  it("直接派发事件时 detail 正确", () => {
    const target = new EventTarget();
    const listener = vi.fn();
    target.addEventListener(STORAGE_PERMISSION_EVENT, listener);

    dispatchStoragePermissionRequested(target, "granted");
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0] as CustomEvent<{ status: PersistenceStatus }>;
    expect(event.detail.status).toBe("granted");
  });
});
