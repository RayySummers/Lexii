/**
 * 繁体→简体中文转换逻辑定向测试（RAY-316）。
 *
 * 验证 opencc-js Converter 使用通用繁体→简体 profile（"t"）正确转换，
 * 防止回归。测试覆盖常见繁体字、台湾特有异体、以及 Tatoeba 中可能出现
 * 的真实繁体中文句子。
 */
import { describe, expect, it } from "vitest";
import { Converter } from "opencc-js";

/** 通用繁体→简体转换器（与 tatoeba.mjs 中使用的 profile 一致） */
const toSimplified = Converter({ from: "t", to: "cn" });

describe("繁体→简体中文转换（toSimplified）", () => {
  it("常见繁体字正确转换", () => {
    // 基本繁体字
    expect(toSimplified("學")).toBe("学");
    expect(toSimplified("國")).toBe("国");
    expect(toSimplified("語")).toBe("语");
    expect(toSimplified("書")).toBe("书");
    expect(toSimplified("車")).toBe("车");
    expect(toSimplified("門")).toBe("门");
    expect(toSimplified("馬")).toBe("马");
    expect(toSimplified("魚")).toBe("鱼");
    expect(toSimplified("鳥")).toBe("鸟");
  });

  it("台湾特有异体字正确转换（使用通用 profile 而非 tw）", () => {
    // 台湾特有异体：裡→里（而非「裏」）
    expect(toSimplified("裡面")).toBe("里面");
    // 群在台湾写作「群」，通用 profile 保持不变（因为「群」也是简体）
    expect(toSimplified("群眾")).toBe("群众");
    // 裏→里（通用繁体）
    expect(toSimplified("表裏")).toBe("表里");
  });

  it("Tatoeba 真实繁体中文句子正确转换", () => {
    // 典型 Tatoeba 繁体中文句子
    expect(toSimplified("這是一個測試句子。")).toBe("这是一个测试句子。");
    expect(toSimplified("我很喜歡學習程式設計。")).toBe("我很喜欢学习程式设计。");
    expect(toSimplified("今天天氣很好，適合外出散步。")).toBe("今天天气很好，适合外出散步。");
    expect(toSimplified("請問圖書館在哪裡？")).toBe("请问图书馆在哪里？");
  });

  it("简体中文输入保持不变（幂等性）", () => {
    const simplified = "这是一个测试句子。";
    expect(toSimplified(simplified)).toBe(simplified);
  });

  it("混合繁简体句子正确转换", () => {
    expect(toSimplified("這個app很好用")).toBe("这个app很好用");
    expect(toSimplified("我喜歡JavaScript程式設計")).toBe("我喜欢JavaScript程式设计");
  });

  it("空字符串和边缘情况", () => {
    expect(toSimplified("")).toBe("");
    expect(toSimplified("Hello World")).toBe("Hello World");
    expect(toSimplified("123456")).toBe("123456");
  });

  it("常见词汇繁体→简体转换", () => {
    // 词汇级别的转换（更接近实际使用场景）
    expect(toSimplified("計算機")).toBe("计算机");
    expect(toSimplified("電話")).toBe("电话");
    expect(toSimplified("電影")).toBe("电影");
    expect(toSimplified("音樂")).toBe("音乐");
    expect(toSimplified("經濟")).toBe("经济");
    expect(toSimplified("歷史")).toBe("历史");
    expect(toSimplified("科學")).toBe("科学");
    expect(toSimplified("技術")).toBe("技术");
  });
});
