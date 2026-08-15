/**
 * 选择题会话状态机。
 *
 * 阶段流转：
 *   loading → quizzing（队列非空）
 *           → no-due / empty（复用 ReviewScreen 现有空状态）
 *           → error
 *   quizzing → done（全部答完）
 *
 * 答题流程：select → grading → auto-advance → quizzing（下一道）
 * 自动评分：答对 → good，答错 → again（经 provider.grade 落库）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewRating, StudyMode } from "@lexilexi/core";
import type { GradeContext, ReviewCard, ReviewDataProvider } from "./types";
import type { MultipleChoiceQuestion } from "./MultipleChoiceCard";

export type QuizPhase = "loading" | "empty" | "no-due" | "quizzing" | "done" | "error";

export interface QuizSession {
  phase: QuizPhase;
  /** 当前问题（quizzing 时非空） */
  current: MultipleChoiceQuestion | null;
  /** 当前 ReviewCard（用于评分提交） */
  currentCard: ReviewCard | null;
  /** 当前问题下标 */
  index: number;
  /** 总问题数 */
  totalCount: number;
  /** 已答题目数 */
  answeredCount: number;
  /** 当前选择的选项下标（null = 未选） */
  selectedIndex: number | null;
  /** 当前选择是否正确（选择后有效） */
  isCorrect: boolean | null;
  /** 错误信息 */
  error: string | null;
  /** 选择一个选项 */
  select(index: number): void;
  /** 重试加载 */
  retry(): void;
}

interface QuizState {
  phase: QuizPhase;
  questions: MultipleChoiceQuestion[];
  cards: ReviewCard[];
  index: number;
  selectedIndex: number | null;
  isCorrect: boolean | null;
  answeredCount: number;
  error: string | null;
}

const INITIAL_STATE: QuizState = {
  phase: "loading",
  questions: [],
  cards: [],
  index: 0,
  selectedIndex: null,
  isCorrect: null,
  answeredCount: 0,
  error: null,
};

/** 自动推进延迟（毫秒）：让用户看到正误反馈后进入下一题 */
const AUTO_ADVANCE_DELAY_MS = 1000;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useMultipleChoiceSession(
  provider: ReviewDataProvider,
  mode: StudyMode,
): QuizSession {
  const [state, setState] = useState<QuizState>(INITIAL_STATE);
  const loadIdRef = useRef(0);
  const gradingRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const apply = useCallback((patch: Partial<QuizState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const load = useCallback(async () => {
    const loadId = ++loadIdRef.current;
    apply({ phase: "loading", error: null, questions: [], cards: [], index: 0, selectedIndex: null, isCorrect: null, answeredCount: 0 });
    try {
      const { questions, cards } = await provider.loadMultipleChoiceQueue(mode);
      if (loadId !== loadIdRef.current) {
        return;
      }
      if (questions.length > 0) {
        apply({
          phase: "quizzing",
          questions,
          cards,
          index: 0,
          selectedIndex: null,
          isCorrect: null,
          answeredCount: 0,
          error: null,
        });
      } else {
        const hasItems = await provider.hasAnyItems();
        if (loadId !== loadIdRef.current) {
          return;
        }
        apply({ phase: hasItems ? "no-due" : "empty" });
      }
    } catch (error) {
      if (loadId !== loadIdRef.current) {
        return;
      }
      apply({ phase: "error", error: toErrorMessage(error) });
    }
  }, [provider, mode, apply]);

  useEffect(() => {
    void load();
  }, [load]);

  const select = useCallback(
    (index: number) => {
      const current = stateRef.current;
      if (current.phase !== "quizzing" || current.selectedIndex !== null || gradingRef.current) {
        return;
      }
      const question = current.questions[current.index];
      const card = current.cards[current.index];
      if (!question || !card) {
        return;
      }
      const option = question.options[index];
      if (!option) {
        return;
      }
      const correct = option.isCorrect;
      apply({ selectedIndex: index, isCorrect: correct });

      // 自动评分 + 推进
      gradingRef.current = true;
      const rating: ReviewRating = correct ? "good" : "again";
      const context: GradeContext = {
        reviewDurationMs: 0, // 选择题不精确计时
        revealed: false,
        exerciseType: "multiple-choice",
      };
      provider
        .grade(card, rating, context)
        .then(() => {
          if (loadIdRef.current !== loadIdRef.current) {
            return;
          }
          gradingRef.current = false;
          const answeredCount = current.answeredCount + 1;
          if (current.index + 1 >= current.questions.length) {
            apply({ phase: "done", answeredCount });
          } else {
            // 延迟推进，让用户看到反馈
            setTimeout(() => {
              apply({
                index: current.index + 1,
                selectedIndex: null,
                isCorrect: null,
                answeredCount,
              });
            }, AUTO_ADVANCE_DELAY_MS);
          }
        })
        .catch((error) => {
          gradingRef.current = false;
          apply({ phase: "error", error: toErrorMessage(error) });
        });
    },
    [provider, apply],
  );

  const retry = useCallback(() => {
    void load();
  }, [load]);

  return {
    phase: state.phase,
    current: state.phase === "quizzing" ? (state.questions[state.index] ?? null) : null,
    currentCard: state.phase === "quizzing" ? (state.cards[state.index] ?? null) : null,
    index: state.index,
    totalCount: state.questions.length,
    answeredCount: state.answeredCount,
    selectedIndex: state.selectedIndex,
    isCorrect: state.isCorrect,
    error: state.error,
    select,
    retry,
  };
}
