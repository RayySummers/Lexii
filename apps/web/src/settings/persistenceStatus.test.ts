/**
 * 持久化状态模块测试（vi.resetModules 保证每次测试拿全新模块实例，
 * 避免模块级 current 状态跨测试串扰）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_PERMISSION_EVENT } from "@lexii/core";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function loadModule() {
  return import("./persistenceStatus");
}

/** 桩 navigator 为无 StorageManager 的环境，requestPersistence 静默降级不覆盖事件 */
function stubUnsupportedNavigator(): void {
  vi.stubGlobal("navigator", {});
}

describe("persistenceStatus 模块", () => {
  it("初始为 null", async () => {
    const { getPersistenceStatus } = await loadModule();
    expect(getPersistenceStatus()).toBeNull();
  });

  it("收到 denied 事件后状态更新为 denied", async () => {
    const { getPersistenceStatus, initPersistenceStatus } = await loadModule();
    stubUnsupportedNavigator();
    initPersistenceStatus();

    window.dispatchEvent(
      new CustomEvent(STORAGE_PERMISSION_EVENT, { detail: { status: "denied" } }),
    );

    expect(getPersistenceStatus()).toBe("denied");
  });

  it("subscribe 注册回调：事件触发回调，退订后不再触发", async () => {
    const { getPersistenceStatus, initPersistenceStatus, subscribePersistenceStatus } =
      await loadModule();
    stubUnsupportedNavigator();
    initPersistenceStatus();

    const listener = vi.fn();
    const unsubscribe = subscribePersistenceStatus(listener);

    window.dispatchEvent(
      new CustomEvent(STORAGE_PERMISSION_EVENT, { detail: { status: "granted" } }),
    );
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getPersistenceStatus()).toBe("granted");

    unsubscribe();
    window.dispatchEvent(
      new CustomEvent(STORAGE_PERMISSION_EVENT, { detail: { status: "denied" } }),
    );
    expect(listener).toHaveBeenCalledTimes(1); // 退订后不再触发
  });

  it("环境不支持 StorageManager 时静默降级为 unsupported", async () => {
    const { getPersistenceStatus, initPersistenceStatus } = await loadModule();
    stubUnsupportedNavigator();
    initPersistenceStatus();

    await vi.waitFor(() => expect(getPersistenceStatus()).toBe("unsupported"));
  });
});

describe("usePersistenceStatus hook", () => {
  it("反映当前状态并随事件更新", async () => {
    const { renderHook, act } = await import("@testing-library/react");
    const mod = await loadModule();
    stubUnsupportedNavigator();
    mod.initPersistenceStatus();

    const { result } = renderHook(() => mod.usePersistenceStatus());
    expect(result.current).toBeNull();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(STORAGE_PERMISSION_EVENT, { detail: { status: "granted" } }),
      );
    });
    expect(result.current).toBe("granted");
  });
});
