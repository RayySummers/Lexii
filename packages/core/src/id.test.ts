import { describe, expect, it } from "vitest";
import { createId, hasIdPrefix } from "./id";

describe("createId", () => {
  it("生成带类型前缀的 id", () => {
    const id = createId("item");
    expect(id.startsWith("item_")).toBe(true);
    expect(id.length).toBe("item_".length + 10);
  });

  it("同一前缀生成不同的 id（默认随机源）", () => {
    const a = createId("evt", 12);
    const b = createId("evt", 12);
    expect(a).not.toBe(b);
  });

  it("注入确定性随机源时可复现", () => {
    const rng = () => 0;
    expect(createId("sense", 4, rng)).toBe("sense_AAAA");
  });

  it("随机串不包含易混淆字符", () => {
    for (const id of [createId("item"), createId("sense"), createId("evt", 12)]) {
      expect(id).not.toMatch(/[l1O0]/);
    }
  });

  it("支持指定长度", () => {
    expect(createId("item", 1).length).toBe("item_".length + 1);
  });
});

describe("hasIdPrefix", () => {
  it("识别前缀", () => {
    expect(hasIdPrefix("item_abc", "item")).toBe(true);
    expect(hasIdPrefix("item_abc", "sense")).toBe(false);
    expect(hasIdPrefix("item", "item")).toBe(false);
    expect(hasIdPrefix("", "evt")).toBe(false);
  });
});
