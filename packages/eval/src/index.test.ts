import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("@lexii/eval", () => {
  it("导出包名", () => {
    expect(PACKAGE_NAME).toBe("@lexii/eval");
  });
});
