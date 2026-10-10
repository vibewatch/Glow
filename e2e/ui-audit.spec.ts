import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const viewports = [
  { name: "phone-short-320", width: 320, height: 568 },
  { name: "phone-320", width: 320, height: 720 },
  { name: "phone-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "laptop-short-1024", width: 1024, height: 600 },
  { name: "laptop-1024", width: 1024, height: 768 },
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "wide-1920", width: 1920, height: 1080 },
] as const;

const auditRoot = path.join(process.cwd(), "test-results", "ui-audit");

test.beforeAll(async () => {
  await rm(auditRoot, { recursive: true, force: true });
});

async function capture(page: Page, viewport: string, state: string) {
  const directory = path.join(auditRoot, viewport);
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.mouse.move(1, 1);
  await page.waitForTimeout(60);
  await page.screenshot({ path: path.join(directory, `${state}.png`), fullPage: true });
}

async function expectHealthyLayout(page: Page) {
  const diagnostics = await page.evaluate(() => {
    const root = document.documentElement;
    const typographyTargets = [
      [".workspace-search input", 13],
      [".workspace-navigation button strong", 11],
      [".date-tabs button span", 9],
      [".scene-title h1", 18],
      [".opportunity-copy strong", 10],
      [".selected-opportunity > p:not(.method-inline)", 11],
      [".weather-detail > p", 10],
      [".event-detail > p", 9],
      [".source-disclosure small", 10],
    ] as const;
    const duplicateIds = [...document.querySelectorAll<HTMLElement>("[id]")]
      .map((element) => element.id)
      .filter((id, index, ids) => ids.indexOf(id) !== index);
    const unnamedControls = [...document.querySelectorAll<HTMLElement>("button, a, input, summary")]
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const visible = style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
        const name = element.getAttribute("aria-label") || element.getAttribute("title") || element.textContent || (element as HTMLInputElement).placeholder;
        return visible && !name?.trim();
      })
      .map((element) => element.outerHTML.slice(0, 160));
    const clippedRegions = [".workspace-header", ".workspace-body", ".map-stage", ".inspector", ".planner-timeline"]
      .flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)])
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -1 || rect.right > root.clientWidth + 1;
      })
      .map((element) => ({ className: element.className, rect: element.getBoundingClientRect().toJSON() }));
    const undersizedCriticalText = typographyTargets.flatMap(([selector, minimum]) =>
      [...document.querySelectorAll<HTMLElement>(selector)]
        .filter((element) => element.getClientRects().length > 0 && Number.parseFloat(window.getComputedStyle(element).fontSize) < minimum)
        .map((element) => ({ selector, minimum, actual: window.getComputedStyle(element).fontSize, text: element.textContent?.trim().slice(0, 40) })),
    );
    return { horizontalOverflow: root.scrollWidth - root.clientWidth, duplicateIds, unnamedControls, clippedRegions, undersizedCriticalText };
  });
  expect(diagnostics).toEqual({ horizontalOverflow: expect.any(Number), duplicateIds: [], unnamedControls: [], clippedRegions: [], undersizedCriticalText: [] });
  expect(diagnostics.horizontalOverflow).toBeLessThanOrEqual(1);
}

for (const viewport of viewports) {
  test(`three-workspace visual and interaction audit at ${viewport.name}`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("[data-map-ready=true]")).toBeVisible();
    await expect(page.getByRole("heading", { name: "每日拍摄机会" })).toBeVisible();
    await expect(page.locator(".opportunity-list > button")).toHaveCount(9);
    await expectHealthyLayout(page);
    await capture(page, viewport.name, "01-opportunities");

    await page.locator(".opportunity-list > button").filter({ hasText: "彩虹" }).click();
    await expect(page.locator(".selected-opportunity")).toContainText("彩虹");
    await capture(page, viewport.name, "02-rainbow-selected");

    await page.getByLabel("搜索中国城市").click();
    await expect(page.getByRole("listbox", { name: "城市搜索结果" })).toBeVisible();
    await capture(page, viewport.name, "03-search-open");
    await page.getByLabel("搜索中国城市").press("Escape");

    await page.getByTitle("专业天气", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "天气工作台" })).toBeVisible();
    await expectHealthyLayout(page);
    await capture(page, viewport.name, "04-weather-cloud");
    await page.getByRole("tab", { name: "降雨" }).click();
    await capture(page, viewport.name, "05-weather-rain");
    await page.getByRole("tab", { name: "风况" }).click();
    await capture(page, viewport.name, "06-weather-wind");

    await page.getByTitle("罕见天象", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "天象事件" })).toBeVisible();
    await expect(page.locator(".rare-event-list > button")).toHaveCount(10);
    await expectHealthyLayout(page);
    await capture(page, viewport.name, "07-events");
    await page.locator(".rare-event-list > button").filter({ hasText: "流星雨" }).first().click();
    await capture(page, viewport.name, "08-meteor-shower");
    await page.locator(".rare-event-list > button").filter({ hasText: "日食" }).first().click();
    await expect(page.getByText("严禁用肉眼", { exact: false })).toBeVisible();
    await capture(page, viewport.name, "09-solar-eclipse");

    await page.getByText("数据、模型与边界", { exact: true }).click();
    await expect(page.getByText("Astronomy Engine", { exact: true })).toBeVisible();
    await expectHealthyLayout(page);
    await capture(page, viewport.name, "10-sources-open");
    expect(pageErrors).toEqual([]);
  });
}

test("initial error state reconnects without clipping", async ({ page }) => {
  let failForecast = true;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("https://*.open-meteo.com/**", async (route) => {
    if (!failForecast) return route.fallback();
    return route.fulfill({ status: 503, json: { error: "审计模拟：首次连接失败" } });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "数据暂时不可用" })).toBeVisible();
  await capture(page, "phone-390", "11-initial-error");
  failForecast = false;
  await page.getByRole("button", { name: "重新连接" }).click();
  await expect(page.getByRole("heading", { name: "每日拍摄机会" })).toBeVisible();
  await expectHealthyLayout(page);
});

test("denied geolocation remains recoverable and dismissible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (_success: PositionCallback, failure?: PositionErrorCallback) => failure?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }) },
    });
  });
  await page.goto("/");
  await page.getByLabel("定位我的位置").click();
  await expect(page.locator(".workspace-toast")).toContainText("无法获取位置");
  await capture(page, "phone-390", "12-geolocation-denied");
  await page.getByLabel("关闭错误提示").click();
  await expect(page.locator(".workspace-toast")).toBeHidden();
});
