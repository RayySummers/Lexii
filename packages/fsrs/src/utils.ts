/**
 * 工具函数：时间换算、日期排期、数值钳制与舍入。
 *
 * 语义与官方参考实现（ts-fsrs v5.4.1）逐项对齐；这些函数是差分验证的
 * 数值基础，任何一处不一致都会让对照用例失败。
 */

import type { DateInput, StepUnit } from "./models";

/** 将步骤串（"10m" / "2h" / "1d"）换算为分钟数 */
export function stepUnitToMinutes(step: StepUnit): number {
  const value = Number.parseInt(step.slice(0, -1), 10);
  const unit = step.slice(-1);
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Invalid step value: ${step}`);
  }
  switch (unit) {
    case "m":
      return value;
    case "h":
      return value * 60;
    case "d":
      return value * 1440;
    default:
      throw new RangeError(`Invalid step unit: ${step}, expected m/h/d`);
  }
}

/** 在给定时刻上按分钟（isDay=false）或天（isDay=true）偏移出新时刻 */
export function addTime(now: DateInput, offset: number, isDay = false): Date {
  const base = toDate(now).getTime();
  const delta = isDay ? offset * 24 * 60 * 60 * 1000 : offset * 60 * 1000;
  return new Date(base + delta);
}

/**
 * 两个时刻相差的整天数（向下取整）。
 * 官方实现先按 UTC 日历日截断再相减，因此任何 24h 内的间隔都为 0。
 */
export function dateDiffInDays(last: Date, current: Date): number {
  const utc1 = Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), last.getUTCDate());
  const utc2 = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate());
  return Math.floor((utc2 - utc1) / 86_400_000);
}

/** 两个时刻相差的分钟数（向下取整） */
export function dateDiffInMinutes(now: DateInput, pre: DateInput): number {
  return Math.floor((toDate(now).getTime() - toDate(pre).getTime()) / 60_000);
}

/** 统一时间输入为 Date（Date 直接返回，数字按毫秒时间戳，字符串走 Date.parse） */
export function toDate(value: DateInput): Date {
  if (value instanceof Date) {
    return value;
  }
  const date = typeof value === "number" ? new Date(value) : new Date(Date.parse(value));
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid date: ${value}`);
  }
  return date;
}

/** 数值钳制到 [min, max] */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 四舍五入到 decimals 位小数（与官方 roundTo 一致的浮点行为） */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
