/**
 * distractors.ts 测试：editDistance 纯函数 + generateOptions 选项生成。
 */
import { describe, expect, it } from "vitest";
import type { Sense } from "./domain";
import { toSenseId } from "./id";
import {
  editDistance,
  generateOptions,
  generateTermOptions,
  MIN_QUIZ_OPTION_COUNT,
} from "./distractors";

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

  it("同义词条不进混淆池（英译中，RAY-293 剔除修复）", () => {
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
    // 同义释义「遗弃」语义上也说得通，不得作为混淆项出现
    expect(options.some((o) => o.text === "遗弃")).toBe(false);
    expect(options.filter((o) => o.isCorrect)).toHaveLength(1);
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

describe("generateTermOptions（RAY-293 中译英）", () => {
  it("正确选项为目标词条原文", () => {
    const target = makeSense({ term: "abandon", definitions: ["放弃"] });
    const all = [
      target,
      makeSense({ term: "band", definitions: ["乐队"] }),
      makeSense({ term: "ban", definitions: ["禁令"] }),
      makeSense({ term: "bandit", definitions: ["强盗"] }),
      makeSense({ term: "bank", definitions: ["银行"] }),
    ];
    const options = generateTermOptions(target, all, []);
    expect(options).toHaveLength(4);
    const correct = options.filter((o) => o.isCorrect);
    expect(correct).toHaveLength(1);
    expect(correct[0]!.text).toBe("abandon");
  });

  it("所有选项文本互不相同（按词条去重）", () => {
    const target = makeSense({ term: "abandon", definitions: ["放弃"] });
    const all = [
      target,
      makeSense({ term: "band", definitions: ["乐队"] }),
      makeSense({ term: "ban", definitions: ["禁令"] }),
      makeSense({ term: "bandit", definitions: ["强盗"] }),
      makeSense({ term: "bank", definitions: ["银行"] }),
    ];
    const options = generateTermOptions(target, all, []);
    const texts = options.map((o) => o.text);
    expect(new Set(texts).size).toBe(options.length);
  });

  it("常错词混淆项取词条原文", () => {
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
    const options = generateTermOptions(target, all, ["common"]);
    const wrongOptions = options.filter((o) => o.source === "wrong-history");
    expect(wrongOptions.length).toBeGreaterThanOrEqual(1);
    expect(wrongOptions[0]!.text).toBe("common");
  });

  it("同义词条不进混淆池（中译英，RAY-293 剔除修复）", () => {
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
    const options = generateTermOptions(target, all, []);
    // 同义词条 forsake 语义上也说得通，不得作为混淆项出现
    expect(options.some((o) => o.text === "forsake")).toBe(false);
    expect(options.filter((o) => o.isCorrect)).toHaveLength(1);
  });

  it("形近词混淆项取词条原文", () => {
    const target = makeSense({ term: "abandon", definitions: ["放弃"] });
    const similarSense = makeSense({ term: "abandoned", definitions: ["被抛弃的"] });
    const all = [
      target,
      similarSense,
      makeSense({ term: "ban", definitions: ["禁令"] }),
      makeSense({ term: "bandit", definitions: ["强盗"] }),
      makeSense({ term: "bank", definitions: ["银行"] }),
    ];
    const options = generateTermOptions(target, all, []);
    const similarOptions = options.filter((o) => o.source === "similar-spelling");
    expect(similarOptions.length).toBeGreaterThanOrEqual(1);
    // 选项整体洗牌，不断言顺序；最近形近词（编辑距离 2）必在池中
    expect(similarOptions.map((o) => o.text)).toContain("abandoned");
  });

  it("词条模式不把主释义当选项：英译中回归对照", () => {
    const target = makeSense({ term: "abandon", definitions: ["放弃"] });
    const all = [
      target,
      makeSense({ term: "band", definitions: ["乐队"] }),
      makeSense({ term: "ban", definitions: ["禁令"] }),
      makeSense({ term: "bandit", definitions: ["强盗"] }),
      makeSense({ term: "bank", definitions: ["银行"] }),
    ];
    const termOptions = generateTermOptions(target, all, []);
    const defOptions = generateOptions(target, all, []);
    // 词条模式选项全部是英文词条；释义模式选项全部是中文释义（无一英文词条）
    expect(termOptions.every((o) => /^[a-z]+$/.test(o.text))).toBe(true);
    expect(defOptions.some((o) => o.text === "放弃")).toBe(true);
    expect(defOptions.every((o) => !/^[a-z]+$/.test(o.text))).toBe(true);
  });
});

describe("同义词条剔除（RAY-293 后续修复，两方向通用）", () => {
  it("同义词条即使命中常错词池也被剔除（英译中）", () => {
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
    // forsake 既是常错词、又是目标词的同义词——必须剔除
    const options = generateOptions(target, all, ["forsake"]);
    expect(options.some((o) => o.text === "遗弃")).toBe(false);
  });

  it("同义词条即使命中常错词池也被剔除（中译英）", () => {
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
    const options = generateTermOptions(target, all, ["forsake"]);
    expect(options.some((o) => o.text === "forsake")).toBe(false);
  });

  it("双向口径：自身 synonyms 含目标词的义项同样剔除", () => {
    const target = makeSense({ term: "abandon", definitions: ["放弃"] });
    // 目标词未声明 synonyms，但 forsake 的 synonyms 指向目标词——双向同义
    const backSynSense = makeSense({
      term: "forsake",
      definitions: ["遗弃"],
      synonyms: ["abandon"],
    });
    const all = [
      target,
      backSynSense,
      makeSense({ term: "band", definitions: ["乐队"] }),
      makeSense({ term: "ban", definitions: ["禁令"] }),
      makeSense({ term: "bandit", definitions: ["强盗"] }),
      makeSense({ term: "bank", definitions: ["银行"] }),
    ];
    const defOptions = generateOptions(target, all, ["forsake"]);
    const termOptions = generateTermOptions(target, all, ["forsake"]);
    expect(defOptions.some((o) => o.text === "遗弃")).toBe(false);
    expect(termOptions.some((o) => o.text === "forsake")).toBe(false);
  });

  it("随机回退池同样剔除同义词条（其他候选为空时选项不足也不补同义词）", () => {
    const target = makeSense({
      term: "abandon",
      definitions: ["放弃"],
      synonyms: ["forsake"],
    });
    const synSense = makeSense({ term: "forsake", definitions: ["遗弃"] });
    const all = [target, synSense];
    const options = generateTermOptions(target, all, []);
    // 混淆池唯一的候选就是同义词条，剔除后只剩正确项
    expect(options).toHaveLength(1);
    expect(options[0]!.isCorrect).toBe(true);
  });

  it("候选不足时返回低于 MIN_QUIZ_OPTION_COUNT 的选项（上层据此跳题）", () => {
    const target = makeSense({ term: "abandon", definitions: ["放弃"] });
    const all = [
      target,
      makeSense({ term: "band", definitions: ["乐队"] }),
      makeSense({ term: "ban", definitions: ["禁令"] }),
    ];
    // 3 词词库：每词仅 1 正确 + 2 干扰 = 3 < 4——生成器如实返回不足结果
    const defOptions = generateOptions(target, all, []);
    const termOptions = generateTermOptions(target, all, []);
    expect(defOptions.length).toBeLessThan(MIN_QUIZ_OPTION_COUNT);
    expect(termOptions.length).toBeLessThan(MIN_QUIZ_OPTION_COUNT);
  });

  it("大小写不敏感：同义词条大写变体同样剔除", () => {
    const target = makeSense({
      term: "abandon",
      definitions: ["放弃"],
      synonyms: ["Forsake"],
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
    const options = generateTermOptions(target, all, []);
    expect(options.some((o) => o.text === "forsake")).toBe(false);
  });

  it("非同义词条照常进入混淆池（剔除不误伤）", () => {
    const target = makeSense({
      term: "abandon",
      definitions: ["放弃"],
      synonyms: ["forsake"],
    });
    const all = [
      target,
      makeSense({ term: "forsake", definitions: ["遗弃"] }),
      makeSense({ term: "band", definitions: ["乐队"] }),
      makeSense({ term: "ban", definitions: ["禁令"] }),
      makeSense({ term: "bandit", definitions: ["强盗"] }),
      makeSense({ term: "bank", definitions: ["银行"] }),
    ];
    const options = generateTermOptions(target, all, []);
    expect(options.length).toBeGreaterThan(1);
    expect(options.some((o) => !o.isCorrect)).toBe(true);
  });
});
