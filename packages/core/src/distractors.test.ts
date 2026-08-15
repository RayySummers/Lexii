/**
 * distractors.ts 测试：editDistance 纯函数 + generateOptions 选项生成。
 */
import { describe, expect, it } from "vitest";
import type { Sense } from "./domain";
import { toSenseId } from "./id";
import { editDistance, generateOptions } from "./distractors";

function makeSense(overrides: Partial<Sense> = {}): Sense {
  return {
    id: toSenseId(`sense_${Math.random().toString(36).slice(2, 8)}`),
    lang: "en",
    term: "abandon",
    definitions: ["放弃"],
    tags: [],
    examples: [],
    ...overrides,
  };
}

describe("editDistance", () => {
  it("相同字符串返回 0", () => {
    expect(editDistance("abc", "abc")).toBe(0);
  });

  it("空串与非空串距离为较长串长度", () => {
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("abc", "")).toBe(3);
  });

  it("单字符替换距离 1", () => {
    expect(editDistance("cat", "bat")).toBe(1);
  });

  it("插入/删除距离 1", () => {
    expect(editDistance("cat", "cats")).toBe(1);
    expect(editDistance("cats", "cat")).toBe(1);
  });

  it("完全不同的短串", () => {
    expect(editDistance("abc", "xyz")).toBe(3);
  });

  it("典型形近词", () => {
    expect(editDistance("abandon", "abandon")).toBe(0);
    expect(editDistance("abandon", "abundant")).toBeLessThanOrEqual(4);
    expect(editDistance("desert", "dessert")).toBe(1);
  });
});

describe("generateOptions", () => {
  it("返回正确数量的选项", () => {
    const target = makeSense({ term: "abandon", definitions: ["放弃"] });
    const all = [
      target,
      makeSense({ term: "band", definitions: ["乐队"] }),
      makeSense({ term: "ban", definitions: ["禁令"] }),
      makeSense({ term: "bandit", definitions: ["强盗"] }),
      makeSense({ term: "bank", definitions: ["银行"] }),
    ];
    const options = generateOptions(target, all, []);
    expect(options).toHaveLength(4);
  });

  it("恰好一个正确选项", () => {
    const target = makeSense({ term: "abandon", definitions: ["放弃"] });
    const all = [
      target,
      makeSense({ term: "band", definitions: ["乐队"] }),
      makeSense({ term: "ban", definitions: ["禁令"] }),
      makeSense({ term: "bandit", definitions: ["强盗"] }),
      makeSense({ term: "bank", definitions: ["银行"] }),
    ];
    const options = generateOptions(target, all, []);
    const correct = options.filter((o) => o.isCorrect);
    expect(correct).toHaveLength(1);
    expect(correct[0]!.text).toBe("放弃");
  });

  it("所有选项文本互不相同", () => {
    const target = makeSense({ term: "abandon", definitions: ["放弃"] });
    const all = [
      target,
      makeSense({ term: "band", definitions: ["乐队"] }),
      makeSense({ term: "ban", definitions: ["禁令"] }),
      makeSense({ term: "bandit", definitions: ["强盗"] }),
      makeSense({ term: "bank", definitions: ["银行"] }),
    ];
    const options = generateOptions(target, all, []);
    const texts = options.map((o) => o.text);
    expect(new Set(texts).size).toBe(options.length);
  });

  it("优先使用常错词定义", () => {
    const target = makeSense({ term: "abandon", definitions: ["放弃"] });
    const wrongSense = makeSense({ term: "common", definitions: ["普通的"] });
    const all = [
      target,
      wrongSense,
      makeSense({ term: "band", definitions: ["乐队"] }),
      makeSense({ term: "ban", definitions: ["禁令"] }),
      makeSense({ term: "bandit", definitions: ["强盗"] }),
      makeSense({ term: "bank", definitions: ["银行"] }),
    ];
    const options = generateOptions(target, all, ["common"]);
    const wrongOptions = options.filter((o) => o.source === "wrong-history");
    expect(wrongOptions.length).toBeGreaterThanOrEqual(1);
    expect(wrongOptions[0]!.text).toBe("普通的");
  });

  it("优先使用近义词定义", () => {
    const target = makeSense({
      term: "abandon",
      definitions: ["放弃"],
      synonyms: ["forsake"],
    });
    const synSense = makeSense({ term: "forsake", definitions: ["遗弃"] });
    const all = [
      target,
      synSense,
      makeSense({ term: "band", definitions: ["乐队"] }),
      makeSense({ term: "ban", definitions: ["禁令"] }),
      makeSense({ term: "bandit", definitions: ["强盗"] }),
      makeSense({ term: "bank", definitions: ["银行"] }),
    ];
    const options = generateOptions(target, all, []);
    const synOptions = options.filter((o) => o.source === "synonym");
    expect(synOptions.length).toBeGreaterThanOrEqual(1);
    expect(synOptions[0]!.text).toBe("遗弃");
  });

  it("无释义目标返回占位选项", () => {
    const target = makeSense({ term: "empty", definitions: [] });
    const options = generateOptions(target, [], []);
    expect(options).toHaveLength(4);
    expect(options.every((o) => o.text === "（无释义）")).toBe(true);
  });

  it("选项数可自定义", () => {
    const target = makeSense({ term: "abandon", definitions: ["放弃"] });
    const all = [
      target,
      makeSense({ term: "band", definitions: ["乐队"] }),
      makeSense({ term: "ban", definitions: ["禁令"] }),
      makeSense({ term: "bandit", definitions: ["强盗"] }),
      makeSense({ term: "bank", definitions: ["银行"] }),
    ];
    const options = generateOptions(target, all, [], 3);
    expect(options).toHaveLength(3);
  });
});
