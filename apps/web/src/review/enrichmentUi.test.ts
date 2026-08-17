/**
 * 富化展示辅助纯函数测试（RAY-272 批次 B）。
 *
 * 锁定双音标选择口径（美/英优先、缺省回退词书音标）、
 * 词根词缀拆解解析（含防御性输入）与内联 Markdown 斜体渲染。
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

describe("parseInlineMarkdown（内联斜体 Markdown → React 元素）", () => {
  it("纯文本无标记：返回单个字符串节点", () => {
    const result = parseInlineMarkdown("由强调前缀 a- 与 bandon（管辖权）结合。");
    expect(result).toEqual(["由强调前缀 a- 与 bandon（管辖权）结合。"]);
  });

  it("*text* 斜体渲染为 React <em> 元素", () => {
    const result = parseInlineMarkdown("来自拉丁语 *abandonare*。");
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("来自拉丁语 ");
    // result[1] 是 React element (em)
    const em = result[1] as { type: string; props: { children: string } };
    expect(em.type).toBe("em");
    expect(em.props.children).toBe("abandonare");
    expect(result[2]).toBe("。");
  });

  it("_text_ 斜体渲染为 React <em> 元素", () => {
    const result = parseInlineMarkdown("词源来自 _古法语_ abandoner。");
    expect(result).toHaveLength(3);
    expect(result[0]).toBe("词源来自 ");
    const em = result[1] as { type: string; props: { children: string } };
    expect(em.type).toBe("em");
    expect(em.props.children).toBe("古法语");
    expect(result[2]).toBe(" abandoner。");
  });

  it("多个斜体标记均正确渲染", () => {
    const result = parseInlineMarkdown("由 *前缀* a- 与 _词根_ bandon 结合。");
    // "由 " | <em>前缀</em> | " a- 与 " | <em>词根</em> | " bandon 结合。"
    expect(result).toHaveLength(5);
    expect(result[0]).toBe("由 ");
    const em1 = result[1] as { type: string; props: { children: string } };
    expect(em1.type).toBe("em");
    expect(em1.props.children).toBe("前缀");
    expect(result[2]).toBe(" a- 与 ");
    const em2 = result[3] as { type: string; props: { children: string } };
    expect(em2.type).toBe("em");
    expect(em2.props.children).toBe("词根");
    expect(result[4]).toBe(" bandon 结合。");
  });

  it("空字符串：返回空数组", () => {
    expect(parseInlineMarkdown("")).toEqual([]);
  });

  it("未闭合的标记原样输出", () => {
    const result = parseInlineMarkdown("未闭合的 *斜体标记");
    expect(result).toEqual(["未闭合的 *斜体标记"]);
  });
});
