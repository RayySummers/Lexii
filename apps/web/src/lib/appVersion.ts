/**
 * 应用版本号（RAY-251）：构建时由 vite.config.ts 注入（来源：apps/web/package.json 的
 * version），不在代码里硬编码。发版时只需 bump package.json，UI 展示自动跟随。
 *
 * 全局常量 `__APP_VERSION__` 仅在本模块引用一次，其余代码统一 import APP_VERSION，
 * 便于测试与将来更换版本来源（如 git tag）而不影响使用方。
 */
export const APP_VERSION: string = __APP_VERSION__;
