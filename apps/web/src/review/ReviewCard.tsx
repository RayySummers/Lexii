/**
 * 复习卡片：正面词条、背面释义，点击整卡（或空格）翻面。
 *
 * 批次 B 功能层（RAY-272）：背面在释义之外展示富化内容——
 * 例句（中英句对）、词根词缀拆解与中文词源、近反义词；正反面
 * 均展示美/英双音标（富化缺省回退词书自带音标）。
 * 富化字段全部可选：缺失时不渲染对应区块，卡片退化为既有形态。
 *
 * 可访问性：
 * - 整卡是一个可聚焦的 <button>，aria-expanded 表达翻面（展开/收起）状态；
 * - 背面初始不可见且 aria-hidden，翻面后互换，屏幕阅读器只读到当前面；
 * - 双音标带独立 aria-label（美式音标 / 英式音标 / 音标）；
 * - 翻面动画尊重 prefers-reduced-motion（motion-reduce 下无过渡）。
 */
import type { ReactNode } from "react";
import type { Sense } from "@lexilexi/core";
import { dualPhonetics, parseWordParts } from "./enrichmentUi";

export interface ReviewCardProps {
  sense: Sense;
  flipped: boolean;
  onFlip(): void;
}

export function ReviewCard({ sense, flipped, onFlip }: ReviewCardProps) {
  const wordParts = parseWordParts(sense.wordParts ?? "");
  return (
    <div className="[perspective:1200px]">
      <button
        type="button"
        onClick={onFlip}
        aria-expanded={flipped}
        aria-label={flipped ? `隐藏 ${sense.term} 的释义` : `显示 ${sense.term} 的释义`}
        className="group grid w-full cursor-pointer text-left [transform-style:preserve-3d] transition-transform duration-300 ease-out motion-reduce:transition-none [transform:rotateY(0deg)] aria-expanded:[transform:rotateY(180deg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <CardFace hidden={flipped}>
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
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
          <span className="mt-4 text-center text-xs text-text-muted">点击卡片或按空格查看释义</span>
        </CardFace>

        <CardFace hidden={!flipped} rotated>
          <div className="flex w-full flex-col gap-3">
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
          <span className="mt-4 text-center text-xs text-text-muted">
            按 1–4（或 A / H / G / E）评分
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
          aria-label={badge.fallback ? "音标" : badge.label === "美" ? "美式音标" : "英式音标"}
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

/** 背面富化内容区块：有标签的统一容器；无内容时整个区块不渲染 */
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
    <span className="flex flex-col gap-1.5 border-t border-border pt-3">
      <span className="text-xs font-medium text-text-muted">{title}</span>
      {children}
    </span>
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
 */
function CardFace({ children, hidden, rotated = false }: CardFaceProps) {
  return (
    <div
      aria-hidden={hidden}
      className={`col-start-1 row-start-1 flex min-h-64 flex-col rounded-2xl border border-border bg-surface p-6 [backface-visibility:hidden] sm:min-h-72 ${
        rotated ? "[transform:rotateY(180deg)]" : ""
      }`}
    >
      {children}
    </div>
  );
}
