import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("@lexii/ai", () => {
  it("导出包名", () => {
    expect(PACKAGE_NAME).toBe("@lexii/ai");
  });
});
