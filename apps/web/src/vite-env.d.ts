/// <reference types="vite/client" />

/**
 * 构建时注入的应用版本号（RAY-251）：
 * 由 vite.config.ts 的 `define` 从 apps/web/package.json 的 version 注入，
 * 组件禁止硬编码版本号——发版时只需更新 package.json。
 * 运行时通过 `src/lib/appVersion.ts` 的 `APP_VERSION` 读取。
 */
declare const __APP_VERSION__: string;
