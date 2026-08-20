/**
 * 「添加到列表」对话框（RAY-325）测试。
 *
 * 覆盖：默认勾选已加入列表、提交时按 diff 计算 add / remove、空列表引导、
 * 内联新建列表并自动勾选。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomList, Sense, SenseId } from "@lexii/core";
import { AddToListsDialog } from "./AddToListsDialog";
import type { AddToListsDataProvider } from "./types";

interface ProviderHarness {
  provider: AddToListsDataProvider;
  listLists: ReturnType<typeof vi.fn>;
  getListsContainingSense: ReturnType<typeof vi.fn>;
  addWordToList: ReturnType<typeof vi.fn>;
  removeWordFromList: ReturnType<typeof vi.fn>;
  createListAndAdd: ReturnType<typeof vi.fn>;
}

function makeList(overrides: Partial<CustomList> = {}): CustomList {
  return {
    id: "cl_test" as CustomList["id"],
    name: "列表",
    description: "",
    status: "active",
    createdAt: "2026-08-13T10:00:00.000Z",
    updatedAt: "2026-08-13T10:00:00.000Z",
    removedAt: null,
    ...overrides,
  };
}

function makeSense(): Sense {
  return {
    id: "sense_test" as SenseId,
    lang: "en",
    term: "abandon",
    definitions: ["放弃"],
    pos: "v.",
    ipa: "/əˈbændən/",
    tags: [],
    examples: [],
  };
}

function makeHarness(
  options: {
    lists?: CustomList[];
    containing?: CustomList[];
  } = {},
): ProviderHarness {
  const lists = options.lists ?? [];
  const containing = options.containing ?? [];
  const listLists = vi.fn().mockResolvedValue(lists);
  const getListsContainingSense = vi.fn().mockResolvedValue(containing);
  const addWordToList = vi.fn().mockResolvedValue(undefined);
  const removeWordFromList = vi.fn().mockResolvedValue(undefined);
  const createListAndAdd = vi
    .fn<(name: string, senseId: SenseId) => Promise<CustomList["id"]>>()
    .mockImplementation(async (_name) => {
      const id = `cl_new_${Math.random()}` as CustomList["id"];
      return id;
    });
  const provider: AddToListsDataProvider = {
    listLists,
    getListsContainingSense,
    addWordToList,
    removeWordFromList,
    createListAndAdd,
  };
  return {
    provider,
    listLists,
    getListsContainingSense,
    addWordToList,
    removeWordFromList,
    createListAndAdd,
  };
}

describe("AddToListsDialog", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("渲染：标题、列表项、关闭按钮", async () => {
    const harness = makeHarness({
      lists: [makeList({ id: "cl_a" as CustomList["id"], name: "工作常用" })],
    });
    render(<AddToListsDialog provider={harness.provider} sense={makeSense()} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    expect(screen.getByText("工作常用")).toBeInTheDocument();
  });

  it("默认勾选：当前义项已加入的列表默认勾上", async () => {
    const listA = makeList({ id: "cl_a" as CustomList["id"], name: "A" });
    const listB = makeList({ id: "cl_b" as CustomList["id"], name: "B" });
    const harness = makeHarness({
      lists: [listA, listB],
      containing: [listA],
    });
    render(<AddToListsDialog provider={harness.provider} sense={makeSense()} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    const checkboxA = screen.getByLabelText("词单「A」") as HTMLInputElement;
    const checkboxB = screen.getByLabelText("词单「B」") as HTMLInputElement;
    expect(checkboxA.checked).toBe(true);
    expect(checkboxB.checked).toBe(false);
  });

  it("提交：按 diff 计算 add / remove（已勾选 + 新勾选触发 add，原勾选被取消触发 remove）", async () => {
    const listA = makeList({ id: "cl_a" as CustomList["id"], name: "A" });
    const listB = makeList({ id: "cl_b" as CustomList["id"], name: "B" });
    const harness = makeHarness({
      lists: [listA, listB],
      containing: [listA], // A 已加入
    });
    const onClose = vi.fn();
    render(<AddToListsDialog provider={harness.provider} sense={makeSense()} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    // 取消 A 勾选 → 应触发 remove
    fireEvent.click(screen.getByLabelText("词单「A」"));
    // 勾选 B → 应触发 add
    fireEvent.click(screen.getByLabelText("词单「B」"));
    fireEvent.click(screen.getByRole("button", { name: /^保存$/ }));

    await waitFor(() => {
      expect(harness.removeWordFromList).toHaveBeenCalledWith(listA.id, "sense_test");
      expect(harness.addWordToList).toHaveBeenCalledWith(listB.id, "sense_test");
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("空列表引导：提供「暂无词单」空状态与「去创建」入口", async () => {
    const harness = makeHarness({ lists: [] });
    render(<AddToListsDialog provider={harness.provider} sense={makeSense()} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("暂无词单")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /去创建/ })).toBeInTheDocument();
  });

  it("内联新建：填名称 → 创建并加入 → 自动勾选", async () => {
    const harness = makeHarness({
      lists: [makeList({ id: "cl_a" as CustomList["id"], name: "A" })],
    });
    render(<AddToListsDialog provider={harness.provider} sense={makeSense()} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /新建词单/ }));

    const input = await screen.findByPlaceholderText("词单名称");
    fireEvent.change(input, { target: { value: "新列表" } });
    fireEvent.click(screen.getByRole("button", { name: /创建并加入/ }));

    await waitFor(() => {
      expect(harness.createListAndAdd).toHaveBeenCalledWith("新列表", "sense_test");
    });
  });

  it("取消按钮调用 onClose，不调用 add / remove", async () => {
    const listA = makeList({ id: "cl_a" as CustomList["id"], name: "A" });
    const harness = makeHarness({ lists: [listA] });
    const onClose = vi.fn();
    render(<AddToListsDialog provider={harness.provider} sense={makeSense()} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /^取消$/ }));

    expect(onClose).toHaveBeenCalled();
    expect(harness.addWordToList).not.toHaveBeenCalled();
    expect(harness.removeWordFromList).not.toHaveBeenCalled();
  });

  it("候选词单滚动容器预留内边距：选中卡片 focus 描边不被裁剪（RAY-338 A2）", async () => {
    // 选中卡片的 focus 描边为 outline-2 + outline-offset-2（边框外 4px）。
    // 滚动容器 overflow-y-auto 会把 overflow-x 强制为 auto；容器无内边距时
    // 贴边卡片的左右描边被裁剪、只剩底边（描边残缺）。p-1.5（6px）保证
    // 描边完整落在裁剪区内——此处断言容器类名，防回归误删。
    const harness = makeHarness({
      lists: [makeList({ id: "cl_a" as CustomList["id"], name: "A" })],
    });
    render(<AddToListsDialog provider={harness.provider} sense={makeSense()} onClose={() => {}} />);

    const listContainer = await screen.findByRole("list", { name: "候选词单" });
    expect(listContainer.className).toContain("overflow-y-auto");
    expect(listContainer.className).toContain("p-1.5");
  });
});
