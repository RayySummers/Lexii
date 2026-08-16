/**
 * 搜词历史纯函数测试（RAY-292）。
 *
 * 覆盖：解析容错（非法 JSON / 非数组 / 混合类型 / 空白条目）、记录
 * （去重移前 / 上限截断 / 保留最新形态）、删除（大小写不敏感 / 未命中
 * 原样返回）、存储不可用（getItem / setItem 抛错）不抛错。
 */
import { describe, expect, it } from "vitest";
import {
  loadSearchHistory,
  parseSearchHistory,
  recordSearchHistory,
  removeSearchHistory,
  SEARCH_HISTORY_LIMIT,
  SEARCH_HISTORY_STORAGE_KEY,
  type SearchHistoryStorage,
} from "./searchHistory";

/** 内存版 storage：行为与 localStorage 一致（getItem 返回 null 表示缺失） */
function makeStorage(initial: Record<string, string> = {}): SearchHistoryStorage & {
  data: Record<string, string>;
} {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem(key: string): string | null {
      return Object.prototype.hasOwnProperty.call(data, key) ? (data[key] ?? null) : null;
    },
    setItem(key: string, value: string): void {
      data[key] = value;
    },
  };
}

describe("parseSearchHistory", () => {
  it("空值 / 空串解析为空历史", () => {
    expect(parseSearchHistory(null)).toEqual([]);
    expect(parseSearchHistory("")).toEqual([]);
  });

  it("合法 JSON 数组解析为词条列表（保持顺序）", () => {
    expect(parseSearchHistory(JSON.stringify(["apple", "banana"]))).toEqual(["apple", "banana"]);
  });

  it("非法 JSON 回落空历史", () => {
    expect(parseSearchHistory("{oops")).toEqual([]);
    expect(parseSearchHistory('"not-an-array"')).toEqual([]);
    expect(parseSearchHistory("42")).toEqual([]);
  });

  it("丢弃非字符串条目、空白条目并 trim/截断", () => {
    expect(parseSearchHistory(JSON.stringify([" apple ", "", "   ", 42, null, "banana"]))).toEqual([
      "apple",
      "banana",
    ]);
    expect(parseSearchHistory(JSON.stringify(["a".repeat(200)]))).toEqual(["a".repeat(100)]);
  });

  it("大小写不敏感去重（保留最前条目形态）", () => {
    expect(parseSearchHistory(JSON.stringify(["Apple", "apple", "APPLE"]))).toEqual(["Apple"]);
  });

  it("超出上限时截断到最新条目", () => {
    const many = Array.from({ length: SEARCH_HISTORY_LIMIT + 5 }, (_, i) => `w${i}`);
    expect(parseSearchHistory(JSON.stringify(many))).toEqual(many.slice(0, SEARCH_HISTORY_LIMIT));
  });
});

describe("loadSearchHistory", () => {
  it("读取存储中的历史", () => {
    const storage = makeStorage({
      [SEARCH_HISTORY_STORAGE_KEY]: JSON.stringify(["apple", "banana"]),
    });
    expect(loadSearchHistory(storage)).toEqual(["apple", "banana"]);
  });

  it("无存储对象 / getItem 抛错回落空历史", () => {
    expect(loadSearchHistory(null)).toEqual([]);
    const throwing: SearchHistoryStorage = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {},
    };
    expect(loadSearchHistory(throwing)).toEqual([]);
  });
});

describe("recordSearchHistory", () => {
  it("新词条插入最前", () => {
    const storage = makeStorage();
    expect(recordSearchHistory(storage, "apple")).toEqual(["apple"]);
    expect(recordSearchHistory(storage, "banana")).toEqual(["banana", "apple"]);
    expect(JSON.parse(storage.data[SEARCH_HISTORY_STORAGE_KEY] ?? "[]")).toEqual([
      "banana",
      "apple",
    ]);
  });

  it("已存在词条（大小写不敏感）移到最前并保留最新形态", () => {
    const storage = makeStorage();
    recordSearchHistory(storage, "apple");
    recordSearchHistory(storage, "banana");
    expect(recordSearchHistory(storage, "APPLE")).toEqual(["APPLE", "banana"]);
  });

  it("空白 / 纯空白词条不记录", () => {
    const storage = makeStorage();
    recordSearchHistory(storage, "apple");
    expect(recordSearchHistory(storage, "   ")).toEqual(["apple"]);
    expect(recordSearchHistory(storage, "")).toEqual(["apple"]);
    expect(storage.data[SEARCH_HISTORY_STORAGE_KEY]).toBe(JSON.stringify(["apple"]));
  });

  it("超出上限丢弃最旧条目", () => {
    const storage = makeStorage();
    let next: string[] = [];
    for (let i = 0; i < SEARCH_HISTORY_LIMIT + 3; i += 1) {
      next = recordSearchHistory(storage, `w${i}`);
    }
    expect(next).toHaveLength(SEARCH_HISTORY_LIMIT);
    expect(next[0]).toBe(`w${SEARCH_HISTORY_LIMIT + 2}`);
    expect(next).not.toContain("w0");
  });

  it("存储不可用（setItem 抛错）时仍返回内存态结果", () => {
    const throwing: SearchHistoryStorage = {
      getItem: () => null,
      setItem() {
        throw new Error("quota");
      },
    };
    expect(recordSearchHistory(throwing, "apple")).toEqual(["apple"]);
  });
});

describe("removeSearchHistory", () => {
  it("删除匹配词条（大小写不敏感）并写回存储", () => {
    const storage = makeStorage();
    recordSearchHistory(storage, "apple");
    recordSearchHistory(storage, "banana");
    expect(removeSearchHistory(storage, "APPLE")).toEqual(["banana"]);
    expect(JSON.parse(storage.data[SEARCH_HISTORY_STORAGE_KEY] ?? "[]")).toEqual(["banana"]);
  });

  it("未命中时原样返回且不写存储", () => {
    const storage = makeStorage();
    recordSearchHistory(storage, "apple");
    const before = storage.data[SEARCH_HISTORY_STORAGE_KEY];
    expect(removeSearchHistory(storage, "cherry")).toEqual(["apple"]);
    expect(storage.data[SEARCH_HISTORY_STORAGE_KEY]).toBe(before);
  });

  it("删除最后一条后历史为空", () => {
    const storage = makeStorage();
    recordSearchHistory(storage, "apple");
    expect(removeSearchHistory(storage, "apple")).toEqual([]);
    expect(JSON.parse(storage.data[SEARCH_HISTORY_STORAGE_KEY] ?? "[]")).toEqual([]);
  });

  it("空存储对象上删除不抛错", () => {
    expect(removeSearchHistory(null, "apple")).toEqual([]);
  });
});
