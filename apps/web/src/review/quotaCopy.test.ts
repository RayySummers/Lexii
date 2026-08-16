/**
 * 额度耗尽空状态文案（RAY-276 诊断线 3，Oscar 评审 PR #41 suggestion 1 抽取）。
 *
 * 锁定共享 helper 的按模式口径：learn / mixed 给出额度耗尽文案并写明
 * 每日上限数字与「顺延到明天」；review 模式返回 null（界面回落默认文案）。
 */
import { describe, expect, it } from "vitest";
import { quotaExhaustedCopy } from "./quotaCopy";

describe("quotaExhaustedCopy（共享额度耗尽文案）", () => {
  it("learn：标题与正文写明上限数字与顺延", () => {
    expect(quotaExhaustedCopy("learn", 20)).toEqual({
      title: "今日新词额度已用完",
      body: "每日新词上限 20 张已经学完，剩余新词顺延到明天。想继续学习请返回首页试试「复习」或「混合」模式。",
    });
  });

  it("mixed：说明复习与额度双空", () => {
    expect(quotaExhaustedCopy("mixed", 5)).toEqual({
      title: "今日新词额度已用完",
      body: "今天没有到期的复习卡，每日新词上限 5 张也已学完。休息一下，明天再来。",
    });
  });

  it("review：不适用，返回 null", () => {
    expect(quotaExhaustedCopy("review", 20)).toBeNull();
  });
});
