/**
 * FSRS 默认参数与参数归一化。
 *
 * 默认值与官方参考实现 ts-fsrs v5.4.1（FSRS-6.0 主分支）完全一致；
 * 参数迁移/裁剪规则同样逐行对齐，保证自定义参数输入下差分验证仍然通过。
 */

import type { FSRSParameters, Steps } from "./models";
import { clamp, roundTo } from "./utils";

export const DEFAULT_REQUEST_RETENTION = 0.9;
export const DEFAULT_MAXIMUM_INTERVAL = 36_500;
export const DEFAULT_ENABLE_FUZZ = false;
export const DEFAULT_ENABLE_SHORT_TERM = true;

export const DEFAULT_LEARNING_STEPS: readonly `${number}m`[] = Object.freeze(["1m", "10m"]);
export const DEFAULT_RELEARNING_STEPS: readonly `${number}m`[] = Object.freeze(["10m"]);

/** 稳定度下限 */
export const S_MIN = 0.001;
/** 稳定度上限 */
export const S_MAX = 36_500.0;
/** 初始稳定度上限 */
export const INIT_S_MAX = 100.0;
/** 遗忘曲线 decay 上限（用于参数裁剪） */
export const DECAY_MAX = 0.8;
/** 遗忘曲线 decay 下限（用于参数裁剪） */
export const DECAY_MIN = 0.1;
/** 默认遗忘曲线 decay（FSRS-6 引入的第 21 个参数） */
export const FSRS6_DEFAULT_DECAY = 0.1542;
/** 参数迁移时自动补齐的 decay（官方 5.4.1 用 FSRS-5 的 0.5 补齐缺口位） */
export const FSRS5_DEFAULT_DECAY = 0.5;
/** w17/w18 裁剪上限 */
export const W17_W18_CEILING = 2.0;

/** FSRS-6 默认权重（21 个） */
export const DEFAULT_W: readonly number[] = Object.freeze([
  0.212,
  1.2931,
  2.3065,
  8.2956,
  6.4133,
  0.8334,
  3.0194,
  0.001,
  1.8722,
  0.1666,
  0.796,
  1.4835,
  0.0614,
  0.2629,
  1.6483,
  0.6014,
  1.8729,
  0.5425,
  0.0912,
  0.0658,
  FSRS6_DEFAULT_DECAY,
]);

/**
 * 各权重参数的裁剪区间（与官方 CLAMP_PARAMETERS 一致）。
 * 顺序对应 w0..w20；w19 的下限随 enable_short_term 变化（见 clipParameters）。
 */
const CLAMP_BOUNDS: readonly (readonly [number, number])[] = [
  [S_MIN, INIT_S_MAX], // w0 初始稳定度（Again）
  [S_MIN, INIT_S_MAX], // w1 初始稳定度（Hard）
  [S_MIN, INIT_S_MAX], // w2 初始稳定度（Good）
  [S_MIN, INIT_S_MAX], // w3 初始稳定度（Easy）
  [1.0, 10.0], // w4 初始难度（Good）
  [0.001, 4.0], // w5 初始难度（乘数）
  [0.001, 4.0], // w6 难度（乘数）
  [0.001, 0.75], // w7 难度（均值回归系数）
  [0.0, 4.5], // w8 稳定度（指数）
  [0.0, 0.8], // w9 稳定度（负指数）
  [0.001, 3.5], // w10 稳定度（指数）
  [0.001, 5.0], // w11 遗忘稳定度（乘数）
  [0.001, 0.25], // w12 遗忘稳定度（负指数）
  [0.001, 0.9], // w13 遗忘稳定度（指数）
  [0.0, 4.0], // w14 遗忘稳定度（指数）
  [0.0, 1.0], // w15 Hard 稳定度（乘数）
  [1.0, 6.0], // w16 Easy 稳定度（乘数）
  [0.0, W17_W18_CEILING], // w17 短期稳定度（指数）
  [0.0, W17_W18_CEILING], // w18 短期稳定度（指数）
  [0.0, 0.8], // w19 短期稳定度（last-stability 指数，下限由 enable_short_term 决定）
  [DECAY_MIN, DECAY_MAX], // w20 遗忘曲线 decay
];

/**
 * 按官方规则裁剪权重：先按基础区间裁剪（w19 下限随 enable_short_term），
 * 再在重学步骤数 > 1 时收紧 w17/w18 上限（保证多次重学后稳定度仍单调递减）。
 */
export function clipParameters(
  parameters: number[],
  numRelearningSteps: number,
  enableShortTerm: boolean = DEFAULT_ENABLE_SHORT_TERM,
): number[] {
  const clip = CLAMP_BOUNDS.slice(0, parameters.length).map(([min, max], index) =>
    index === 19
      ? ([enableShortTerm ? 0.01 : 0.0, max] as [number, number])
      : ([min, max] as [number, number]),
  );
  if (Math.max(0, numRelearningSteps) > 1) {
    // PLS = w11 * D^-w12 * [(S+1)^w13 - 1] * e^(w14 * (1-R))；
    // 需满足 num_relearning_steps * w17 * w18 + ln(w11) + ln(2^w13 - 1) + w14 * 0.3 <= 0，
    // 否则多次重学会出现稳定度回升。
    const w11 = clamp(parameters[11] ?? 0, clip[11]![0], clip[11]![1]);
    const w13 = clamp(parameters[13] ?? 0, clip[13]![0], clip[13]![1]);
    const w14 = clamp(parameters[14] ?? 0, clip[14]![0], clip[14]![1]);
    const value =
      -(Math.log(w11) + Math.log(Math.pow(2.0, w13) - 1.0) + w14 * 0.3) / numRelearningSteps;
    const w17_w18_ceiling = clamp(roundTo(Math.sqrt(Math.max(value, 0)), 8), 0.01, 2.0);
    clip[17]![1] = w17_w18_ceiling;
    clip[18]![1] = w17_w18_ceiling;
  }
  return clip.map((range, index) => clamp(parameters[index] ?? 0, range[0], range[1]));
}

/**
 * 权重迁移与裁剪（与官方 migrateParameters 一致）：
 * - 21 个：按区间裁剪；
 * - 19 个：补齐 [0, 默认 decay]；
 * - 17 个：先做 v4→v6 换算，再补齐 [0, 0, 0, 默认 decay]；
 * - 其他长度：回退默认权重。
 */
export function migrateParameters(
  parameters?: number[] | readonly number[],
  numRelearningSteps = 0,
  enableShortTerm: boolean = DEFAULT_ENABLE_SHORT_TERM,
): number[] {
  if (parameters === undefined) {
    return [...DEFAULT_W];
  }
  switch (parameters.length) {
    case 21:
      return clipParameters([...parameters], numRelearningSteps, enableShortTerm);
    case 19:
      return clipParameters([...parameters], numRelearningSteps, enableShortTerm).concat([
        0.0,
        FSRS5_DEFAULT_DECAY,
      ]);
    case 17: {
      const w = clipParameters([...parameters], numRelearningSteps, enableShortTerm);
      w[4] = Number((w[5]! * 2.0 + w[4]!).toFixed(8));
      w[5] = Number((Math.log(w[5]! * 3.0 + 1.0) / 3.0).toFixed(8));
      w[6] = Number((w[6]! + 0.5).toFixed(8));
      return w.concat([0.0, 0.0, 0.0, FSRS5_DEFAULT_DECAY]);
    }
    default:
      return [...DEFAULT_W];
  }
}

/**
 * 归一化参数集：缺失字段用默认值补齐，权重经 migrateParameters 迁移/裁剪。
 * 与官方 generatorParameters 行为一致（包括 `||` 对 0 值的处理）。
 */
export function normalizeParameters(props?: Partial<FSRSParameters>): FSRSParameters {
  const learning_steps: Steps = Array.isArray(props?.learning_steps)
    ? props.learning_steps
    : DEFAULT_LEARNING_STEPS;
  const relearning_steps: Steps = Array.isArray(props?.relearning_steps)
    ? props.relearning_steps
    : DEFAULT_RELEARNING_STEPS;
  const enable_short_term = props?.enable_short_term ?? DEFAULT_ENABLE_SHORT_TERM;
  const w = migrateParameters(props?.w, relearning_steps.length, enable_short_term);

  return {
    request_retention: props?.request_retention || DEFAULT_REQUEST_RETENTION,
    maximum_interval: props?.maximum_interval || DEFAULT_MAXIMUM_INTERVAL,
    w,
    enable_fuzz: props?.enable_fuzz ?? DEFAULT_ENABLE_FUZZ,
    enable_short_term,
    learning_steps,
    relearning_steps,
  };
}
