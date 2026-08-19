/**
 * 释义级词性解析（RAY-349）：对齐数组优先、pos 汇总串按无歧义规则推断、
 * 有歧义时返回空串（调用方退回序号）。
 */
import { describe, expect, it } from "vitest";
import { hasDefinitionPos, resolveDefinitionPos } from "./definitionPos";

describe("resolveDefinitionPos", () => {
  it("优先用打包侧对齐数组，逐条一一对应", () => {
    expect(
      resolveDefinitionPos({
        definitions: ["抽象的, 深奥的", "摘要, 抽象概念", "摘要, 提炼", "摘录"],
        pos: "a.；n.；vt.",
        posByDefinition: ["a.", "n.", "vt.", ""],
      }),
    ).toEqual(["a.", "n.", "vt.", ""]);
  });

  it("对齐数组长度不足时按缺失补空串，不越界读取", () => {
    expect(
      resolveDefinitionPos({
        definitions: ["一", "二", "三"],
        posByDefinition: ["n."],
      }),
    ).toEqual(["n.", "", ""]);
  });

  it("存量数据（无对齐数组）：单一词性不套用到多条释义（会标错，见模块注释）", () => {
    expect(
      resolveDefinitionPos({
        definitions: ["能力, 才干", "能力, 才能"],
        pos: "n.",
      }),
    ).toEqual(["", ""]);
  });

  it("存量数据：单条释义 + 单一词性可直接标注（数量相等的特例）", () => {
    expect(resolveDefinitionPos({ definitions: ["缩写词, 缩写"], pos: "n." })).toEqual(["n."]);
  });

  it("存量数据：词性数与释义数相等时按顺序一一对应", () => {
    expect(
      resolveDefinitionPos({
        definitions: ["放弃, 抛弃", "放任, 无拘束"],
        pos: "vt.；n.",
      }),
    ).toEqual(["vt.", "n."]);
  });

  it("存量数据：词性数与释义数不等且多于一个时不猜测，全部返回空串", () => {
    expect(
      resolveDefinitionPos({
        definitions: ["一", "二", "三", "四", "五", "六"],
        pos: "a.；n.；vt.",
      }),
    ).toEqual(["", "", "", "", "", ""]);
  });

  it("无任何词性信息时返回等长空串数组", () => {
    expect(resolveDefinitionPos({ definitions: ["一", "二"] })).toEqual(["", ""]);
  });

  it("空串对齐数组视为无数据，回落到 pos 推断", () => {
    expect(
      resolveDefinitionPos({
        definitions: ["一", "二"],
        pos: "adj.；n.",
        posByDefinition: ["", ""],
      }),
    ).toEqual(["adj.", "n."]);
  });
});

describe("hasDefinitionPos", () => {
  it("至少一条释义可标词性时为真，全部未知时为假", () => {
    expect(hasDefinitionPos({ definitions: ["一", "二"], pos: "n.；vt." })).toBe(true);
    expect(hasDefinitionPos({ definitions: ["一", "二"], pos: "a.；n.；vt." })).toBe(false);
    expect(hasDefinitionPos({ definitions: ["一"] })).toBe(false);
  });
});
