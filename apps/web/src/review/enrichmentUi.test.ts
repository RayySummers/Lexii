/**
 * 富化展示辅助纯函数测试（RAY-272 批次 B）。
 *
 * 锁定双音标选择口径（美/英优先、缺省回退词书音标）与
 * 词根词缀拆解解析（含防御性输入）。
 */
import { describe, expect, it } from "vitest";
import { dualPhonetics, parseInlineMarkdown, parseWordParts } from "./enrichmentUi";

describe("dualPhonetics（美/英双音标选择）", () => {
  it("美/英双音标齐全：展示两条，富化值自带斜杠原样返回", () => {
    expect(dualPhonetics({ ipa: "/x/", ipaUs: "/əˈbændən/", ipaUk: "/ɐbˈændən/" })).toEqual([
      { label: "美", value: "/əˈbændən/", fallback: false },
      { label: "英", value: "/ɐbˈændən/", fallback: false },
    ]);
  });

  it("仅美式：只展示美式，不回退", () => {
    expect(dualPhonetics({ ipa: "/x/", ipaUs: "/əˈbændən/" })).toEqual([
      { label: "美", value: "/əˈbændən/", fallback: false },
    ]);
  });

  it("仅英式：只展示英式，不回退", () => {
    expect(dualPhonetics({ ipa: "/x/", ipaUk: "/ɐbˈændən/" })).toEqual([
      { label: "英", value: "/ɐbˈændən/", fallback: false },
    ]);
  });

  it("双音标缺省：回退词书自带 ipa，补全斜杠、无标签", () => {
    expect(dualPhonetics({ ipa: "əˈbændən" })).toEqual([
      { label: "", value: "/əˈbændən/", fallback: true },
    ]);
  });

  it("无任何音标数据：返回空数组", () => {
    expect(dualPhonetics({})).toEqual([]);
  });
});

describe("parseWordParts（词根词缀拆解解析）", () => {
  it("标准形态：按 · 分段，词素与 <含义> 拆分", () => {
    expect(parseWordParts("a<加强> · bandon<控制>")).toEqual([
      { part: "a", meaning: "加强" },
      { part: "bandon", meaning: "控制" },
    ]);
  });

  it("含义中残留的 >（打包侧截断痕迹）被剥离", () => {
    expect(parseWordParts("able<能够的（拉丁语 >")).toEqual([
      { part: "able", meaning: "能够的（拉丁语" },
    ]);
  });

  it("无 <…> 的段整体视为词素、无含义", () => {
    expect(parseWordParts("re<再次> · turn")).toEqual([
      { part: "re", meaning: "再次" },
      { part: "turn", meaning: "" },
    ]);
  });

  it("空串与纯空白：返回空数组", () => {
    expect(parseWordParts("")).toEqual([]);
    expect(parseWordParts("   ")).toEqual([]);
  });

  it("多余空白段被丢弃，词素两端空白被修剪", () => {
    expect(parseWordParts("a<加强> ·  · bandon <控制>")).toEqual([
      { part: "a", meaning: "加强" },
      { part: "bandon", meaning: "控制" },
    ]);
  });
});

describe("parseInlineMarkdown（行内 Markdown 解析）", () => {
  it("将 _text_ 转换为 <em>text</em>", () => {
    expect(parseInlineMarkdown("古英语 _æfter_ 由表示")).toBe(
      "古英语 <em>æfter</em> 由表示",
    );
  });

  it("处理多个斜体标记", () => {
    expect(parseInlineMarkdown("_af_ 与 _-ter_ 结合")).toBe(
      "<em>af</em> 与 <em>-ter</em> 结合",
    );
  });

  it("转义 HTML 特殊字符", () => {
    expect(parseInlineMarkdown("a < b & c > d")).toBe(
      "a &lt; b &amp; c &gt; d",
    );
  });

  it("空串返回空串", () => {
    expect(parseInlineMarkdown("")).toBe("");
  });

  it("无斜体标记时原样返回（HTML 转义后）", () => {
    expect(parseInlineMarkdown("普通文本")).toBe("普通文本");
  });
});
