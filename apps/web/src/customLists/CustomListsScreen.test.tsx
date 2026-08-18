/**
 * 自定义词单列表管理页（RAY-325）测试。
 *
 * 覆盖：概览统计、列表卡片、创建 / 编辑 / 删除流程、空状态、错误恢复。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomList, CustomListDetailItem, CustomListsDataProvider } from "./types";
import { CustomListsScreen } from "./CustomListsScreen";

interface ProviderHarness {
  provider: CustomListsDataProvider;
  loadSummaries: ReturnType<typeof vi.fn>;
  createList: ReturnType<typeof vi.fn>;
  updateList: ReturnType<typeof vi.fn>;
  deleteList: ReturnType<typeof vi.fn>;
  getList: ReturnType<typeof vi.fn>;
  loadListEntries: ReturnType<typeof vi.fn>;
  removeWordFromList: ReturnType<typeof vi.fn>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

function makeList(overrides: Partial<CustomList> = {}): CustomList {
  const base: CustomList = {
    id: "cl_test" as CustomList["id"],
    name: "阅读常见词",
    description: "在英文阅读里高频遇到的词",
    status: "active",
    createdAt: "2026-08-13T10:00:00.000Z",
    updatedAt: "2026-08-13T10:00:00.000Z",
    removedAt: null,
  };
  return { ...base, ...overrides };
}

function makeHarness(
  options: {
    summaries?: Array<{ list: CustomList; entryCount: number; latestAddedAt: string | null }>;
    detailsByList?: Map<string, CustomListDetailItem[]>;
    loadError?: Error;
    deleteError?: Error;
  } = {},
): ProviderHarness {
  const summaries = options.summaries ?? [];
  const detailsByList = options.detailsByList ?? new Map();
  const loadSummaries = options.loadError
    ? vi.fn().mockRejectedValue(options.loadError)
    : vi.fn().mockResolvedValue(summaries);
  const createList = vi
    .fn<(input: { name: string; description?: string }) => Promise<CustomList>>()
    .mockImplementation(async (input) =>
      makeList({ name: input.name, description: input.description ?? "" }),
    );
  const updateList = vi
    .fn<
      (input: {
        id: CustomList["id"];
        name?: string;
        description?: string | null;
      }) => Promise<CustomList>
    >()
    .mockImplementation(async (input) => {
      const target = summaries.find((s) => s.list.id === input.id)?.list;
      if (!target) throw new Error("not found");
      return {
        ...target,
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description ?? "" } : {}),
        updatedAt: "2026-08-14T10:00:00.000Z",
      };
    });
  const deleteList = options.deleteError
    ? vi.fn().mockRejectedValue(options.deleteError)
    : vi.fn().mockResolvedValue(undefined);
  const getList = vi
    .fn<(id: CustomList["id"]) => Promise<CustomList | undefined>>()
    .mockImplementation(async (id) => summaries.find((s) => s.list.id === id)?.list);
  const loadListEntries = vi
    .fn<(id: CustomList["id"]) => Promise<CustomListDetailItem[]>>()
    .mockImplementation(async (id) => detailsByList.get(id) ?? []);
  const removeWordFromList = vi.fn().mockResolvedValue(undefined);
  const provider: CustomListsDataProvider = {
    loadSummaries,
    createList,
    updateList,
    deleteList,
    getList,
    loadListEntries,
    removeWordFromList,
  };
  return {
    provider,
    loadSummaries,
    createList,
    updateList,
    deleteList,
    getList,
    loadListEntries,
    removeWordFromList,
  };
}

describe("CustomListsScreen", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("空库渲染空状态 + 创建入口", async () => {
    const harness = makeHarness({ summaries: [] });
    render(
      <CustomListsScreen provider={harness.provider} onExit={() => {}} onOpenList={() => {}} />,
    );

    await waitFor(() => {
      expect(screen.getByText("还没有自定义词单")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /创建词单/ })).toBeInTheDocument();
  });

  it("加载概览：列表总数 / 词条总数", async () => {
    const summaries = [
      {
        list: makeList({ id: "cl_a" as CustomList["id"], name: "工作常用" }),
        entryCount: 12,
        latestAddedAt: "2026-08-15T10:00:00.000Z",
      },
      {
        list: makeList({ id: "cl_b" as CustomList["id"], name: "阅读常见词" }),
        entryCount: 5,
        latestAddedAt: "2026-08-10T10:00:00.000Z",
      },
    ];
    const harness = makeHarness({ summaries });
    render(
      <CustomListsScreen provider={harness.provider} onExit={() => {}} onOpenList={() => {}} />,
    );

    await waitFor(() => {
      expect(screen.getByText("工作常用")).toBeInTheDocument();
    });
    expect(screen.getByText("2 个")).toBeInTheDocument(); // 列表数
    expect(screen.getByText("17")).toBeInTheDocument(); // 词条数（12 + 5）
  });

  it("卡片显示词条数 + 最近加入时刻", async () => {
    const summaries = [
      {
        list: makeList({ id: "cl_a" as CustomList["id"], name: "工作常用" }),
        entryCount: 12,
        latestAddedAt: "2026-08-15T10:00:00.000Z",
      },
    ];
    const harness = makeHarness({ summaries });
    render(
      <CustomListsScreen provider={harness.provider} onExit={() => {}} onOpenList={() => {}} />,
    );

    await waitFor(() => {
      expect(screen.getByText("工作常用")).toBeInTheDocument();
    });
    expect(screen.getByText("12 词")).toBeInTheDocument();
    expect(screen.getByText(/最近加入 2026\/8\/15/)).toBeInTheDocument();
  });

  it("点击卡片主体进入详情（onOpenList）", async () => {
    const list = makeList({ id: "cl_a" as CustomList["id"], name: "工作常用" });
    const summaries = [{ list, entryCount: 0, latestAddedAt: null }];
    const harness = makeHarness({ summaries });
    const onOpenList = vi.fn();
    render(
      <CustomListsScreen provider={harness.provider} onExit={() => {}} onOpenList={onOpenList} />,
    );

    await waitFor(() => {
      expect(screen.getByText("工作常用")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: `打开词单「${list.name}」` }));
    expect(onOpenList).toHaveBeenCalledWith(list.id);
  });

  it("创建流程：填写名称 → 创建 → 列表刷新", async () => {
    const harness = makeHarness({ summaries: [] });
    render(
      <CustomListsScreen provider={harness.provider} onExit={() => {}} onOpenList={() => {}} />,
    );

    await waitFor(() => {
      expect(screen.getByText("还没有自定义词单")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /创建词单/ }));

    const nameInput = await screen.findByPlaceholderText(/如：阅读常见词/);
    fireEvent.change(nameInput, { target: { value: "  工作常用  " } });

    fireEvent.click(screen.getByRole("button", { name: /^创建$/ }));

    await waitFor(() => {
      expect(harness.createList).toHaveBeenCalledWith({
        name: "工作常用",
        description: "",
      });
    });
  });

  it("创建空名称时显示错误，不调用 createList", async () => {
    const harness = makeHarness({ summaries: [] });
    render(
      <CustomListsScreen provider={harness.provider} onExit={() => {}} onOpenList={() => {}} />,
    );

    await waitFor(() => {
      expect(screen.getByText("还没有自定义词单")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /创建词单/ }));

    const nameInput = await screen.findByPlaceholderText(/如：阅读常见词/);
    fireEvent.change(nameInput, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /^创建$/ }));

    expect(harness.createList).not.toHaveBeenCalled();
    expect(await screen.findByText("词单名称不能为空")).toBeInTheDocument();
  });

  it("编辑流程：点铅笔 → 改名称 → 保存", async () => {
    const list = makeList({ id: "cl_a" as CustomList["id"], name: "原名" });
    const summaries = [{ list, entryCount: 0, latestAddedAt: null }];
    const harness = makeHarness({ summaries });
    render(
      <CustomListsScreen provider={harness.provider} onExit={() => {}} onOpenList={() => {}} />,
    );

    await waitFor(() => {
      expect(screen.getByText("原名")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: `编辑词单「${list.name}」` }));

    const nameInput = await screen.findByDisplayValue("原名");
    fireEvent.change(nameInput, { target: { value: "新名" } });
    fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));

    await waitFor(() => {
      expect(harness.updateList).toHaveBeenCalledWith({
        id: list.id,
        name: "新名",
        description: list.description,
      });
    });
  });

  it("删除流程：垃圾桶 → 二次确认对话框 → 确认删除", async () => {
    const list = makeList({ id: "cl_a" as CustomList["id"], name: "工作常用" });
    const summaries = [{ list, entryCount: 5, latestAddedAt: "2026-08-15T10:00:00.000Z" }];
    const harness = makeHarness({ summaries });
    render(
      <CustomListsScreen provider={harness.provider} onExit={() => {}} onOpenList={() => {}} />,
    );

    await waitFor(() => {
      expect(screen.getByText("工作常用")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: `删除词单「${list.name}」` }));

    // 二次确认对话框
    const dialog = await screen.findByRole("dialog", { name: /确认删除词单/ });
    expect(dialog).toHaveTextContent("工作常用");
    expect(dialog).toHaveTextContent(/归类记录将被移除/);

    fireEvent.click(screen.getByRole("button", { name: /^确认删除$/ }));

    await waitFor(() => {
      expect(harness.deleteList).toHaveBeenCalledWith(list.id);
    });
  });

  it("删除对话框取消按钮不调用 deleteList", async () => {
    const list = makeList({ id: "cl_a" as CustomList["id"], name: "工作常用" });
    const summaries = [{ list, entryCount: 0, latestAddedAt: null }];
    const harness = makeHarness({ summaries });
    render(
      <CustomListsScreen provider={harness.provider} onExit={() => {}} onOpenList={() => {}} />,
    );

    await waitFor(() => {
      expect(screen.getByText("工作常用")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: `删除词单「${list.name}」` }));

    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /^取消$/ }));

    expect(harness.deleteList).not.toHaveBeenCalled();
  });

  it("错误状态：loadSummaries 抛出 → 友好提示 + 重试", async () => {
    const harness = makeHarness({ loadError: new Error("数据库故障") });
    render(
      <CustomListsScreen provider={harness.provider} onExit={() => {}} onOpenList={() => {}} />,
    );

    await waitFor(() => {
      expect(screen.getByText("词单暂时无法加载，请稍后重试。")).toBeInTheDocument();
    });
    expect(screen.getByText("重试")).toBeInTheDocument();
  });
});
