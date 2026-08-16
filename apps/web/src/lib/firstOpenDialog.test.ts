import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIRST_OPEN_DIALOG_DISMISSED_VALUE,
  FIRST_OPEN_DIALOG_STORAGE_KEY,
  markFirstOpenDialogDismissed,
  shouldShowFirstOpenDialog,
} from "./firstOpenDialog";

describe("firstOpenDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("无已读标记时返回 true（首次打开展示弹窗）", () => {
    expect(shouldShowFirstOpenDialog()).toBe(true);
  });

  it("已读标记存在时返回 false（再次打开不再展示）", () => {
    window.localStorage.setItem(FIRST_OPEN_DIALOG_STORAGE_KEY, FIRST_OPEN_DIALOG_DISMISSED_VALUE);
    expect(shouldShowFirstOpenDialog()).toBe(false);
  });

  it("markFirstOpenDialogDismissed 写入已读标记，之后不再展示", () => {
    markFirstOpenDialogDismissed();
    expect(window.localStorage.getItem(FIRST_OPEN_DIALOG_STORAGE_KEY)).toBe(
      FIRST_OPEN_DIALOG_DISMISSED_VALUE,
    );
    expect(shouldShowFirstOpenDialog()).toBe(false);
  });

  it("localStorage 读取抛错时回落 false（隐私模式等不可用场景不弹窗）", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    expect(shouldShowFirstOpenDialog()).toBe(false);
  });

  it("localStorage 写入抛错时静默不抛（会话内状态已负责隐藏）", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage denied");
    });
    expect(() => markFirstOpenDialogDismissed()).not.toThrow();
  });
});
