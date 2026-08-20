/**
 * 近义词分组（RAY-367 S1）单测。
 *
 * 覆盖：getSynonymGroups 新字段多分组 / 空组过滤 / 等长校验 / 扁平回退（单义项 / 多义项动词优先 / 无动词回首条）/ definitions 空或越界；
 * isSelfSynonym 大小写 / 空白 / 空串；truncateDefinition 用量。
 */
import { describe, expect, it } from "vitest";
import { toSenseId } from "@lexii/core";
import type { Sense } from "@lexii/core";
import { getSynonymGroups, isSelfSynonym, truncateDefinition } from "./synonymGroups";

function makeSense(overrides: Partial<Sense> = {}): Sense {
  return {
    id: toSenseId("sense_test_syn"),
    lang: "en",
    term: "abandon",
    definitions: ["放弃, 抛弃", "放任, 无拘束"],
    pos: "vt.；n.",
    posByDefinition: ["vt.", "n."],
    tags: [],
    examples: [],
    ...overrides,
  };
}

describe("getSynonymGroups", () => {
  it("新字段多分组：按 synonymsByDefinition 等长分组，空组过滤", () => {
    const sense = makeSense({
      definitions: ["义1", "义2", "义3"],
      posByDefinition: ["vt.", "n.", "adj."],
      synonymsByDefinition: [["a", "b"], [], ["c"]],
      synonyms: ["flat-should-be-ignored"],
    });
    const groups = getSynonymGroups(sense);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ definitionIndex: 0, definition: "义1", pos: "vt.", synonyms: ["a", "b"] });
    expect(groups[1]).toMatchObject({ definitionIndex: 2, synonyms: ["c"] });
  });

  it("新字段等长校验：不等长回退到扁平单分组（动词优先）", () => {
    const sense = makeSense({
      definitions: ["义1", "义2"],
      posByDefinition: ["vt.", "n."],
      synonymsByDefinition: [["a"]], // length 1 ≠ 2
      synonyms: ["flat-a", "flat-b"],
    });
    const groups = getSynonymGroups(sense);
    // 回退到扁平启发式：动词 idx 0
    expect(groups).toHaveLength(1);
    expect(groups[0]!.definitionIndex).toBe(0);
    expect(groups[0]!.synonyms).toEqual(["flat-a", "flat-b"]);
  });

  it("存量扁平：单义项直接归首条", () => {
    const sense = makeSense({
      definitions: ["单一释义"],
      posByDefinition: ["vt."],
      synonyms: ["a", "b"],
    });
    // 删除 byDef
    delete (sense as { synonymsByDefinition?: unknown }).synonymsByDefinition;
    const groups = getSynonymGroups(sense);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.definitionIndex).toBe(0);
    expect(groups[0]!.definition).toBe("单一释义");
  });

  it("存量扁平：多义项动词优先（第一个含 v）", () => {
    const sense = makeSense({
      definitions: ["放弃", "放任", "形容词义"],
      posByDefinition: ["n.", "vt.", "adj."],
      synonyms: ["x"],
    });
    delete (sense as { synonymsByDefinition?: unknown }).synonymsByDefinition;
    const groups = getSynonymGroups(sense);
    expect(groups[0]!.definitionIndex).toBe(1);
    expect(groups[0]!.pos).toBe("vt.");
  });

  it("存量扁平：多义项无动词回首条", () => {
    const sense = makeSense({
      definitions: ["义1", "义2"],
      posByDefinition: ["n.", "adj."],
      synonyms: ["x"],
    });
    delete (sense as { synonymsByDefinition?: unknown }).synonymsByDefinition;
    const groups = getSynonymGroups(sense);
    expect(groups[0]!.definitionIndex).toBe(0);
  });

  it("无近义词：返回空数组", () => {
    const sense = makeSense({ synonyms: [], synonymsByDefinition: undefined });
    expect(getSynonymGroups(sense)).toEqual([]);
    const sense2 = makeSense({ synonyms: undefined, synonymsByDefinition: undefined });
    expect(getSynonymGroups(sense2)).toEqual([]);
  });

  it("definitions 空数组：不抛错，返回空或单分组带空释义", () => {
    const sense = makeSense({
      definitions: [],
      posByDefinition: [],
      synonyms: ["a"],
    });
    delete (sense as { synonymsByDefinition?: unknown }).synonymsByDefinition;
    const groups = getSynonymGroups(sense);
    // definitions 空 → 走 单义项分支（length <=1）返回首条空释义
    expect(groups).toHaveLength(1);
    expect(groups[0]!.definition).toBe("");
  });

  it("新字段含 undefined 项：按空数组处理过滤", () => {
    const sense = makeSense({
      definitions: ["义1", "义2"],
      posByDefinition: ["vt.", "n."],
      synonymsByDefinition: [[ "a" ], undefined as unknown as string[]],
    });
    const groups = getSynonymGroups(sense);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.definitionIndex).toBe(0);
  });

  it("posByDefinition 越界/缺失：pos 为空串不抛错", () => {
    const sense = makeSense({
      definitions: ["义1", "义2", "义3"],
      posByDefinition: ["vt."], // 长度与 definitions 不一致，resolveDefinitionPos 会处理
      synonyms: ["x"],
    });
    delete (sense as { synonymsByDefinition?: unknown }).synonymsByDefinition;
    const groups = getSynonymGroups(sense);
    expect(groups).toHaveLength(1);
    // ownerIdx 仍为 0（vt.）
    expect(groups[0]!.pos).toBe("vt.");
  });
});

describe("isSelfSynonym", () => {
  it("大小写不敏感", () => {
    expect(isSelfSynonym("Abandon", "abandon")).toBe(true);
    expect(isSelfSynonym("abandon", "ABANDON")).toBe(true);
    expect(isSelfSynonym("Abandon", "abandon ")).toBe(true);
  });
  it("空白归一", () => {
    expect(isSelfSynonym(" abandon ", "abandon")).toBe(true);
    expect(isSelfSynonym("  abandon  ", " abandon ")).toBe(true);
  });
  it("空串与空白串互相即自循环", () => {
    expect(isSelfSynonym("", "")).toBe(true);
    expect(isSelfSynonym(" ", "")).toBe(true);
    expect(isSelfSynonym("", " ")).toBe(true);
  });
  it("不同词返回 false", () => {
    expect(isSelfSynonym("abandon", "abandoned")).toBe(false);
    expect(isSelfSynonym("abandon", "ban")).toBe(false);
  });
});

describe("truncateDefinition", () => {
  it("短文本不截断", () => {
    expect(truncateDefinition("放弃")).toBe("放弃");
  });
  it("长文本截断并带省略号", () => {
    expect(truncateDefinition("这是一段很长的释义文本超过十八字", 8)).toBe("这是一段很长的释…");
  });
  it("空白会被 trim", () => {
    expect(truncateDefinition("  hello world  ", 5)).toBe("hello…");
  });
  it("默认 max 18 与搜词 16 差异可共用（调用处显式传）", () => {
    const text = "12345678901234567890"; // 20 字符
    expect(truncateDefinition(text)).toBe("123456789012345678…"); // 18
    expect(truncateDefinition(text, 16)).toBe("1234567890123456…"); // 16
  });
});
