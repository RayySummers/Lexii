/**
 * 富化字段的展示辅助（RAY-272 批次 B 功能层）。
 *
 * 纯函数、无 React 依赖：组件只做渲染，双音标选择与词根词缀拆解
 * 的解析口径集中在此，便于单测锁定行为。
 */
import type { Sense } from "@lexilexi/core";

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
