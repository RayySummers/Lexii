/**
 * 浏览器外壳主题色（<meta name="theme-color">）同步
 *
 * 颜色值不在此处硬编码：统一读取 tokens.css 中的语义 token --lex-bg
 * （浅色/深色两套，随 <html data-theme="dark"> 切换自动生效），
 * meta 内容因此始终与页面背景 token 一致，不存在第二份颜色定义。
 *
 * - index.html 保留浅色初始值（--lex-bg 浅色值）用于首帧渲染前与无 JS 兜底，
 *   深色值只在运行时从 token 读取——任何 JS/HTML 都不会新增硬编码颜色。
 * - themeColor.test.ts 校验：本模块源码不含十六进制颜色、index.html 初始值与
 *   tokens.css 的浅色 --lex-bg 一致，防止两处漂移。
 */
export const THEME_COLOR_META_SELECTOR = 'meta[name="theme-color"]';

/** 读取当前主题下 --lex-bg token 的值（CSS 尚未加载或环境不支持时为 ""） */
export function readThemeColorToken(doc: Document = document): string {
  const view = doc.defaultView;
  if (!view) {
    return "";
  }
  return view.getComputedStyle(doc.documentElement).getPropertyValue("--lex-bg").trim();
}

/**
 * 将 meta theme-color 同步为当前主题的 --lex-bg token 值。
 * 调用前须已应用 data-theme（useTheme 的 effect 先写 dataset 再调用本函数）。
 * meta 节点缺失或 token 不可用时保持现状：不抛错、不写空值。
 */
export function syncThemeColorMeta(doc: Document = document): void {
  const value = readThemeColorToken(doc);
  if (!value) {
    return;
  }
  doc.querySelector<HTMLMetaElement>(THEME_COLOR_META_SELECTOR)?.setAttribute("content", value);
}
