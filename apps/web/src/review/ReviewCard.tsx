/**
 * 复习卡片：正面词条、背面释义，点击整卡（或空格）翻面。
 *
 * 可访问性：
 * - 整卡是一个可聚焦的 <button>（内容仅 phrasing 元素），aria-pressed 表达翻面状态；
 * - 背面初始不可见且 aria-hidden，翻面后互换，屏幕阅读器只读到当前面；
 * - 翻面动画尊重 prefers-reduced-motion（motion-reduce 下无过渡）。
 */
import type { ReactNode } from "react";
import type { Sense } from "@lexilexi/core";

export interface ReviewCardProps {
  sense: Sense;
  flipped: boolean;
  onFlip(): void;
}

export function ReviewCard({ sense, flipped, onFlip }: ReviewCardProps) {
  return (
    <div className="[perspective:1200px]">
      <button
        type="button"
        onClick={onFlip}
        aria-pressed={flipped}
        aria-label={flipped ? `隐藏 ${sense.term} 的释义` : `显示 ${sense.term} 的释义`}
        className="group grid w-full cursor-pointer text-left [transform-style:preserve-3d] transition-transform duration-300 ease-out motion-reduce:transition-none [transform:rotateY(0deg)] aria-pressed:[transform:rotateY(180deg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
      >
        <CardFace hidden={flipped}>
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <span className="text-4xl font-bold tracking-tight sm:text-5xl">{sense.term}</span>
            <span className="flex items-center gap-2 text-sm text-text-muted">
              {sense.ipa ? <span aria-label="音标">/{sense.ipa}/</span> : null}
              {sense.pos ? (
                <span className="rounded-full border border-border bg-surface-raised px-2 py-0.5">
                  {sense.pos}
                </span>
              ) : null}
            </span>
            {sense.tags.length > 0 ? (
              <span className="flex flex-wrap justify-center gap-1">
                {sense.tags.map((tag) => (
                  <span
                    key={tag}
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
            <span className="flex items-baseline justify-between gap-3">
              <span className="text-2xl font-bold tracking-tight">{sense.term}</span>
              {sense.ipa ? <span className="text-sm text-text-muted">/{sense.ipa}/</span> : null}
            </span>
            <span className="flex flex-col gap-1.5">
              {sense.definitions.map((definition, index) => (
                <span key={definition} className="text-base leading-relaxed">
                  {index > 0 ? <span className="text-text-muted">{index + 1}. </span> : null}
                  {definition}
                </span>
              ))}
            </span>
            {sense.examples.length > 0 ? (
              <span className="flex flex-col gap-1.5 border-t border-border pt-3">
                {sense.examples.map((example) => (
                  <span key={example.text} className="flex flex-col gap-0.5">
                    <span className="text-sm text-text-muted">{example.text}</span>
                    <span className="text-sm">{example.translation}</span>
                  </span>
                ))}
              </span>
            ) : null}
          </div>
          <span className="mt-4 text-center text-xs text-text-muted">
            按 1–4（或 A / H / G / E）评分
          </span>
        </CardFace>
      </button>
    </div>
  );
}

interface CardFaceProps {
  children: ReactNode;
  /** 该面当前是否不可见（不可见时 aria-hidden） */
  hidden: boolean;
  /** 背面（需额外旋转 180° 以在翻转后正对用户） */
  rotated?: boolean;
}

function CardFace({ children, hidden, rotated = false }: CardFaceProps) {
  return (
    <span
      aria-hidden={hidden}
      className={`col-start-1 row-start-1 flex min-h-64 flex-col rounded-2xl border border-border bg-surface p-6 [backface-visibility:hidden] sm:min-h-72 ${
        rotated ? "[transform:rotateY(180deg)]" : ""
      }`}
    >
      {children}
    </span>
  );
}
