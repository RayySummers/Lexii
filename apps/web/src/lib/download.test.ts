/**
 * 下载工具测试（jsdom 未实现 URL.createObjectURL，桩掉以验证下载被触发）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LexiiExportData } from "@lexii/core";
import { datedFilename, downloadTextFile, serializeBackup } from "./download";

describe("downloadTextFile", () => {
  const createObjectURL = vi.fn().mockReturnValue("blob:mock");
  const revokeObjectURL = vi.fn();
  const click = vi.fn();
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    vi.clearAllMocks();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    vi.restoreAllMocks();
  });

  it("创建正确 MIME 的 Blob、设置锚点文件名并触发下载、清理对象 URL", () => {
    const anchor = document.createElement("a");
    const createElementSpy = vi.spyOn(document, "createElement").mockReturnValue(anchor);

    downloadTextFile(
      "lexii-backup-2026-08-14.json",
      '{"format":"lexii"}',
      "application/json",
    );

    expect(anchor.download).toBe("lexii-backup-2026-08-14.json");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("application/json");
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");

    createElementSpy.mockRestore();
  });

  it("CSV 下载使用 text/csv MIME", () => {
    downloadTextFile(
      "lexii-wordlist-2026-08-14.csv",
      "term,definition,pos",
      "text/csv;charset=utf-8",
    );
    const blob = createObjectURL.mock.calls[0]![0] as Blob;
    expect(blob.type).toContain("csv");
  });
});

describe("datedFilename", () => {
  it("生成 YYYY-MM-DD 文件名", () => {
    expect(datedFilename("lexii-backup", "json")).toMatch(
      /^lexii-backup-\d{4}-\d{2}-\d{2}\.json$/,
    );
  });
});

describe("serializeBackup", () => {
  it("序列化为带缩进的 JSON（复习页/设置页共用）", () => {
    const data: LexiiExportData = {
      format: "lexii",
      exportFormatVersion: 1,
      dbSchemaVersion: 1,
      exportedAt: "2026-08-14T00:00:00.000Z",
      items: [],
      senses: [],
      memoryStates: [],
      events: [],
      notebookEntries: [],
    };
    expect(serializeBackup(data)).toBe(JSON.stringify(data, null, 2));
    expect(serializeBackup(data).startsWith('{\n  "format"')).toBe(true);
  });
});
