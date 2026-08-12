import { describe, expect, it } from "vitest";
import { RATINGS, type MemoryState, type Rating } from "./index.js";

describe("@lexilexi/fsrs", () => {
  it("评分档位与 FSRS 官方参考实现一致", () => {
    expect(RATINGS).toEqual(["again", "hard", "good", "easy"]);
  });

  it("每个评分档位都是合法的 Rating 类型", () => {
    const valid: readonly Rating[] = ["again", "hard", "good", "easy"];
    expect(valid).toEqual(RATINGS);
  });

  it("记忆状态类型包含骨架声明的四个阶段", () => {
    const states: readonly MemoryState[] = ["new", "learning", "review", "relearning"];
    expect(states).toHaveLength(4);
  });
});
