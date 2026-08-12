import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("@lexilexi/stats", () => {
  it("导出包名", () => {
    expect(PACKAGE_NAME).toBe("@lexilexi/stats");
  });
});
