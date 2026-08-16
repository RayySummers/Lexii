/**
 * 构建信息（RAY-297 任务 B）：构建时由 vite.config.ts 的 `define` 注入
 * （SHA / 构建时间 / 分支或 tag / 通道 / 历史 Release tag 列表），
 * 不在代码里硬编码、运行时零网络请求。
 *
 * 全局常量 `__APP_BUILD__` 仅在本模块引用一次，其余代码统一 import APP_BUILD，
 * 便于测试与将来更换注入来源而不影响使用方。结构须与 vite-env.d.ts 的
 * 全局声明保持一致（此处为具名类型，供组件与测试引用）。
 */
export interface AppBuildInfo {
  /** 部署通道：release（稳定版，根路径）/ dev（开发预览，/dev/ 子路径） */
  channel: "release" | "dev";
  /** commit SHA（短格式；git 不可用等异常环境为 "unknown"） */
  sha: string;
  /** 构建时间（ISO-8601 UTC） */
  time: string;
  /** 构建所在分支或 tag（如 "main" / "v0.1.0-alpha.6"） */
  branch: string;
  /** 历史 Release tag 列表（版本倒序，首位恒为当前版本 tag，上限 21 个） */
  releaseTags: string[];
}

export const APP_BUILD: AppBuildInfo = __APP_BUILD__;
