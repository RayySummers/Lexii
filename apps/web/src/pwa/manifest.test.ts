/**
 * PWA 配置结构测试（不启动浏览器，直接校验 public/ 产物）。
 *
 * 目的：把「可安装性」与「配置一致性」锁进 CI——
 * - 可安装性：manifest 必需字段（name / start_url / display / 192+512 图标）；
 * - 图标完整性：manifest 引用的图标文件存在且为合法 PNG；
 * - 一致性：manifest.theme_color 与 index.html 的 meta theme-color 不漂移
 *   （index.html 侧另由 themeColor.test.ts 与 tokens 对齐）；
 * - 离线入口：sw.js 存在（行为冒烟见 serviceWorker.test.ts）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC_DIR = path.join(WEB_ROOT, "public");

/** PNG 文件签名（前 8 字节） */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface Manifest {
  name?: string;
  short_name?: string;
  id?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  theme_color?: string;
  background_color?: string;
  icons?: ManifestIcon[];
}

function loadManifest(): Manifest {
  const text = readFileSync(path.join(PUBLIC_DIR, "manifest.webmanifest"), "utf8");
  return JSON.parse(text) as Manifest;
}

function readIconBytes(src: string): Buffer {
  const relative = src.replace(/^(?:\.\/|\/)/, "");
  return readFileSync(path.join(PUBLIC_DIR, relative));
}

describe("manifest.webmanifest（可安装性结构）", () => {
  it("包含可安装性必需字段", () => {
    const manifest = loadManifest();
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe("standalone");
    // 相对 manifest 自身的路径：任意子路径部署（如 GitHub Pages /Lexilexi/）均可安装
    expect(manifest.start_url).toBe("./");
    expect(manifest.id).toBe("./");
  });

  it("图标覆盖 any 192 / any 512 / maskable 512", () => {
    const icons = loadManifest().icons ?? [];
    const find = (purpose: string, sizes: string) =>
      icons.find((icon) => icon.purpose === purpose && icon.sizes === sizes);
    expect(find("any", "192x192")).toBeTruthy();
    expect(find("any", "512x512")).toBeTruthy();
    expect(find("maskable", "512x512")).toBeTruthy();
  });

  it("manifest 引用的图标文件存在且为合法 PNG", () => {
    for (const icon of loadManifest().icons ?? []) {
      const bytes = readIconBytes(icon.src);
      expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE);
    }
  });

  it("theme_color 与 index.html 的 meta theme-color 一致（防漂移）", () => {
    const manifest = loadManifest();
    const html = readFileSync(path.join(WEB_ROOT, "index.html"), "utf8");
    const match = /<meta name="theme-color" content="([^"]+)"/.exec(html);
    expect(match).not.toBeNull();
    expect(manifest.theme_color).toBe(match?.[1]);
  });

  it("离线入口 sw.js 存在于 public/", () => {
    expect(() => readFileSync(path.join(PUBLIC_DIR, "sw.js"), "utf8")).not.toThrow();
  });
});
