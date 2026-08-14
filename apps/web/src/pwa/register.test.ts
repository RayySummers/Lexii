/**
 * Service Worker 注册单元测试（mock navigator.serviceWorker）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerServiceWorker } from "./register";

const ORIGINAL_SERVICE_WORKER = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");

afterEach(() => {
  if (ORIGINAL_SERVICE_WORKER) {
    Object.defineProperty(navigator, "serviceWorker", ORIGINAL_SERVICE_WORKER);
  } else {
    Reflect.deleteProperty(navigator, "serviceWorker");
  }
});

describe("registerServiceWorker", () => {
  it("环境不支持 serviceWorker 时静默跳过", () => {
    Reflect.deleteProperty(navigator, "serviceWorker");
    expect(() => registerServiceWorker("/sw.js")).not.toThrow();
  });

  it("支持时以指定脚本注册", () => {
    const register = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });

    registerServiceWorker("/sw.js");
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith("/sw.js");
  });

  it("注册被拒绝时静默降级（不向调用方抛错）", async () => {
    const register = vi.fn().mockRejectedValue(new Error("not allowed"));
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });

    expect(() => registerServiceWorker("/sw.js")).not.toThrow();
    await Promise.resolve(); // 等待 rejection 被内部 catch 消费
    expect(register).toHaveBeenCalledTimes(1);
  });
});
