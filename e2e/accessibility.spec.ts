import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function expectAccessible(page: Page, state: string) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, `${state}: ${results.violations.map((item) => `${item.id} (${item.nodes.length})`).join(", ")}`).toEqual([]);
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`all three workspaces meet automated accessibility checks on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "每日拍摄机会" })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "跳到摄影工作区" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#workspace")).toBeFocused();
    await expectAccessible(page, `${viewport.name} opportunities`);

    await page.getByTitle("专业天气", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "天气工作台" })).toBeVisible();
    for (const detail of ["云层", "降雨", "风况"]) {
      await page.getByRole("tab", { name: detail }).click();
      await expectAccessible(page, `${viewport.name} weather ${detail}`);
    }

    await page.getByTitle("罕见天象", { exact: true }).click();
    await expect(page.getByRole("heading", { name: "天象事件" })).toBeVisible();
    await expectAccessible(page, `${viewport.name} events`);

    await page.getByLabel("搜索中国城市").click();
    await expect(page.getByRole("listbox", { name: "城市搜索结果" })).toBeVisible();
    await expectAccessible(page, `${viewport.name} city search`);
  });
}

test("initial failure state meets automated accessibility checks", async ({ page }) => {
  await page.route("https://*.open-meteo.com/**", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: "审计模拟：天气源暂时不可用" }),
  }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "数据暂时不可用" })).toBeVisible();
  await expectAccessible(page, "initial provider failure");
});

test("not-found route is actionable and accessible", async ({ page }) => {
  const response = await page.goto("/missing-photography-route");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "没有找到这个页面" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回摄影工作区" })).toHaveAttribute("href", "/");
  await expectAccessible(page, "not found");
});
