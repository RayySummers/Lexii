/// <reference types="vite/client" />

/**
 * 构建时注入的应用版本号（RAY-251）：
 * 由 vite.config.ts 的 `define` 从 apps/web/package.json 的 version 注入，
 * 组件禁止硬编码版本号——发版时只需更新 package.json。
 * 运行时通过 `src/lib/appVersion.ts` 的 `APP_VERSION` 读取。
 */
declare const __APP_VERSION__: string;

/**
 * 构建时注入的构建信息（RAY-297 任务 B）：
 * 由 vite.config.ts 的 `define` 收集（SHA / 构建时间 / 分支或 tag / 通道 /
 * 历史 Release tag 列表），运行时零网络请求。运行时通过
 * `src/settings/devPanel/buildInfo.ts` 的 `APP_BUILD` 读取；
 * 结构须与 `buildInfo.ts` 的 `AppBuildInfo` 保持一致。
 */
declare const __APP_BUILD__: {
  channel: "release" | "dev";
  sha: string;
  time: string;
  branch: string;
  releaseTags: string[];
};
