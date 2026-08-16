/**
 * 部署通道检测与切换目标计算（RAY-297 任务 B，通道切换器）。
 *
 * 纯路径字符串运算，不访问网络、不读取任何全局状态：
 * - Dev 通道部署在 `/dev/` 子路径（如 rayysummers.github.io/Lexilexi/dev/），
 *   稳定版（release）部署在父目录 / 根路径（rayysummers.github.io/Lexilexi/）；
 * - 通道切换是纯页面跳转（<a href>），两通道同源、共享同一 IndexedDB，
 *   数据互通；
 * - 应用按相对 base（./）构建，同一份逻辑兼容根路径与任意子路径部署
 *   （不把 /Lexilexi 写死在代码里）。
 */

export type AppChannel = "release" | "dev";

/** dev 通道子目录名（构建与运行时统一口径） */
export const DEV_CHANNEL_SEGMENT = "dev";

/** 通道展示文案（面板 / 构建信息共用） */
export const CHANNEL_LABELS: Record<AppChannel, string> = {
  release: "Release（稳定版）",
  dev: "Dev（开发预览）",
};

/** 去掉查询串 / hash 后的路径 */
function stripQuery(pathname: string): string {
  return pathname.replace(/[?#].*$/, "");
}

/**
 * 把路径按目录拆段（过滤空段）。
 * 最后一段若含 "." 视为文件名（index.html 之类），从段列表中剔除。
 * 纯目录形态（"/dev" 与 "/dev/"）保留最后一段，二者等价判定为 dev 目录。
 */
function directorySegments(pathname: string): string[] {
  const segments = stripQuery(pathname)
    .split("/")
    .filter((segment) => segment.length > 0);
  const last = segments[segments.length - 1];
  if (segments.length > 1 && last !== undefined && last.includes(".")) {
    return segments.slice(0, -1);
  }
  return segments;
}

/**
 * 检测当前部署通道（纯函数）。
 *
 * - "/Lexilexi/dev"、"/Lexilexi/dev/"、"/Lexilexi/dev/index.html" → dev；
 * - 其余（"/Lexilexi/"、"/Lexilexi/index.html"、"/"）→ release。
 */
export function detectChannel(pathname: string): AppChannel {
  const segments = directorySegments(pathname);
  return segments[segments.length - 1] === DEV_CHANNEL_SEGMENT ? "dev" : "release";
}

/**
 * 计算另一通道的绝对路径（纯函数，返回以 "/" 开头的路径）。
 *
 * - release → dev：在 release 目录下追加 `dev/`；
 * - dev → release：去掉结尾的 `dev` 段，回到父目录。
 *
 * 例：
 * - "/Lexilexi/" → "/Lexilexi/dev/"；"/" → "/dev/"；
 * - "/Lexilexi/dev/" / "/Lexilexi/dev" / "/Lexilexi/dev/index.html" → "/Lexilexi/"；
 * - "/dev/" → "/"。
 */
export function getOtherChannelPath(pathname: string): string {
  const segments = directorySegments(pathname);
  if (detectChannel(pathname) === "dev") {
    const parent = segments.slice(0, -1).join("/");
    return `/${parent ? `${parent}/` : ""}`;
  }
  const parent = segments.join("/");
  return `/${parent ? `${parent}/` : ""}${DEV_CHANNEL_SEGMENT}/`;
}
