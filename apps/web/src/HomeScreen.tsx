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
 * RAY-278（返工裁定，2026-08-16 Rayy 澄清）：手机端三模式按钮竖排
 * （一排一个）本就是期望形态——`sm:grid-cols-3` 的 <640px 单列堆叠保持
 * 不动，桌面端（≥640px）一排三个。真实问题在背单词页评分按钮，见
 * review/RatingButtons.tsx。
 *
 * - 待学徽标数据经 StatsDataProvider（statsProvider 为 null 时不展示，
 *   如无 IndexedDB 的测试环境）；
 * - 仅承载展示与导航，队列数据一律由 ReviewScreen / QuizScreen 按模式加载；
 * - RAY-284：三模式入口下方新增「学习列表包含生词本」开关（默认开）——
 *   关闭后生词本词条从学习/复习/混合队列与到期统计中排除（词书条目不受
 *   影响）；切换后刷新待学徽标，队列在下次进入复习页加载时生效；
 * - 全部颜色走 design tokens（浅色/深色两套自动生效）。
 */
import { useCallback, useState, type ReactNode } from "react";
import type { StudyMode } from "@lexilexi/core";
import { readDailyNewCardLimit } from "./lib/dailyNewCardLimit";
import { readIncludeNotebook, writeIncludeNotebook } from "./lib/notebookPreference";
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
  const { stats, reload } = useStats(statsProvider);
  const [format, setFormat] = useState<StudyFormat>("card");
  // 生词本开关（RAY-284）：懒初始化读一次；切换写回 localStorage 并刷新
  // 待学徽标（统计口径随开关一致），队列在下次进入复习页时按新偏好加载
  const [includeNotebook, setIncludeNotebook] = useState<boolean>(() => readIncludeNotebook());

  const toggleIncludeNotebook = useCallback(() => {
    setIncludeNotebook((previous) => {
      const next = !previous;
      writeIncludeNotebook(next);
      return next;
    });
    reload();
  }, [reload]);

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

      {/* 三模式入口（RAY-278 返工：移动端竖排为期望形态，桌面一排三个） */}
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

      {/* 生词本开关（RAY-284）：学习列表是否包含生词本（独立于词书） */}
      <div className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-surface p-5">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold">学习列表包含生词本</span>
          <span className="text-xs text-text-muted">
            关闭后，生词本的词不再进入学习 / 复习 / 混合队列，词书不受影响。
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={includeNotebook}
          aria-label="学习列表是否包含生词本"
          onClick={toggleIncludeNotebook}
          className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
            includeNotebook ? "border-primary bg-primary" : "border-border bg-surface-raised"
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-primary-contrast transition-all ${
              includeNotebook ? "left-[calc(100%-1.25rem)]" : "left-1"
            }`}
          />
        </button>
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
