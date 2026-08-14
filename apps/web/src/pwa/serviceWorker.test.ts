/**
 * Service Worker 冒烟测试（jsdom 无法运行真实 SW，退而做静态契约检查）。
 *
 * 锁住三件事：
 * - sw.js 是语法合法的脚本（经 new Function 解析）；
 * - install / activate / fetch 三个生命周期处理器都在；
 * - 导航请求离线回退到缓存的 /index.html（「离线可打开应用」的落点）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SW_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public/sw.js");

function loadSwSource(): string {
  return readFileSync(SW_PATH, "utf8");
}

describe("public/sw.js（离线能力冒烟）", () => {
  it("是语法合法的脚本", () => {
    expect(() => new Function(loadSwSource())).not.toThrow();
  });

  it("注册 install / activate / fetch 生命周期处理器", () => {
    const source = loadSwSource();
    expect(source).toContain('addEventListener("install"');
    expect(source).toContain('addEventListener("activate"');
    expect(source).toContain('addEventListener("fetch"');
  });

  it("导航请求离线时回退到缓存的 index.html", () => {
    const source = loadSwSource();
    expect(source).toContain('caches.match("/index.html")');
  });
});
