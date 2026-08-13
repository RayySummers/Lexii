/**
 * 调度器：把算法结果转成「新卡片 + 复习日志」，并处理学习步骤与状态流转。
 *
 * 状态机与官方 BasicScheduler（enable_short_term = true）逐分支对齐：
 * - new/learning/relearning：走学习步骤（含最后一步转 Review / 满 1 天转 Review）；
 * - review：Again 进入重学（并按重学步骤排期），Hard/Good/Easy 按 FSRS 间隔排期，
 *   且强制 hard < good < easy 的间隔排序。
 */

import { FSRSAlgorithm } from "./algorithm";
import type {
  Card,
  CardInput,
  FSRSParameters,
  Grade,
  RecordLog,
  RecordLogItem,
  ReviewLog,
  State,
} from "./models";
import { addTime, dateDiffInDays, stepUnitToMinutes, toDate } from "./utils";

/** 评分档位 → 1..4 编号（算法层使用数字编号） */
const GRADE_TO_NUMBER: Record<Grade, number> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

/** 合法评分档位集合（运行时校验用，拦截绕过类型检查的脏输入） */
const VALID_GRADES: ReadonlySet<string> = new Set(Object.keys(GRADE_TO_NUMBER));

/**
 * 单卡排期器。每次排期基于「上次复习时的卡片状态 + 本次复习时间」，
 * 可重复调用 preview / review 获得四档结果。
 */
export class Scheduler {
  private readonly algorithm: FSRSAlgorithm;
  private readonly last: Card;
  private readonly current: Card;
  private readonly reviewTime: Date;
  private readonly elapsedDays: number;
  private readonly next: Map<Grade, RecordLogItem> = new Map();

  constructor(card: CardInput, now: Date | number | string, params?: Partial<FSRSParameters>) {
    this.algorithm = new FSRSAlgorithm(params);
    this.reviewTime = toDate(now);
    this.last = toCard(card);
    this.current = toCard(card);

    const state = this.current.state;
    const lastReview = this.current.last_review;
    this.elapsedDays =
      state !== "new" && lastReview ? dateDiffInDays(lastReview, this.reviewTime) : 0;
    this.current.last_review = this.reviewTime;
    this.current.reps += 1;

    // enable_fuzz 时的确定性 seed（与官方 DefaultInitSeedStrategy 一致）
    this.algorithm.seed = `${this.reviewTime.getTime()}_${this.current.reps}_${this.current.difficulty * this.current.stability}`;
  }

  /** 获得四档评分的完整预览 */
  preview(): RecordLog {
    return {
      again: this.review("again"),
      hard: this.review("hard"),
      good: this.review("good"),
      easy: this.review("easy"),
    };
  }

  /**
   * 按给定评分排期并返回结果（同一评分幂等）。
   *
   * 入口先无条件校验评分：非四档（如 UI/导入路径传进脏数据）一律抛 RangeError，
   * 对齐官方 ts-fsrs 的 checkGrade 行为，防止 NaN/无效卡片状态被上层持久化。
   */
  review(grade: Grade): RecordLogItem {
    if (!VALID_GRADES.has(grade)) {
      throw new RangeError(`Invalid grade "${String(grade)}", expected again/hard/good/easy`);
    }
    const cached = this.next.get(grade);
    if (cached) {
      return cached;
    }
    let item: RecordLogItem;
    if (!this.algorithm.parameters.enable_short_term) {
      // 官方 LongTermScheduler：无学习步骤，new/learning/relearning 统一走 FSRS 全量排期
      item = this.longTermState(grade);
    } else {
      switch (this.last.state) {
        case "new":
          item = this.newState(grade);
          break;
        case "learning":
        case "relearning":
          item = this.learningState(grade);
          break;
        case "review":
          item = this.reviewState(grade);
          break;
      }
    }
    this.next.set(grade, item);
    return item;
  }

  /** enable_short_term=false 时的统一排期（官方 LongTermScheduler 语义） */
  private longTermState(grade: Grade): RecordLogItem {
    // 官方 newState 用 interval=0 且不传 retrievability；reviewState 用 elapsed_days 并传入
    const isNew = this.last.state === "new";
    const interval = isNew ? 0 : this.elapsedDays;
    const retrievability = isNew
      ? undefined
      : this.algorithm.forgettingCurveValue(interval, this.current.stability);
    const nextAgain = this.nextDS(interval, "again", retrievability);
    const nextHard = this.nextDS(interval, "hard", retrievability);
    const nextGood = this.nextDS(interval, "good", retrievability);
    const nextEasy = this.nextDS(interval, "easy", retrievability);
    this.applyLongTermIntervals(nextAgain, nextHard, nextGood, nextEasy, interval);
    nextAgain.lapses += 1;
    return {
      card: this.pick(grade, nextAgain, nextHard, nextGood, nextEasy),
      log: this.buildLog(grade),
    };
  }

  /** 长间隔排期（官方 LongTermScheduler.next_interval：again<hard<good<easy 严格递增） */
  private applyLongTermIntervals(
    nextAgain: Card,
    nextHard: Card,
    nextGood: Card,
    nextEasy: Card,
    interval: number,
  ): void {
    let againInterval = this.algorithm.nextInterval(nextAgain.stability, interval);
    let hardInterval = this.algorithm.nextInterval(nextHard.stability, interval);
    let goodInterval = this.algorithm.nextInterval(nextGood.stability, interval);
    let easyInterval = this.algorithm.nextInterval(nextEasy.stability, interval);
    againInterval = Math.min(againInterval, hardInterval);
    hardInterval = Math.max(hardInterval, againInterval + 1);
    goodInterval = Math.max(goodInterval, hardInterval + 1);
    easyInterval = Math.max(easyInterval, goodInterval + 1);

    nextAgain.state = "review";
    nextAgain.learning_steps = 0;
    nextAgain.scheduled_days = againInterval;
    nextAgain.due = addTime(this.reviewTime, againInterval, true);

    nextHard.state = "review";
    nextHard.learning_steps = 0;
    nextHard.scheduled_days = hardInterval;
    nextHard.due = addTime(this.reviewTime, hardInterval, true);

    nextGood.state = "review";
    nextGood.learning_steps = 0;
    nextGood.scheduled_days = goodInterval;
    nextGood.due = addTime(this.reviewTime, goodInterval, true);

    nextEasy.state = "review";
    nextEasy.learning_steps = 0;
    nextEasy.scheduled_days = easyInterval;
    nextEasy.due = addTime(this.reviewTime, easyInterval, true);
  }

  /** 新卡首次评分 */
  private newState(grade: Grade): RecordLogItem {
    const next = this.nextDS(this.elapsedDays, grade);
    this.applyLearningSteps(next, grade, "learning");
    return { card: next, log: this.buildLog(grade) };
  }

  /** 学习/重学阶段的评分 */
  private learningState(grade: Grade): RecordLogItem {
    const next = this.nextDS(this.elapsedDays, grade);
    this.applyLearningSteps(next, grade, this.last.state);
    return { card: next, log: this.buildLog(grade) };
  }

  /** 复习阶段的评分 */
  private reviewState(grade: Grade): RecordLogItem {
    const interval = this.elapsedDays;
    const retrievability = this.algorithm.forgettingCurveValue(interval, this.current.stability);
    const nextAgain = this.nextDS(interval, "again", retrievability);
    const nextHard = this.nextDS(interval, "hard", retrievability);
    const nextGood = this.nextDS(interval, "good", retrievability);
    const nextEasy = this.nextDS(interval, "easy", retrievability);

    this.applyReviewIntervals(nextHard, nextGood, nextEasy, interval);
    this.applyLearningSteps(nextAgain, "again", "relearning");
    nextAgain.lapses += 1;

    return {
      card: this.pick(grade, nextAgain, nextHard, nextGood, nextEasy),
      log: this.buildLog(grade),
    };
  }

  private pick(grade: Grade, again: Card, hard: Card, good: Card, easy: Card): Card {
    switch (grade) {
      case "again":
        return again;
      case "hard":
        return hard;
      case "good":
        return good;
      case "easy":
        return easy;
      default: {
        // review() 入口已校验评分，此处仅作穷尽性兜底（tsc noFallthroughCasesInSwitch 下不会到达）
        const exhaustive: never = grade;
        throw new RangeError(`Invalid grade "${String(exhaustive)}"`);
      }
    }
  }

  /** 计算下一记忆状态（难度/稳定性），返回基于当前卡片的副本 */
  private nextDS(t: number, grade: Grade, retrievability?: number): Card {
    const nextState = this.algorithm.nextState(
      { difficulty: this.current.difficulty, stability: this.current.stability },
      t,
      GRADE_TO_NUMBER[grade],
      retrievability,
    );
    const card = toCard(this.current);
    card.difficulty = nextState.difficulty;
    card.stability = nextState.stability;
    return card;
  }

  /**
   * 学习步骤排期（官方 BasicLearningStepsStrategy + applyLearningSteps）：
   * - 步骤串非空且未走完：按分钟排期，保持当前阶段；
   * - 步骤耗时 >= 1 天：转 Review 并按分钟排期，scheduled_days = 分钟/1440；
   * - 其余（走完步骤或空步骤）：转 Review，按 FSRS 间隔排期。
   */
  private applyLearningSteps(nextCard: Card, grade: Grade, toState: State): void {
    const scheduledMinutes = this.learningStepMinutes(grade);
    if (scheduledMinutes > 0 && scheduledMinutes < 1440) {
      nextCard.learning_steps = this.nextStepIndex(grade);
      nextCard.scheduled_days = 0;
      nextCard.state = toState;
      nextCard.due = addTime(this.reviewTime, Math.round(scheduledMinutes), false);
    } else {
      nextCard.state = "review";
      if (scheduledMinutes >= 1440) {
        nextCard.learning_steps = this.nextStepIndex(grade);
        nextCard.due = addTime(this.reviewTime, Math.round(scheduledMinutes), false);
        nextCard.scheduled_days = Math.floor(scheduledMinutes / 1440);
      } else {
        nextCard.learning_steps = 0;
        const interval = this.algorithm.nextInterval(nextCard.stability, this.elapsedDays);
        nextCard.scheduled_days = interval;
        nextCard.due = addTime(this.reviewTime, interval, true);
      }
    }
  }

  /** 学习步骤策略：按状态取 learning/relearning 步骤串，返回本评分的分钟数与下一步索引 */
  private learningStepInfo(grade: Grade): { minutes: number; nextStep: number } {
    const params = this.algorithm.parameters;
    const steps =
      this.current.state === "relearning" || this.current.state === "review"
        ? params.relearning_steps
        : params.learning_steps;
    const currentStep = Math.max(0, this.current.learning_steps);
    const stepsLength = steps.length;
    if (stepsLength === 0 || currentStep >= stepsLength) {
      return { minutes: 0, nextStep: 0 };
    }

    const firstStepMinutes = stepUnitToMinutes(steps[0]!);
    // review 状态的 Again：直接回重学第一步
    if (this.current.state === "review") {
      return { minutes: firstStepMinutes, nextStep: 0 };
    }

    switch (grade) {
      case "again":
        return { minutes: firstStepMinutes, nextStep: 0 };
      case "hard": {
        const minutes =
          stepsLength === 1
            ? Math.round(firstStepMinutes * 1.5)
            : Math.round((firstStepMinutes + stepUnitToMinutes(steps[1]!)) / 2);
        return { minutes, nextStep: currentStep };
      }
      case "good": {
        if (currentStep + 1 >= stepsLength) {
          return { minutes: 0, nextStep: 0 };
        }
        return {
          minutes: Math.round(stepUnitToMinutes(steps[currentStep + 1]!)),
          nextStep: currentStep + 1,
        };
      }
      case "easy":
        return { minutes: 0, nextStep: 0 };
      default: {
        // review() 入口已校验评分，此处仅作穷尽性兜底
        const exhaustive: never = grade;
        throw new RangeError(`Invalid grade "${String(exhaustive)}"`);
      }
    }
  }

  private learningStepMinutes(grade: Grade): number {
    return this.learningStepInfo(grade).minutes;
  }

  private nextStepIndex(grade: Grade): number {
    return this.learningStepInfo(grade).nextStep;
  }

  /** 复习间隔排期：hard/good 的间隔最小保证差 1 天，easy 至少比 good 多 1 天 */
  private applyReviewIntervals(
    nextHard: Card,
    nextGood: Card,
    nextEasy: Card,
    interval: number,
  ): void {
    let hardInterval = this.algorithm.nextInterval(nextHard.stability, interval);
    let goodInterval = this.algorithm.nextInterval(nextGood.stability, interval);
    hardInterval = Math.min(hardInterval, goodInterval);
    goodInterval = Math.max(goodInterval, hardInterval + 1);
    const easyInterval = Math.max(
      this.algorithm.nextInterval(nextEasy.stability, interval),
      goodInterval + 1,
    );

    nextHard.state = "review";
    nextHard.learning_steps = 0;
    nextHard.scheduled_days = hardInterval;
    nextHard.due = addTime(this.reviewTime, hardInterval, true);

    nextGood.state = "review";
    nextGood.learning_steps = 0;
    nextGood.scheduled_days = goodInterval;
    nextGood.due = addTime(this.reviewTime, goodInterval, true);

    nextEasy.state = "review";
    nextEasy.learning_steps = 0;
    nextEasy.scheduled_days = easyInterval;
    nextEasy.due = addTime(this.reviewTime, easyInterval, true);
  }

  /** 生成复习日志（字段语义对齐官方 ReviewLog，去掉官方已废弃的 elapsed_days 族） */
  private buildLog(grade: Grade): ReviewLog {
    const { last_review, due } = this.last;
    return {
      rating: grade,
      state: this.current.state,
      due: last_review ?? due,
      stability: this.current.stability,
      difficulty: this.current.difficulty,
      scheduled_days: this.current.scheduled_days,
      learning_steps: this.current.learning_steps,
      review: this.reviewTime,
    };
  }
}

/** 深拷贝输入卡片并规范时间字段（与官方 TypeConvert.card 语义一致） */
function toCard(input: CardInput): Card {
  const card: Card = {
    ...input,
    due: toDate(input.due),
    last_review: input.last_review ? toDate(input.last_review) : undefined,
  };
  return card;
}

/**
 * 便捷入口：创建调度器（可选自定义参数，与构造器签名一致）。
 */
export function scheduler(
  card: CardInput,
  now: Date | number | string,
  params?: Partial<FSRSParameters>,
): Scheduler {
  return new Scheduler(card, now, params);
}
