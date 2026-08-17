/**
 * 富化字段的展示辅助（RAY-272 批次 B 功能层）。
 *
 * 纯函数、仅依赖 React createElement：组件只做渲染，双音标选择与
 * 词根词缀拆解的解析口径集中在此，便于单测锁定行为。
 */
import { createElement, type ReactNode } from "react";
import type { Sense } from "@lexii/core";

/** 双音标展示条目 */
export interface PhoneticBadge {
  /** 可见标签：美 / 英；回退词书自带 ipa 时为空（无标签） */
  label: string;
  /** 音标文本：富化数据自带斜杠原样展示；回退 ipa 无斜杠、此处补全 */
  value: string;
  /** 是否由词书自带 ipa 回退而来（无美/英数据时） */
  fallback: boolean;
}

/**
 * 双音标选择口径（与 domain.ts §Sense 注释一致）：优先展示美/英双音标，
 * 全部缺省时回退词书自带 ipa。富化数据（ipa-dict）自带斜杠（如 /əˈbændən/），
 * 回退 ipa 与词库 CSV 一致不带斜杠，由这里补全。
 */
export function dualPhonetics(sense: Pick<Sense, "ipa" | "ipaUs" | "ipaUk">): PhoneticBadge[] {
  const badges: PhoneticBadge[] = [];
  if (sense.ipaUs) {
    badges.push({ label: "美", value: sense.ipaUs, fallback: false });
  }
  if (sense.ipaUk) {
    badges.push({ label: "英", value: sense.ipaUk, fallback: false });
  }
  if (badges.length === 0 && sense.ipa) {
    badges.push({ label: "", value: `/${sense.ipa}/`, fallback: true });
  }
  return badges;
}

/** 词根词缀拆解段（解析自 wordParts 的 "词素<含义> · 词素<含义>" 形态） */
export interface WordPartSegment {
  /** 词素（前缀 / 词根 / 后缀） */
  part: string;
  /** 含义说明（可能为空） */
  meaning: string;
}

/**
 * 解析词根词缀拆解（OpenEtymology 形态，如 "a<加强> · bandon<控制>"）。
 *
 * 防御性口径：
 * - 无 "<…>" 的段整体视为词素、无含义；
 * - 含义中残留的 ">"（打包侧截断可能留下）一律剥离；
 * - 空段与空白段丢弃。
 */
export function parseWordParts(raw: string): WordPartSegment[] {
  return raw
    .split(" · ")
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "")
    .map((segment) => {
      const lt = segment.indexOf("<");
      if (lt < 0) {
        return { part: segment, meaning: "" };
      }
      const part = segment.slice(0, lt).trim();
      const meaning = segment
        .slice(lt + 1)
        .replaceAll(">", "")
        .trim();
      return { part: part !== "" ? part : segment, meaning };
    });
}

/**
 * 轻量内联 Markdown → React 元素（仅处理斜体：`*text*` / `_text_`）。
 *
 * 中文词源说明（etymologyZh）来自 OpenEtymology EPUB，内含 Markdown
 * 斜体标记（如下划线包裹的外来语）。此函数将纯文本中的斜体语法
 * 转换为 <em> 元素，其余文字保持原样。
 *
 * 防御性口径：
 * - 匹配 `*…*` 或 `_…_`（不含空格开头/结尾的非贪婪匹配）；
 * - 未闭合的标记原样输出，不做猜测；
 * - 返回 ReactNode 数组，可直接嵌入 JSX。
 */
export function parseInlineMarkdown(text: string): ReactNode[] {
  // 匹配 *text* 或 _text_（斜体）
  const italicPattern = /([*_])(?!\s)(.+?)(?<!\s)\1/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = italicPattern.exec(text)) !== null) {
    // 斜体标记前的普通文本
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    // 斜体内容渲染为 <em>
    parts.push(createElement("em", { key: `em-${match.index}` }, match[2]));
    lastIndex = match.index + match[0].length;
  }

  // 剩余普通文本
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}
