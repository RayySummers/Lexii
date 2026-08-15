/**
 * 首页：三模式入口（学习 / 复习 / 混合）+ 学习形式切换（卡片 / 选择题）
 *      + 今日待学徽标 + 今日新卡额度提示。
 *
 * RAY-253 反馈 1：首页保持简洁——不显示品牌名与介绍文案（原文已归档到
 * docs/archive/homepage-intro-v1.md，供以后建站使用），只保留三个模式按钮。
 *
 * RAY-254：徽标文案「今日到期」→「今日待学」——dueCount 含 reps===0 的新词，
 * 「待学」明确涵盖新词 + 到期复习；统计口径（stats.dueCount 语义）不变。
 *
 * RAY-260（Oscar 复评 suggestion 2）：徽标「今日待学」用未截断的到期数，
 * 与每日新卡上限下实际可学的队列存在数字差（如首装后徽标 7,195、每日只学
 * 20）。三模式入口下方补一行「今日新卡额度剩余 N 张」，注明超出顺延，
 * 降低用户困惑——额度 = 设置上限 − 今日已学新词（stats.todayLearnCount）。
 *
 * RAY-269：新增选择题学习模式。首页添加学习形式切换（卡片 / 选择题），
 * 用户可先选形式再选模式。默认卡片形式（向后兼容）。
 *
 * - 待学徽标数据经 StatsDataProvider（statsProvider 为 null 时不展示，
 *   如无 IndexedDB 的测试环境）；
 * - 仅承载展示与导航，队列数据一律由 ReviewScreen / QuizScreen 按模式加载；
 * - 全部颜色走 design tokens（浅色/深色两套自动生效）。
 */
import { useState, type ReactNode } from "react";
import type { StudyMode } from "@lexilexi/core";
import { readDailyNewCardLimit } from "./lib/dailyNewCardLimit";
import { useStats } from "./stats/useStats";
import type { StatsDataProvider } from "./stats/types";

/** 学习形式：卡片翻转 vs 选择题 */
export type StudyFormat = "card" | "quiz";

export interface HomeScreenProps {
  /** 进入对应学习模式（学习 / 复习 / 混合）与形式（卡片 / 选择题） */
  onStart(mode: StudyMode, format: StudyFormat): void;
  /** 统计数据源（今日待学徽标；null = 环境不支持，不展示徽标） */
  statsProvider: StatsDataProvider | null;
}

/** 三个模式按钮的静态配置（副标题为装饰性说明，aria-hidden） */
const MODES = [
  { mode: "learn", title: "学习", subtitle: "新词学习" },
  { mode: "review", title: "复习", subtitle: "到期复习" },
  { mode: "mixed", title: "混合", subtitle: "复习穿插新词" },
] as const satisfies readonly { mode: StudyMode; title: string; subtitle: string }[];

/** 学习形式切换配置 */
const FORMATS = [
  { format: "card" as const, title: "卡片", subtitle: "翻转记忆" },
  { format: "quiz" as const, title: "选择题", subtitle: "辨识练习" },
];

export function HomeScreen({ onStart, statsProvider }: HomeScreenProps) {
  const { stats } = useStats(statsProvider);
  const [format, setFormat] = useState<StudyFormat>("card");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
      {/* 学习形式切换 */}
      <div className="flex items-center gap-2" role="radiogroup" aria-label="学习形式">
        {FORMATS.map(({ format: f, title, subtitle }) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={format === f}
            onClick={() => setFormat(f)}
            className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
              format === f
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-surface text-text-muted hover:border-primary"
            }`}
          >
            <span>{title}</span>
            <span aria-hidden="true" className="text-xs opacity-60">
              {subtitle}
            </span>
          </button>
        ))}
      </div>

      {/* 三模式入口 */}
      <div className="grid gap-4 sm:grid-cols-3">
        {MODES.map(({ mode, title, subtitle }) => (
          <button
            key={mode}
            type="button"
            onClick={() => onStart(mode, format)}
            className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-6 text-left transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <span className="text-xl font-semibold">{title}</span>
            <span aria-hidden="true" className="text-sm text-text-muted">
              {subtitle}
            </span>
          </button>
        ))}
      </div>

      <DueBadge
        dueCount={stats?.dueCount ?? null}
        hasReviewed={stats !== null && stats.reviewCount > 0}
      />

      {stats !== null && stats.dueCount > 0 ? (
        <NewCardQuotaHint learnedToday={stats.todayLearnCount} />
      ) : null}
    </main>
  );
}

/**
 * 今日新卡额度提示（RAY-260 复评 suggestion 2）：
 * 额度 = 设置上限 − 今日已学新词数（下限 0）。仅在有待学词（dueCount > 0）
 * 时展示——徽标数字是未截断的到期数，与 20/日上限下实际可学的队列存在
 * 数字差，此提示说明二者关系；语义与复习页的实际截取一致（超出顺延）。
 */
function NewCardQuotaHint({ learnedToday }: { learnedToday: number }) {
  const remaining = Math.max(0, readDailyNewCardLimit() - learnedToday);
  return (
    <p className="text-sm text-text-muted">
      今日新卡额度剩余 {remaining} 张，超出部分顺延到之后的日子。
    </p>
  );
}

/**
 * 今日待学徽标：
 * - 有待学词（新词或到期复习）→ 强调徽标「今日待学 N 词」；
 * - 无待学词但复习过 → 弱化文案「今日无待学词」；
 * - 数据未加载 / 无任何学习记录 → 无内容。
 *
 * 可访问性（Oscar 评审 C5）：live region 容器固定挂载、只切换内部内容——
 * 部分读屏器不播报「动态插入的 live region」；role="status" 隐含
 * aria-live="polite" + aria-atomic="true"，徽标文本异步出现时会被播报。
 */
function DueBadge({ dueCount, hasReviewed }: { dueCount: number | null; hasReviewed: boolean }) {
  let content: ReactNode = null;
  if (dueCount !== null && dueCount > 0) {
    content = (
      <span className="rounded-full border border-accent/40 bg-surface px-4 py-1.5 text-sm font-medium text-accent">
        今日待学 {dueCount} 词
      </span>
    );
  } else if (dueCount !== null && hasReviewed) {
    content = <span className="text-sm text-text-muted">今日无待学词，休息一下。</span>;
  }
  return <div role="status">{content}</div>;
}
