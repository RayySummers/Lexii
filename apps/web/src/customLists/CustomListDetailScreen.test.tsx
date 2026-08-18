/**
 * 自定义列表详情页（RAY-325）测试。
 *
 * 覆盖：词条展示、空状态、移出两步确认、列表不存在错误恢复。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomListEntryId } from "@lexii/core";
import type { CustomList, CustomListDetailItem, CustomListsDataProvider } from "./types";
import { CustomListDetailScreen } from "./CustomListDetailScreen";

interface ProviderHarness {
  provider: CustomListsDataProvider;
  getList: ReturnType<typeof vi.fn>;
  loadListEntries: ReturnType<typeof vi.fn>;
  removeWordFromList: ReturnType<typeof vi.fn>;
}

function makeList(overrides: Partial<CustomList> = {}): CustomList {
  return {
    id: "cl_test" as CustomList["id"],
    name: "工作常用",
    description: "邮件 / 会议高频词",
    status: "active",
    createdAt: "2026-08-13T10:00:00.000Z",
    updatedAt: "2026-08-13T10:00:00.000Z",
    removedAt: null,
    ...overrides,
  };
}

function makeDetailItem(
  overrides: {
    entryId?: string;
    senseId?: string;
    term?: string;
    pos?: string;
    ipa?: string;
    definitions?: string[];
  } = {},
): CustomListDetailItem {
  return {
    entry: {
      id: (overrides.entryId ?? "cle_test") as CustomListEntryId,
      listId: "cl_test" as CustomList["id"],
      senseId: (overrides.senseId ?? "sense_test") as CustomListDetailItem["entry"]["senseId"],
      addedAt: "2026-08-13T10:00:00.000Z",
    },
    sense: {
      id: (overrides.senseId ?? "sense_test") as CustomListDetailItem["sense"]["id"],
      lang: "en",
      term: overrides.term ?? "abandon",
      definitions: overrides.definitions ?? ["放弃"],
      pos: overrides.pos ?? "v.",
      ipa: overrides.ipa ?? "/əˈbændən/",
      tags: [],
      examples: [],
    },
  };
}

function makeHarness(
  options: {
    list?: CustomList | null;
    items?: CustomListDetailItem[];
    loadError?: Error;
  } = {},
): ProviderHarness {
  const list = options.list === undefined ? makeList() : options.list;
  const items = options.items ?? [];
  const getList = options.loadError
    ? vi.fn().mockRejectedValue(options.loadError)
    : vi.fn().mockResolvedValue(list);
  const loadListEntries = vi.fn().mockResolvedValue(items);
  const removeWordFromList = vi.fn().mockResolvedValue(undefined);
  const provider: CustomListsDataProvider = {
    loadSummaries: vi.fn(),
    createList: vi.fn(),
    updateList: vi.fn(),
    deleteList: vi.fn(),
    getList,
    loadListEntries,
    removeWordFromList,
  };
  return { provider, getList, loadListEntries, removeWordFromList };
}

describe("CustomListDetailScreen", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("渲染列表元数据 + 词条列表", async () => {
    const harness = makeHarness({
      items: [
        makeDetailItem({ term: "abandon" }),
        makeDetailItem({
          entryId: "cle_other",
          senseId: "sense_other",
          term: "yield",
          pos: "v.",
          ipa: "/jiːld/",
          definitions: ["产生"],
        }),
      ],
    });
    render(
      <CustomListDetailScreen
        provider={harness.provider}
        onExit={() => {}}
        listId={"cl_test" as CustomList["id"]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("工作常用")).toBeInTheDocument();
    });
    expect(screen.getByText("邮件 / 会议高频词")).toBeInTheDocument();
    expect(screen.getByText("abandon")).toBeInTheDocument();
    expect(screen.getByText("yield")).toBeInTheDocument();
    expect(screen.getByText("共 2 个词")).toBeInTheDocument();
  });

  it("空列表展示空状态引导", async () => {
    const harness = makeHarness({ items: [] });
    render(
      <CustomListDetailScreen
        provider={harness.provider}
        onExit={() => {}}
        listId={"cl_test" as CustomList["id"]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("这个列表还是空的")).toBeInTheDocument();
    });
  });

  it("列表不存在（getList 返回 undefined）展示错误状态", async () => {
    const harness = makeHarness({ list: null });
    render(
      <CustomListDetailScreen
        provider={harness.provider}
        onExit={() => {}}
        listId={"cl_test" as CustomList["id"]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("列表不存在或已被删除")).toBeInTheDocument();
    });
  });

  it("移出两步确认：点「移出」→ 出现「确认移出」→ 调用 removeWordFromList", async () => {
    const items = [
      makeDetailItem({
        entryId: "cle_target",
        senseId: "sense_target",
        term: "abandon",
      }),
    ];
    const harness = makeHarness({ items });
    render(
      <CustomListDetailScreen
        provider={harness.provider}
        onExit={() => {}}
        listId={"cl_test" as CustomList["id"]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("abandon")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /把「abandon」移出此列表/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^确认移出$/ })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /^确认移出$/ }));

    await waitFor(() => {
      expect(harness.removeWordFromList).toHaveBeenCalledWith("cle_target");
    });
  });

  it("移出对话框取消按钮不调用 removeWordFromList", async () => {
    const items = [makeDetailItem({ entryId: "cle_target", term: "abandon" })];
    const harness = makeHarness({ items });
    render(
      <CustomListDetailScreen
        provider={harness.provider}
        onExit={() => {}}
        listId={"cl_test" as CustomList["id"]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("abandon")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /把「abandon」移出此列表/ }));

    await screen.findByRole("button", { name: /^确认移出$/ });
    fireEvent.click(screen.getByRole("button", { name: /^取消$/ }));

    expect(harness.removeWordFromList).not.toHaveBeenCalled();
  });
});
