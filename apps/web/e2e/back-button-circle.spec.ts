/**
 * 复习 / 测验页返回按钮「正圆」e2e（RAY-488）。
 *
 * 背景：RAY-373 把 `ScreenHeader` 的返回按钮从 `p-2.5`（只有内边距撑开，没有固定
 * 宽高、也没有 `shrink-0`）改成固定 `h-10 w-10 shrink-0`，但同一旧写法在
 * `ReviewScreen` / `QuizScreen` 各残留一处。旧写法下按钮尺寸由「图标行盒 + 内边距」
 * 推导，宽高并不相等（修复前实测 320px 视口为 42×46），`rounded-full` 就渲染成椭圆；
 * 这两个按钮又与右侧进度文字同处一个 `flex items-center justify-between` 行，
 * 缺 `shrink-0` 时还会被挤压。本 spec 把「正圆 + 进度单行」沉淀成回归断言——
 * jsdom 没有布局引擎，宽高相等只能在真实浏览器里量。
 *
 * 断言口径（RAY-488 验收标准 1 / 2 / 3）：
 * - 320 / 375 / 390 / 768 / 1280 五个视口下，返回按钮 `getBoundingClientRect()`
 *   宽 === 高，且整数像素等于 40；
 * - 复习页（卡片形式）与测验页（选择题形式）各量一次——两处是独立组件；
 * - 右侧进度文字单行不换行、不溢出。
 *
 * 走真实应用流程（IndexedDB 冷启动）：首启弹窗 → 选学习形式 → 学习 → 卡片 /
 * 选择题；空库先导入内置示例词表（与 review-card.spec.ts 同口径）。
 */
import { expect, test, type Page } from "@playwright/test";

/** 验收标准 1 的五个视口（CSS px） */
const VIEWPORTS = [
  { width: 320, height: 844 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
] as const;

/** 正圆边长：h-10 / w-10 = 2.5rem = 40px */
const BACK_BUTTON_SIZE_PX = 40;

/** 两个被验页面（学习形式切换决定落到哪个组件） */
const SCREENS = [
  { label: "复习页（卡片）", format: "卡片" },
  { label: "测验页（选择题）", format: "选择题" },
] as const;

/** 返回按钮（可达名「返回首页」；撤销后的「返回」pill 是另一个按钮，不在口径内） */
function backButton(page: Page) {
  return page.locator('main button[aria-label="返回首页"]');
}

/** 右侧进度文字（复习页 `3 / 12 · 剩余 9` / 测验页 `3 / 12 · 已答 2`） */
function progressText(page: Page) {
  return page.locator('main [role="status"][aria-label^="进度"]');
}

/**
 * 关掉首启弹窗（RAY-282）。
 *
 * 弹窗在 React 挂载时同步读 localStorage 决定是否展示，冷启动必然出现；但它挂在
 * 首帧之后，`goto` 返回的瞬间可能还没渲染——那时按 role 找首页元素会被 modal 的
 * aria-hidden 挡成全无匹配，所以这里显式等「弹窗或首页」先出现再处理。
 */
async function dismissFirstOpen(page: Page): Promise<void> {
  const startButton = page.getByRole("dialog").getByRole("button", { name: "开始使用" });
  const homeRadio = page.getByRole("radio", { name: "卡片", exact: true });
  await Promise.race([
    startButton.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
    homeRadio.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
  ]);
  if (await startButton.isVisible().catch(() => false)) {
    await startButton.click();
  }
  // 关掉弹窗后首页才可交互（弹窗未出现时此处等于直接通过）
  await homeRadio.waitFor({ state: "visible", timeout: 15_000 });
}

/**
 * 用卡片形式确认词库有词：卡片模式的空状态才有「导入内置示例词表」，
 * 选择题模式的空状态只有一句「词库还是空的」——所以测验页必须先用卡片
 * 形式把内置示例词表导进去，再回首页切学习形式。
 */
async function ensureWordlistViaCardMode(page: Page): Promise<void> {
  await page.getByRole("radio", { name: "卡片", exact: true }).click();
  await page.getByRole("button", { name: "学习", exact: true }).click();
  const card = page.locator("[aria-expanded]");
  const importButton = page.getByRole("button", { name: /导入内置示例词表/ });
  // 空库 → 空状态出导入按钮；非空库（Tier0 已装）→ 直接出卡片。
  // 两条路径竞速，先出现谁走谁，最终都落到有卡片、词库非空的状态。
  await Promise.race([
    card.waitFor({ state: "visible", timeout: 60_000 }),
    importButton.waitFor({ state: "visible", timeout: 60_000 }).then(async () => {
      await importButton.click();
      await card.waitFor({ state: "visible", timeout: 60_000 });
    }),
  ]);
  // 回首页，交给调用方按目标学习形式重新进入
  await backButton(page).click();
  await page.getByRole("button", { name: "学习", exact: true }).waitFor({ state: "visible" });
}

/** 选学习形式 → 进入「学习」→ 等到进度文字出现（会话已进入答题阶段） */
async function openStudy(page: Page, format: (typeof SCREENS)[number]["format"]): Promise<void> {
  await ensureWordlistViaCardMode(page);
  await page.getByRole("radio", { name: format, exact: true }).click();
  await page.getByRole("button", { name: "学习", exact: true }).click();
  await progressText(page).waitFor({ state: "visible", timeout: 60_000 });
}

/** 返回按钮 + 进度文字的浏览器内实测数值 */
async function measure(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    if (!main) {
      throw new Error("未找到复习 / 测验页 main");
    }
    const button = main.querySelector('button[aria-label="返回首页"]');
    if (!button) {
      throw new Error("未找到返回按钮");
    }
    const progress = main.querySelector('[role="status"][aria-label^="进度"]');
    if (!progress) {
      throw new Error("未找到进度文字");
    }
    const br = button.getBoundingClientRect();
    const icon = button.firstElementChild;
    const ir = icon ? icon.getBoundingClientRect() : null;
    const pr = progress.getBoundingClientRect();
    const pcs = getComputedStyle(progress);
    return {
      buttonWidth: br.width,
      buttonHeight: br.height,
      buttonBorderRadius: getComputedStyle(button).borderRadius,
      buttonIconWidth: ir ? ir.width : 0,
      buttonIconHeight: ir ? ir.height : 0,
      progressText: progress.textContent ?? "",
      /** 行盒数量：单行 = 1（换行会拆成多个行盒） */
      progressLineBoxes: progress.getClientRects().length,
      progressHeight: pr.height,
      progressLineHeight: Number.parseFloat(pcs.lineHeight),
      progressRight: pr.right,
      progressScrollWidth: progress.scrollWidth,
      progressClientWidth: progress.clientWidth,
      mainScrollWidth: main.scrollWidth,
      mainClientWidth: main.clientWidth,
      viewportWidth: window.innerWidth,
    };
  });
}

for (const screen of SCREENS) {
  test.describe(`返回按钮正圆（RAY-488 · ${screen.label}）`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto("/");
      await dismissFirstOpen(page);
      await openStudy(page, screen.format);
    });

    test("320/375/390/768/1280 五视口：宽 === 高 === 40，进度文字单行不溢出", async ({ page }) => {
      const observed: string[] = [];
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        // 等一帧布局稳定（视口变化后 rect 需重新计算）
        await page.evaluate(
          () => new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
        );
        const m = await measure(page);
        observed.push(`${viewport.width}px: ${m.buttonWidth}×${m.buttonHeight}`);

        // 验收 1：正圆 —— 宽高相等，且整数像素 = 40（椭圆时会写成 40×36 之类）
        expect(m.buttonWidth, `${viewport.width}px 宽`).toBe(m.buttonHeight);
        expect(Math.round(m.buttonWidth), `${viewport.width}px 宽取整`).toBe(BACK_BUTTON_SIZE_PX);
        // 正圆语义仍由 rounded-full 提供（兜住「改成方形」这类回归）。
        // Tailwind v4 的 rounded-full = calc(infinity * 1px)，计算值不是 9999px，
        // 所以按「圆角半径 >= 半边长」判定圆形，两种写法都成立。
        expect(
          Number.parseFloat(m.buttonBorderRadius),
          `${viewport.width}px 圆角半径`,
        ).toBeGreaterThanOrEqual(BACK_BUTTON_SIZE_PX / 2);
        // 按钮内只有装饰性图标（Material Symbols 文本字形，aria-hidden），
        // 可达名来自 aria-label——顺带兜住「图标被撑大导致宽高不等」的回归
        expect(m.buttonIconWidth, `${viewport.width}px 图标宽`).toBe(20);
        expect(m.buttonIconHeight, `${viewport.width}px 图标高`).toBe(20);

        // 验收 3：进度文字单行不换行、不溢出
        expect(m.progressText.trim().length, `${viewport.width}px 进度文案非空`).toBeGreaterThan(0);
        expect(m.progressLineBoxes, `${viewport.width}px 进度行盒数`).toBe(1);
        expect(m.progressHeight, `${viewport.width}px 进度高度`).toBeLessThanOrEqual(
          m.progressLineHeight + 1,
        );
        expect(m.progressScrollWidth, `${viewport.width}px 进度自身不溢出`).toBeLessThanOrEqual(
          m.progressClientWidth + 1,
        );
        expect(m.progressRight, `${viewport.width}px 进度右边界`).toBeLessThanOrEqual(
          m.viewportWidth,
        );
        expect(m.mainScrollWidth, `${viewport.width}px 无横向溢出`).toBeLessThanOrEqual(
          m.mainClientWidth + 1,
        );
      }
      // 失败时把五视口实测值带进报告，便于定位是哪个视口被压扁
      expect(observed.join(", ")).toContain("320px");
      console.log(`[RAY-488 ${screen.label}] 实测宽高：${observed.join(", ")}`);
    });

    test("窄视口挤压回归：容器人为收窄时按钮仍为正圆", async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 844 });
      // 人为把进度文案换成超长内容，制造「右侧内容挤压左侧按钮」的最坏形态：
      // 正圆必须靠固定 h-10 w-10 + shrink-0 撑住，而不是靠内容恰好放得下。
      await page.evaluate(() => {
        const progress = document.querySelector('main [role="status"][aria-label^="进度"]');
        if (!progress) {
          throw new Error("未找到进度文字");
        }
        progress.textContent = "3 / 12 · 剩余 9 · 超长压力测试文案".repeat(4);
      });
      const m = await measure(page);
      expect(m.buttonWidth).toBe(m.buttonHeight);
      expect(Math.round(m.buttonWidth)).toBe(BACK_BUTTON_SIZE_PX);
    });
  });
}
