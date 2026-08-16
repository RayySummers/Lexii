/**
 * 复习卡片：正面词条、背面释义，点击整卡（或空格）翻面。
 *
 * 批次 B 功能层（RAY-272）：背面在释义之外展示富化内容——
 * 例句（中英句对）、词根词缀拆解与中文词源、近反义词；正反面
 * 均展示美/英双音标（富化缺省回退词书自带音标）。
 * 富化字段全部可选：缺失时不渲染对应区块，卡片退化为既有形态。
 *
 * RAY-291（真机反馈）：卡片高度固定、与内容长度无关——不同词条
 * 不再让卡片忽长忽短；高度控制在移动端一屏内，内容超出时在卡片
 * 内部滚动（正反面同口径：共用同一 CardFace 结构，滚动区与固定
 * 底栏（翻面/评分提示）布局一致）。滚动区以 sense.id 为 key，换卡
 * 时重建、滚动位置不跨卡残留。
 *
 * 可访问性：
 * - 整卡是一个可聚焦的 <button>，aria-expanded 表达翻面（展开/收起）状态；
 * - 背面初始不可见且 aria-hidden，翻面后互换，屏幕阅读器只读到当前面；
 * - 双音标带独立 aria-label（美式音标 / 英式音标 / 音标）；
 * - 翻面动画尊重 prefers-reduced-motion（motion-reduce 下无过渡）；
 * - 翻面后焦点自动移到背面滚动区（tabindex=-1，不进 tab 序）——
 *   桌面键盘用户可直接用方向键滚动长释义（Oscar 评审 PR #45 suggestion 1）。
 */
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Sense } from "@lexilexi/core";
import { dualPhonetics, parseWordParts } from "./enrichmentUi";
import type { PhoneticBadge } from "./enrichmentUi";

export interface ReviewCardProps {
  sense: Sense;
  flipped: boolean;
  onFlip(): void;
  /** 背面评分快捷键提示（RAY-265：三档 / 四档文案不同，由界面层传入） */
  ratingHint: string;
}

/**
 * 固定高度公式常量（RAY-291）：卡片高度 = clamp(MIN, 100dvh − OFFSET, MAX)。
 *
 * ⚠ OFFSET 与卡片外布局强耦合：App 头（86px 含按钮边框）+ 页边距（64px）+
 * 顶部工具栏行（42px）+ 发音/标熟行（38px）+ 评分按钮（64px）+ 底部提示行
 * （16px）+ 四处 gap-6（96px）≈ 406px ≈ 25.4rem，取 26rem 留约 10px 余量。
 * 改动卡片外任何尺寸（头部/间距/按钮高度）必须同步 OFFSET——测试以本常量
 * 校验渲染结果，失同步即红（Oscar 评审 PR #45 suggestion 2：抽命名常量 +
 * 提醒注释，防失同步）。MIN 防止极端矮屏（横屏手机）不可用，MAX 限制
 * 高屏/桌面端过高。深色模式与离线不涉及（纯布局，无新依赖）。
 */
export const CARD_HEIGHT_MIN_REM = 14;
export const CARD_HEIGHT_OFFSET_REM = 26;
export const CARD_HEIGHT_MAX_REM = 32;

/** 卡片固定高度 style（唯一来源：上方常量，见常量注释的耦合提醒） */
export function cardHeightStyle(): CSSProperties {
  return {
    height: `clamp(${CARD_HEIGHT_MIN_REM}rem, calc(100dvh - ${CARD_HEIGHT_OFFSET_REM}rem), ${CARD_HEIGHT_MAX_REM}rem)`,
  };
}

export function ReviewCard({ sense, flipped, onFlip, ratingHint }: ReviewCardProps) {
  const wordParts = parseWordParts(sense.wordParts ?? "");
  const backScrollRef = useRef<HTMLDivElement | null>(null);

  // 翻面后把焦点移到背面滚动区（suggestion 1）：滚动区在整卡 <button> 内、
  // 不进入 tab 序（tabIndex=-1），程序化聚焦后桌面键盘用户可用方向键滚动
  // 长释义；rAF 等翻面状态提交后再聚焦，preventScroll 避免页面整体跳动。
  useEffect(() => {
    if (!flipped) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      backScrollRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [flipped]);

  return (
    <div className="[perspective:1200px]" style={cardHeightStyle()}>
      <button
        type="button"
        onClick={onFlip}
        aria-expanded={flipped}
        aria-label={flipped ? `隐藏 ${sense.term} 的释义` : `显示 ${sense.term} 的释义`}
        className="group grid h-full w-full cursor-pointer text-left [transform-style:preserve-3d] transition-transform duration-300 ease-out motion-reduce:transition-none [transform:rotateY(0deg)] aria-expanded:[transform:rotateY(180deg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <CardFace hidden={flipped}>
          <div
            key={sense.id}
            className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto overscroll-contain px-6 pb-4 pt-6"
          >
            <div className="m-auto flex flex-col items-center justify-center gap-3">
              <span className="text-4xl font-bold tracking-tight sm:text-5xl">{sense.term}</span>
              <span className="flex flex-wrap items-center justify-center gap-2 text-sm text-text-muted">
                <PhoneticsRow sense={sense} />
                {sense.pos ? (
                  <span className="rounded-full border border-border bg-surface-raised px-2 py-0.5">
                    {sense.pos}
                  </span>
                ) : null}
              </span>
              {sense.tags.length > 0 ? (
                <span className="flex flex-wrap justify-center gap-1">
                  {sense.tags.map((tag, index) => (
                    <span
                      key={`${index}:${tag}`}
                      className="rounded-full border border-border px-2 py-0.5 text-xs text-text-muted"
                    >
                      {tag}
                    </span>
                  ))}
                </span>
              ) : null}
            </div>
          </div>
          <span className="shrink-0 px-6 pb-5 pt-2 text-center text-xs text-text-muted">
            点击卡片或按空格查看释义
          </span>
        </CardFace>

        <CardFace hidden={!flipped} rotated>
          <div
            key={sense.id}
            ref={backScrollRef}
            tabIndex={-1}
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-6 pb-4 pt-6 outline-none"
          >
            <span className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="text-2xl font-bold tracking-tight">{sense.term}</span>
              <PhoneticsRow sense={sense} className="text-sm" />
            </span>
            <span className="flex flex-col gap-1.5">
              {sense.definitions.map((definition, index) => (
                <span key={`${index}:${definition}`} className="text-base leading-relaxed">
                  {index > 0 ? <span className="text-text-muted">{index + 1}. </span> : null}
                  {definition}
                </span>
              ))}
            </span>
            <CardSection title="例句" visible={sense.examples.length > 0}>
              {sense.examples.map((example, index) => (
                <span key={`${index}:${example.text}`} className="flex flex-col gap-0.5">
                  <span className="text-sm text-text-muted">{example.text}</span>
                  {example.translation ? (
                    <span className="text-sm">{example.translation}</span>
                  ) : null}
                </span>
              ))}
            </CardSection>
            <CardSection title="词根词缀" visible={wordParts.length > 0}>
              <ul className="flex flex-wrap gap-1.5">
                {wordParts.map((segment, index) => (
                  <li
                    key={`${index}:${segment.part}`}
                    className="rounded-lg border border-border bg-surface-raised px-2.5 py-0.5 text-sm"
                  >
                    <span className="font-semibold">{segment.part}</span>
                    {segment.meaning ? (
                      <span className="text-text-muted"> {segment.meaning}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </CardSection>
            <CardSection title="中文词源" visible={Boolean(sense.etymologyZh)}>
              <p className="text-sm leading-relaxed text-text-muted">{sense.etymologyZh}</p>
            </CardSection>
            <CardSection title="近义词" visible={(sense.synonyms?.length ?? 0) > 0}>
              <WordChips words={sense.synonyms ?? []} />
            </CardSection>
            <CardSection title="反义词" visible={(sense.antonyms?.length ?? 0) > 0}>
              <WordChips words={sense.antonyms ?? []} />
            </CardSection>
          </div>
          <span className="shrink-0 px-6 pb-5 pt-2 text-center text-xs text-text-muted">
            {ratingHint}
          </span>
        </CardFace>
      </button>
    </div>
  );
}

/** 美/英双音标行（富化缺省回退词书自带音标；无任何音标数据则不渲染） */
function PhoneticsRow({ sense, className = "" }: { sense: Sense; className?: string }) {
  const badges = dualPhonetics(sense);
  if (badges.length === 0) {
    return null;
  }
  return (
    <span className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 ${className}`}>
      {badges.map((badge, index) => (
        <span
          key={`${index}:${badge.value}`}
          aria-label={phoneticLabel(badge)}
          className="flex items-center gap-1"
        >
          {badge.label ? (
            <span className="rounded-full border border-border bg-surface-raised px-1.5 py-px text-xs">
              {badge.label}
            </span>
          ) : null}
          <span>{badge.value}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * 音标条目的读屏文案：标签与音标值并写。
 * aria-label 会替代内部文本成为 accessible name——只写标签会吞掉音标本体
 * （Oscar 对 PR #32 的 suggestion 1，正面旧实现 aria-label="音标" 同源问题一并修）。
 */
function phoneticLabel(badge: PhoneticBadge): string {
  const kind = badge.fallback ? "音标" : badge.label === "美" ? "美式音标" : "英式音标";
  return `${kind} ${badge.value}`;
}

/**
 * 背面富化内容区块：有标签的统一容器；无内容时整个区块不渲染。
 * 根元素用 <div> 而非 <span>：区块内含 <ul> / <p> 等 flow content，
 * span（phrasing）包 flow content 违反 HTML 嵌套规则（Oscar 对 PR #32 的
 * nit 1；与 CardFace 的 RAY-237 先例同口径）。
 */
function CardSection({
  title,
  visible,
  children,
}: {
  title: string;
  visible: boolean;
  children: ReactNode;
}) {
  if (!visible) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3">
      <span className="text-xs font-medium text-text-muted">{title}</span>
      {children}
    </div>
  );
}

/** 近反义词等词形列表：小圆角 chip 排列 */
function WordChips({ words }: { words: string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {words.map((word, index) => (
        <li
          key={`${index}:${word}`}
          className="rounded-full border border-border bg-surface-raised px-2.5 py-0.5 text-sm"
        >
          {word}
        </li>
      ))}
    </ul>
  );
}

interface CardFaceProps {
  children: ReactNode;
  /** 该面当前是否不可见（不可见时 aria-hidden） */
  hidden: boolean;
  /** 背面（需额外旋转 180° 以在翻转后正对用户） */
  rotated?: boolean;
}

/**
 * 卡片单面。外层用 <div> 而非 <span>：面内包含块级排版内容，
 * span 包 div 违反 HTML 嵌套规则（RAY-237 评审 nit）。
 *
 * RAY-291：h-full 填满固定高度的卡片按钮（正反面同口径，两面永远
 * 等高）；overflow-hidden 让面内滚动区（overflow-y-auto）在圆角内裁剪，
 * 超长内容不撑高卡片。内边距移到面内滚动区/底栏上：滚动内容贴边裁剪、
 * 底栏（翻面/评分提示）固定在卡片底部不参与滚动。
 */
function CardFace({ children, hidden, rotated = false }: CardFaceProps) {
  return (
    <div
      aria-hidden={hidden}
      className={`col-start-1 row-start-1 flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface [backface-visibility:hidden] ${
        rotated ? "[transform:rotateY(180deg)]" : ""
      }`}
    >
      {children}
    </div>
  );
}
