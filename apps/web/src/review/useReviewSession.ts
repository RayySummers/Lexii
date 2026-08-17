/**
 * 复习会话状态机（UI 状态，不含调度逻辑）。
 *
 * 阶段流转：
 *   loading → reviewing（队列非空）
 *          → no-due（词库有词但今日无到期）
 *          → empty（词库为空，引导导入示例词表）
 *          → error（数据源异常，可重试）
 *   reviewing → done（全部评完）
 *
 * 计时：每张卡显示时刻记录 cardShownAt，评分时差值得 reviewDurationMs
 * （与 core gradeReview 的输入对齐）；翻面只影响 revealed 标记，不影响计时。
 *
 * RAY-265 单步撤销：每次评分 / 标熟成功后保存撤销快照（被评卡下标 +
 * 事件 id + 评分前状态），可返回上一步撤销这一次操作；连续只能撤销一次
 * ——撤销成功后快照清空，不允许连退。撤销完整回滚调度状态与学习记录
 * （core undoReview 单事务），统计口径随事件删除自然一致。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { EventId, MemoryState, ReviewRating, StudyMode } from "@lexii/core";
import type { GradeContext, ReviewCard, ReviewDataProvider } from "../review/types";

export type SessionPhase = "loading" | "empty" | "no-due" | "reviewing" | "done" | "error";

/** 一次评分 / 标熟的撤销快照（单步撤销证据） */
export interface UndoSnapshot {
  /** 被评卡在队列中的下标（撤销后回到这张卡） */
  index: number;
  /** 被评卡（memory 已回退为评分前状态，撤销后重新展示） */
  card: ReviewCard;
  /** 落库的复习事件 id（撤销时删除） */
  eventId: EventId;
  /** 评分前的记忆状态（撤销时原样恢复） */
  previousMemoryState: MemoryState;
  /** 评分前的已评数（撤销时恢复，完成页计数不虚增） */
  gradedCountBefore: number;
}

export interface ReviewSession {
  phase: SessionPhase;
  /** 当前队列（reviewing 时非空） */
  cards: readonly ReviewCard[];
  /** 当前卡片下标（reviewing 时有效） */
  index: number;
  /** 当前卡片（reviewing 时非空） */
  current: ReviewCard | null;
  /** 当前卡是否已翻面 */
  flipped: boolean;
  /** 已评分的卡数 */
  gradedCount: number;
  /** 总卡数 */
  totalCount: number;
  error: string | null;
  /** 导入示例词表进行中 */
  importing: boolean;
  /** 是否可撤销上一步（每次评分/标熟后为 true，撤销成功或新操作后清空） */
  canUndo: boolean;
  /**
   * 队列为空且「每日新卡额度已用完、词库仍有未学新词」（RAY-276 诊断线 3）：
   * 界面据此展示额度耗尽文案，而不是「没有待学习的新词」。
   */
  newCardQuotaExhausted: boolean;
  /** 翻面（可在正面/背面间切换） */
  flip(): void;
  /** 评分并进入下一张卡；队列评完进入 done */
  grade(rating: ReviewRating): Promise<void>;
  /** 标熟（RAY-265）：记录「已熟」评级并按长间隔排期，然后进入下一张卡 */
  markMastered(): Promise<void>;
  /** 撤销上一步评分 / 标熟（单步；连续只能撤销一次） */
  undo(): Promise<void>;
  /** 空状态一键导入内置示例词表，成功后直接进入复习 */
  importSample(): Promise<void>;
  /** 数据源失败后重试加载 */
  retry(): void;
}

interface SessionState {
  phase: SessionPhase;
  cards: ReviewCard[];
  index: number;
  flipped: boolean;
  gradedCount: number;
  error: string | null;
  importing: boolean;
  /** 撤销快照（null = 当前无撤销目标） */
  undoSnapshot: UndoSnapshot | null;
  /** 每日新卡额度耗尽标记（RAY-276 诊断线 3；仅 no-due 阶段有意义） */
  newCardQuotaExhausted: boolean;
}

const INITIAL_STATE: SessionState = {
  phase: "loading",
  cards: [],
  index: 0,
  flipped: false,
  gradedCount: 0,
  error: null,
  importing: false,
  undoSnapshot: null,
  newCardQuotaExhausted: false,
};

/** 数据源错误 → 统一错误文案（不向用户暴露内部实现细节） */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useReviewSession(provider: ReviewDataProvider, mode: StudyMode): ReviewSession {
  const [state, setState] = useState<SessionState>(INITIAL_STATE);
  // 状态机之外的时序数据：避免异步竞态与 StrictMode 双调用
  const loadIdRef = useRef(0);
  const cardShownAtRef = useRef(0);
  const gradingRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const apply = useCallback((patch: Partial<SessionState>) => {
    setState((previous) => ({ ...previous, ...patch }));
  }, []);

  /** 重置会话到「队列待复习」状态（进入新队列 / 重试成功后） */
  const startReviewing = useCallback(
    (cards: ReviewCard[]) => {
      cardShownAtRef.current = Date.now();
      apply({
        phase: "reviewing",
        cards,
        index: 0,
        flipped: false,
        gradedCount: 0,
        error: null,
        importing: false,
        undoSnapshot: null,
      });
    },
    [apply],
  );

  const load = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    apply({
      phase: "loading",
      error: null,
      cards: [],
      index: 0,
      flipped: false,
      undoSnapshot: null,
      newCardQuotaExhausted: false,
    });
    try {
      const [queue, hasItems] = await Promise.all([
        provider.loadQueue(mode),
        provider.hasAnyItems(),
      ]);
      if (loadId !== loadIdRef.current) {
        return; // 已有更新的加载请求（StrictMode 双调用 / 重试竞态），丢弃过期结果
      }
      if (queue.length > 0) {
        startReviewing(queue);
      } else {
        apply({ phase: hasItems ? "no-due" : "empty", importing: false });
        // 队列为空时区分「额度已用完」与「没有内容」（RAY-276 诊断线 3）。
        // 元信息查询失败静默降级为不展示额度文案（不阻塞空状态展示）。
        if (hasItems && provider.loadQueueMeta) {
          try {
            const meta = await provider.loadQueueMeta(mode);
            if (
              loadId !== loadIdRef.current ||
              meta.remainingNewCardQuota === null ||
              meta.remainingNewCardQuota > 0 ||
              !meta.hasDueNewWords
            ) {
              return;
            }
            apply({ newCardQuotaExhausted: true });
          } catch {
            // 静默降级：元信息失败不影响 no-due 空状态
          }
        }
      }
    } catch (error) {
      if (loadId !== loadIdRef.current) {
        return;
      }
      apply({ phase: "error", error: toErrorMessage(error) });
    }
  }, [provider, mode, apply, startReviewing]);

  useEffect(() => {
    void load();
  }, [load]);

  const flip = useCallback(() => {
    const current = stateRef.current;
    if (current.phase !== "reviewing") {
      return;
    }
    apply({ flipped: !current.flipped });
  }, [apply]);

  /**
   * 提交一次「评分落库 + 队列推进」操作（grade / markMastered 共用路径）。
   * 成功后保存撤销快照（RAY-265）：新快照覆盖旧快照，撤销目标始终是
   * 「上一步」操作；进入下一张卡或 done。
   */
  const commitGrade = useCallback(
    async (
      run: (
        card: ReviewCard,
        context: GradeContext,
      ) => Promise<{
        reviewEventId: EventId;
        previousMemoryState: MemoryState;
      }>,
    ) => {
      if (gradingRef.current) {
        return; // 防止连按 / 键盘重复触发对同一张卡产生两次评分
      }
      const current = stateRef.current;
      if (current.phase !== "reviewing") {
        return;
      }
      const card = current.cards[current.index];
      if (!card) {
        return;
      }
      const context: GradeContext = {
        reviewDurationMs: Date.now() - cardShownAtRef.current,
        revealed: current.flipped,
      };
      gradingRef.current = true;
      let result: { reviewEventId: EventId; previousMemoryState: MemoryState };
      try {
        result = await run(card, context);
      } catch (error) {
        gradingRef.current = false;
        apply({ phase: "error", error: toErrorMessage(error) });
        return;
      }
      gradingRef.current = false;
      const gradedCount = current.gradedCount + 1;
      const undoSnapshot: UndoSnapshot = {
        index: current.index,
        card: { ...card, memory: result.previousMemoryState },
        eventId: result.reviewEventId,
        previousMemoryState: result.previousMemoryState,
        gradedCountBefore: current.gradedCount,
      };
      if (current.index + 1 >= current.cards.length) {
        apply({ phase: "done", gradedCount, undoSnapshot });
      } else {
        cardShownAtRef.current = Date.now();
        apply({
          phase: "reviewing",
          index: current.index + 1,
          flipped: false,
          gradedCount,
          undoSnapshot,
        });
      }
    },
    [provider, apply],
  );

  const grade = useCallback(
    async (rating: ReviewRating) => {
      await commitGrade((card, context) => provider.grade(card, rating, context));
    },
    [provider, commitGrade],
  );

  const markMastered = useCallback(async () => {
    await commitGrade((card, context) => provider.markMastered(card, context));
  }, [provider, commitGrade]);

  /** 撤销上一步评分 / 标熟（单步：成功后快照清空，不允许连退） */
  const undo = useCallback(async () => {
    const current = stateRef.current;
    const snapshot = current.undoSnapshot;
    if (!snapshot) {
      return;
    }
    if (current.phase !== "reviewing" && current.phase !== "done") {
      return;
    }
    try {
      await provider.undoGrade(
        snapshot.card.item.id,
        snapshot.eventId,
        snapshot.previousMemoryState,
      );
    } catch (error) {
      apply({ phase: "error", error: toErrorMessage(error) });
      return;
    }
    cardShownAtRef.current = Date.now();
    // 队列中该卡的记忆状态回退为评分前状态（到期预览与再次评分保持一致）
    const cards = [...current.cards];
    if (cards[snapshot.index]?.item.id === snapshot.card.item.id) {
      cards[snapshot.index] = snapshot.card;
    }
    apply({
      phase: "reviewing",
      cards,
      index: snapshot.index,
      flipped: false,
      gradedCount: snapshot.gradedCountBefore,
      error: null,
      importing: false,
      undoSnapshot: null,
    });
  }, [provider, apply]);

  const importSample = useCallback(async () => {
    apply({ importing: true });
    try {
      await provider.importSampleWordlist();
      // 导入完成重新加载队列：新词 due 为导入时刻，立即进入复习
      await load();
    } catch (error) {
      apply({ phase: "error", error: toErrorMessage(error), importing: false });
    }
  }, [provider, apply, load]);

  const retry = useCallback(() => {
    void load();
  }, [load]);

  return {
    phase: state.phase,
    cards: state.cards,
    index: state.index,
    current: state.phase === "reviewing" ? (state.cards[state.index] ?? null) : null,
    flipped: state.flipped,
    gradedCount: state.gradedCount,
    totalCount: state.cards.length,
    error: state.error,
    importing: state.importing,
    canUndo: state.undoSnapshot !== null,
    newCardQuotaExhausted: state.newCardQuotaExhausted,
    flip,
    grade,
    markMastered,
    undo,
    importSample,
    retry,
  };
}
