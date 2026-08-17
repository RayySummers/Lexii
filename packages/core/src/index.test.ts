import { describe, expect, it } from "vitest";
import { APP_NAME, APP_NAME_ZH } from "./index.js";

describe("@lexii/core", () => {
  it("导出应用名常量", () => {
    expect(APP_NAME).toBe("Lexii");
    expect(APP_NAME_ZH).toBe("乐希");
  });
});
