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
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewRating } from "@lexilexi/core";
import type { GradeContext, ReviewCard, ReviewDataProvider } from "../review/types";

export type SessionPhase = "loading" | "empty" | "no-due" | "reviewing" | "done" | "error";

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
  /** 翻面（可在正面/背面间切换） */
  flip(): void;
  /** 评分并进入下一张卡；队列评完进入 done */
  grade(rating: ReviewRating): Promise<void>;
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
}

const INITIAL_STATE: SessionState = {
  phase: "loading",
  cards: [],
  index: 0,
  flipped: false,
  gradedCount: 0,
  error: null,
  importing: false,
};

/** 数据源错误 → 统一错误文案（不向用户暴露内部实现细节） */
function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useReviewSession(provider: ReviewDataProvider): ReviewSession {
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
      });
    },
    [apply],
  );

  const load = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    apply({ phase: "loading", error: null, cards: [], index: 0, flipped: false });
    try {
      const [queue, hasItems] = await Promise.all([provider.loadQueue(), provider.hasAnyItems()]);
      if (loadId !== loadIdRef.current) {
        return; // 已有更新的加载请求（StrictMode 双调用 / 重试竞态），丢弃过期结果
      }
      if (queue.length > 0) {
        startReviewing(queue);
      } else {
        apply({ phase: hasItems ? "no-due" : "empty", importing: false });
      }
    } catch (error) {
      if (loadId !== loadIdRef.current) {
        return;
      }
      apply({ phase: "error", error: toErrorMessage(error) });
    }
  }, [provider, apply, startReviewing]);

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

  const grade = useCallback(
    async (rating: ReviewRating) => {
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
      try {
        await provider.grade(card, rating, context);
      } catch (error) {
        gradingRef.current = false;
        apply({ phase: "error", error: toErrorMessage(error) });
        return;
      }
      gradingRef.current = false;
      const gradedCount = current.gradedCount + 1;
      if (current.index + 1 >= current.cards.length) {
        apply({ phase: "done", gradedCount });
      } else {
        cardShownAtRef.current = Date.now();
        apply({ phase: "reviewing", index: current.index + 1, flipped: false, gradedCount });
      }
    },
    [provider, apply],
  );

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
    flip,
    grade,
    importSample,
    retry,
  };
}
