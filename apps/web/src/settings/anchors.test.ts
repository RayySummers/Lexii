import { describe, expect, it } from "vitest";
import {
  findSettingsSectionByAnchor,
  parseSettingsAnchorFromHash,
  SETTINGS_ANCHOR_EXTENSION_PACKAGES,
  SETTINGS_SECTION_ID_EXTENSION_PACKAGES,
} from "./anchors";

describe("settings anchors (RAY-364)", () => {
  it("parseSettingsAnchorFromHash 解析 ?anchor= 与 #fragment", () => {
    expect(parseSettingsAnchorFromHash("#/settings?anchor=extension-packages")).toBe(
      "extension-packages",
    );
    expect(parseSettingsAnchorFromHash("#/settings?anchor=extension-packages&foo=bar")).toBe(
      "extension-packages",
    );
    expect(parseSettingsAnchorFromHash("#/settings#extension-packages")).toBe("extension-packages");
    expect(parseSettingsAnchorFromHash("#/settings")).toBeNull();
    expect(parseSettingsAnchorFromHash("")).toBeNull();
    expect(parseSettingsAnchorFromHash("#/settings?foo=bar")).toBeNull();
  });

  it("findSettingsSectionByAnchor 异常 anchor 不抛 SyntaxError（B1 加固）", () => {
    const section = document.createElement("section");
    section.id = SETTINGS_SECTION_ID_EXTENSION_PACKAGES;
    section.setAttribute("data-anchor", SETTINGS_ANCHOR_EXTENSION_PACKAGES);
    document.body.appendChild(section);
    try {
      // 异常 anchor 含引号、括号等特殊字符，应被 CSS.escape 转义并静默，禁止抛 SyntaxError
      const abnormalAnchors = [`"][data-anchor="x`, `a"b`, `a]b`, `a[b]`, `"`, `']`];
      for (const anchor of abnormalAnchors) {
        expect(() => findSettingsSectionByAnchor(anchor)).not.toThrow();
        // 异常 anchor 未对应任何元素，返回 null 而非抛错
        const result = findSettingsSectionByAnchor(anchor);
        // 若异常 anchor 恰好等于常量则返回 section，否则 null；但绝不抛错
        if (anchor !== SETTINGS_ANCHOR_EXTENSION_PACKAGES) {
          expect(result).toBeNull();
        }
      }
      // 正常锚点仍可定位
      expect(findSettingsSectionByAnchor(SETTINGS_ANCHOR_EXTENSION_PACKAGES)).toBe(section);
      expect(findSettingsSectionByAnchor(SETTINGS_SECTION_ID_EXTENSION_PACKAGES)).toBe(section);
    } finally {
      section.remove();
    }
  });

  it("常量为稳定 id/data-anchor，非硬编码索引", () => {
    expect(SETTINGS_ANCHOR_EXTENSION_PACKAGES).toBe("extension-packages");
    expect(SETTINGS_SECTION_ID_EXTENSION_PACKAGES).toBe("settings-section-extension-packages");
    expect(SETTINGS_ANCHOR_EXTENSION_PACKAGES).not.toMatch(/^\d+$/);
  });
});
