/**
 * 卡片字体管理（RAY-323，RAY-359）。
 *
 * - 偏好（CardFont）持久化到 localStorage（与主题、发音口音、生词本开关
 *   同一持久化模式），由 src/lib/cardFont 解析/读写；
 * - 实际应用：把档位同步到 <html data-card-font="...">，由 styles/tokens.css
 *   内对应规则把 --lex-card-font 切到该档的 font-family 字符串；
 *   复习卡本体（ReviewCard 词条）引用 var(--lex-card-font)，下次渲染即生效；
 * - 跨标签页同步（与 useTheme 同口径）：监听 storage 事件，其他标签页
 *   变更时本页自动跟随；存储被清除时回落默认现代简约。
 * - RAY-359 迁移：旧存量 "newsreader" 跨标签同步时映射到 "sentient"。
 *
 * 之所以不放在 useTheme 内部、而是独立 hook：
 * - 主题与字体是两套独立偏好，未来扩展（如字号、字重）也应各自独立；
 * - 各自 hook 维护各自的 effect 生命周期，避免互相耦合的全局副作用
 *   （评审 C-12 可维护性）。
 *
 * 不放在 useTheme 里同步到 <html data-theme> 之外：data-theme 关注的是
 * 颜色 token，data-card-font 关注的是 font-family 字符串，两者在 CSS
 * 里用独立选择器维护更清晰（评审 C-11 性能：避免无谓的"主题 vs 字体"
 * 状态联动导致不必要的 effect 重跑）。
 */
import { useCallback, useEffect, useState } from "react";
import {
  CARD_FONT_STORAGE_KEY,
  DEFAULT_CARD_FONT,
  isCardFont,
  readCardFont,
  writeCardFont,
} from "../lib/cardFont";
import type { CardFont } from "../lib/cardFont";

export { CARD_FONT_OPTIONS } from "../lib/cardFont";
export type { CardFont } from "../lib/cardFont";

export interface UseCardFontResult {
  /** 当前应用的卡片字体档位 */
  font: CardFont;
  /** 设置卡片字体（立即持久化并同步到 <html data-card-font>） */
  setFont(font: CardFont): void;
}

function getInitialFont(): CardFont {
  return readCardFont();
}

/**
 * 把当前档位同步到 <html data-card-font>，CSS 端据此切换 --lex-card-font。
 * 服务端渲染 / 旧浏览器没 document 时静默跳过。
 */
function applyFontToDocument(font: CardFont): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.dataset.cardFont = font;
}

export function useCardFont(): UseCardFontResult {
  const [font, setFontState] = useState<CardFont>(getInitialFont);

  // 挂载即同步到 DOM：保证 SSR / 首屏渲染后的第一帧 CSS 变量就是当前档位
  // （与 useTheme 初始化逻辑同口径：DOM 侧立即可用，状态在 React 端随后追平）
  useEffect(() => {
    applyFontToDocument(font);
  }, [font]);

  const setFont = useCallback((next: CardFont) => {
    setFontState(next);
    writeCardFont(next);
    // 写入与同步：DOM 同步在 useEffect 里随 state 完成；这里额外同步一次
    // 是为了在某些极端情况下（如 storage 写失败但 React state 已更新）
    // 仍让 DOM 反映最新档位——双保险，幂等。
    applyFontToDocument(next);
  }, []);

  // 跨标签页同步（与 useTheme 评审 suggestion 1 同口径）：
  // storage 事件只在本页之外写入时触发，本页自身的持久化不会触发本页监听。
  // 三种情形分别处理：key 为 null（其他标签页 storage.clear()）→ 回落默认；
  // key 匹配且值合法 → 采用新档位；key 匹配但值被移除（null）→ 回落默认。
  // RAY-359：旧值 "newsreader" 平滑迁移到 "sentient"。
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null) {
        setFontState(DEFAULT_CARD_FONT);
        return;
      }
      if (event.key !== CARD_FONT_STORAGE_KEY) {
        return;
      }
      if (event.newValue === "newsreader") {
        setFontState("sentient");
        return;
      }
      if (isCardFont(event.newValue)) {
        setFontState(event.newValue);
      } else if (event.newValue === null) {
        setFontState(DEFAULT_CARD_FONT);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return { font, setFont };
}
