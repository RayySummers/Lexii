/**
 * RAY-364 稳定锚点：设置页内可跳转的分组标识。
 *
 * - 搜词无结果页「前往设置安装扩展词包」按钮通过此锚点跳转，
 *   禁止硬编码索引，设置项增删/重排后仍有效。
 * - 选择 `data-anchor` + `id` 双锚点：id 供原生 hash 跳转/scrollIntoView，
 *   data-anchor 供 JS 稳定查询（即使 id 被样式/路由占用也能定位）。
 *
 * 扩展原则：新增可跳转区块时在此文件追加同类常量，并在
 * SettingsScreen 的对应 Section 上绑定 id + data-anchor。
 */
export const SETTINGS_ANCHOR_EXTENSION_PACKAGES = "extension-packages";

/**
 * 对应的 DOM id（带 settings 前缀避免全局冲突）。
 * Section 渲染为 <section id={SETTINGS_SECTION_ID_EXTENSION_PACKAGES} data-anchor={SETTINGS_ANCHOR_EXTENSION_PACKAGES} ...>
 */
export const SETTINGS_SECTION_ID_EXTENSION_PACKAGES = "settings-section-extension-packages";

/**
 * 从 URL hash 中解析设置页锚点（RAY-364 复用）。
 * 支持 `?anchor=` 与 `#anchor` 两种可持续写法，刷新/直链保持。
 * 与 App.tsx 的 hash 同步逻辑保持一致，提取至此避免重复实现。
 */
export function parseSettingsAnchorFromHash(hash: string): string | null {
  const qIndex = hash.indexOf("?");
  if (qIndex !== -1) {
    const query = hash.slice(qIndex + 1).split("#")[0] ?? "";
    try {
      const params = new URLSearchParams(query);
      const anchor = params.get("anchor")?.trim();
      if (anchor) return anchor;
    } catch {
      // ignore malformed query
    }
  }
  const secondHash = hash.indexOf("#", 2);
  if (secondHash !== -1) {
    const frag =
      hash
        .slice(secondHash + 1)
        .split("?")[0]
        ?.trim() ?? "";
    if (frag && !frag.startsWith("/")) return frag;
  }
  return null;
}

/**
 * 稳定锚点定位：优先 data-anchor（业务稳定标识），回落 id。
 * 内置转义与 SyntaxError 静默，保证异常 anchor 不破坏页面（B1 加固）。
 */
export function findSettingsSectionByAnchor(anchor: string): Element | null {
  const trimmed = anchor.trim();
  if (!trimmed) return null;
  const esc =
    typeof CSS !== "undefined" && CSS.escape ? CSS.escape(trimmed) : trimmed.replace(/"/g, '\\"');
  let target: Element | null;
  try {
    target = document.querySelector(`[data-anchor="${esc}"]`);
  } catch {
    target = null;
  }
  if (target) return target;
  if (trimmed === SETTINGS_ANCHOR_EXTENSION_PACKAGES) {
    return document.getElementById(SETTINGS_SECTION_ID_EXTENSION_PACKAGES);
  }
  // 通用回落：尝试按 id 直接查找（同样需转义或捕获异常）
  try {
    // getElementById 不需要转义，但为对称保留 try/catch
    return document.getElementById(trimmed);
  } catch {
    return null;
  }
}
