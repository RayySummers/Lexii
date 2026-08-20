/**
 * 背词卡片固定高度 + 面内滚动 e2e（RAY-291，评审 nit 1：真机形态断言入库）。
 *
 * 走真实应用流程（IndexedDB 冷启动）：首启弹窗 → 学习 → 卡片；
 * 空库先导入内置示例词表，Tier0 已装则直接进入复习（两条路径都落到卡片）。
 * 断言聚焦移动端真机形态行为：
 * - 卡片高度 = 视口公式值 clamp(14rem, 100dvh − 26rem, 32rem)，换卡不变；
 * - 常见配置下整页落在一屏内、评分按钮始终可见；
 * - 超长内容在面内滚动、卡片高度不变、评分提示固定在卡片底栏；
 * - 深色模式（跟随系统）下卡片面使用深色 design token。
 */
import { expect, test, type Page } from "@playwright/test";
import {
  CARD_HEIGHT_MAX_REM,
  CARD_HEIGHT_MIN_REM,
  CARD_HEIGHT_OFFSET_REM,
} from "../src/review/ReviewCard";

/** 固定高度公式（与组件导出的常量同源，改常量即联动断言）：clamp(MIN, 100dvh − OFFSET, MAX) */
function expectedCardHeight(dvh: number): number {
  return Math.min(
    CARD_HEIGHT_MAX_REM * 16,
    Math.max(CARD_HEIGHT_MIN_REM * 16, dvh - CARD_HEIGHT_OFFSET_REM * 16),
  );
}

/** 数值断言（±tolerance px，Playwright 不提供浮点容差语法时用区间表达） */
function expectWithinPx(value: number, target: number, tolerance: number): void {
  expect(Math.abs(value - target)).toBeLessThanOrEqual(tolerance);
}

async function dismissFirstOpen(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "开始使用" }).click();
  }
}

/** 进入学习并等到卡片出现（空库路径自动导入内置示例词表） */
async function openLearnAndWaitCard(page: Page): Promise<void> {
  await page.getByRole("button", { name: "学习", exact: true }).click();
  const card = page.locator("button[aria-expanded]");
  const importButton = page.getByRole("button", { name: /导入内置示例词表/ });
  // 空库 → 空状态出导入按钮；非空库（Tier0 已装）→ 直接出卡片。
  // 两条路径竞速，先出现谁走谁，最终都落到卡片。
  await Promise.race([
    card.waitFor({ state: "visible", timeout: 60_000 }),
    importButton.waitFor({ state: "visible", timeout: 60_000 }).then(async () => {
      await importButton.click();
      await card.waitFor({ state: "visible", timeout: 60_000 });
    }),
  ]);
}

/** 卡片布局度量（当前可见面；返回浏览器内的实测数值） */
async function measureCard(page: Page) {
  return page.evaluate(() => {
    const btn = document.querySelector("button[aria-expanded]");
    if (!btn) {
      throw new Error("未找到卡片按钮");
    }
    const wrap = btn.parentElement as HTMLElement;
    const face = btn.querySelector('[aria-hidden="false"]') as HTMLElement;
    const region = face.querySelector(".overflow-y-auto") as HTMLElement;
    const rating = document.querySelector('button[aria-label^="评分："]') as HTMLElement;
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;height:100dvh;visibility:hidden";
    document.body.appendChild(probe);
    const dvh = probe.getBoundingClientRect().height;
    probe.remove();
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height };
    };
    return {
      dvh,
      cardHeight: rect(wrap).height,
      docScrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      ratingVisible: rect(rating).bottom <= window.innerHeight,
      regionOverflowY: getComputedStyle(region).overflowY,
      regionClientHeight: region.clientHeight,
      regionScrollHeight: region.scrollHeight,
    };
  });
}

test.describe("背词卡片固定高度（RAY-291）", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await dismissFirstOpen(page);
  });

  test("卡片高度 = 视口公式值，且换卡后高度一致", async ({ page }) => {
    await openLearnAndWaitCard(page);
    const first = await measureCard(page);
    expectWithinPx(first.cardHeight, expectedCardHeight(first.dvh), 1);

    // 评分推进到下一张卡：高度只由视口决定，不随词条内容变化
    const firstLabel =
      (await page.locator("button[aria-expanded]").getAttribute("aria-label")) ?? "";
    await page.keyboard.press("3");
    await page.waitForFunction(
      (label) => {
        const btn = document.querySelector("button[aria-expanded]");
        return Boolean(
          btn &&
          btn.getAttribute("aria-label") !== label &&
          btn.getAttribute("aria-expanded") === "false",
        );
      },
      firstLabel,
      { timeout: 30_000 },
    );
    const second = await measureCard(page);
    expectWithinPx(second.cardHeight, first.cardHeight, 1);
  });

  test("常见配置下整页落在一屏内、评分按钮始终可见", async ({ page }) => {
    await openLearnAndWaitCard(page);
    const m = await measureCard(page);
    expect(m.docScrollHeight).toBeLessThanOrEqual(m.innerHeight + 1);
    expect(m.ratingVisible).toBe(true);
    expect(m.regionOverflowY).toBe("auto");
  });

  test("超长内容在面内滚动：卡片高度不变、评分提示固定在底栏", async ({ page }) => {
    await openLearnAndWaitCard(page);
    await page.locator("button[aria-expanded]").click();
    await page.waitForFunction(() => {
      const btn = document.querySelector("button[aria-expanded]");
      return btn?.getAttribute("aria-expanded") === "true";
    });

    const before = await measureCard(page);
    // 注入超长内容：模拟富化字段齐全的超长词条（无需依赖真实词书数据）
    await page.evaluate(() => {
      const region = document.querySelector(
        'button[aria-expanded] [aria-hidden="false"] .overflow-y-auto',
      );
      if (!region) {
        throw new Error("未找到背面滚动区");
      }
      for (let i = 1; i <= 30; i++) {
        const p = document.createElement("p");
        p.textContent = `注入长内容第 ${i} 行：${"超长释义与例句填充文本 ".repeat(40)}`;
        region.appendChild(p);
      }
    });
    const after = await measureCard(page);
    // 内容超长：进入面内滚动、卡片高度不变、页面仍一屏内
    expect(after.regionScrollHeight).toBeGreaterThan(after.regionClientHeight);
    expectWithinPx(after.cardHeight, before.cardHeight, 1);
    expect(after.docScrollHeight).toBeLessThanOrEqual(after.innerHeight + 1);
    expect(after.ratingVisible).toBe(true);

    // 滚到底部：评分提示底栏不随内容滚动，固定在卡片底部
    await page.evaluate(() => {
      const region = document.querySelector(
        'button[aria-expanded] [aria-hidden="false"] .overflow-y-auto',
      );
      if (!region) {
        throw new Error("未找到背面滚动区");
      }
      region.scrollTop = region.scrollHeight;
    });
    const pinned = await page.evaluate(() => {
      const face = document.querySelector(
        'button[aria-expanded] [aria-hidden="false"]',
      ) as HTMLElement;
      const region = face.querySelector(".overflow-y-auto") as HTMLElement;
      // RAY-362：文案“按 1-3 评分”已删除，保留 key icon（svg）；底栏为 span[aria-hidden="true"] 且移动端 hidden（<768px）
      const hint =
        (face.querySelector('span[aria-hidden="true"]') as HTMLElement | null) ??
        ([...face.querySelectorAll("span")].find((el) => el.textContent?.includes("评分")) as
          HTMLElement | undefined) ??
        (face.lastElementChild as HTMLElement);
      if (!hint) {
        return false;
      }
      // 移动端按 RAY-362 隐藏按键指示（hidden md:flex），此时 display:none，pinned 语义不适用，视为通过
      const hintDisplay = getComputedStyle(hint).display;
      if (hintDisplay === "none") {
        return region.scrollTop > 0;
      }
      const faceRect = face.getBoundingClientRect();
      const hintRect = hint.getBoundingClientRect();
      return (
        region.scrollTop > 0 &&
        hintRect.bottom <= faceRect.bottom + 1 &&
        hintRect.bottom > faceRect.bottom - 60
      );
    });
    expect(pinned).toBe(true);
  });

  test("深色模式（跟随系统）：卡片面使用深色 design token", async ({ page }) => {
    await openLearnAndWaitCard(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    const faceBg = await page.evaluate(() => {
      const face = document.querySelector(
        'button[aria-expanded] [aria-hidden="false"]',
      ) as HTMLElement;
      return getComputedStyle(face).backgroundColor;
    });
    // 深色 --lex-surface = #1c1917 = rgb(28, 25, 23)；浅色 #ffffff 不会误判
    expect(faceBg).toBe("rgb(28, 25, 23)");
  });
});
