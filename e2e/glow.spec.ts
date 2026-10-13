import { expect, test } from "./fixtures";

test("static app fetches providers directly and degrades NOAA independently", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.route("https://services.swpc.noaa.gov/**", (route) => route.abort());
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "每日拍摄机会" })).toBeVisible();
  await expect(page.locator(".header-health")).toHaveAttribute("data-state", "healthy");
  await expect(page.getByRole("tablist", { name: "七天机会日期" }).getByRole("tab")).toHaveCount(7);
  await page.locator(".opportunity-list > button").filter({ hasText: "极光" }).click();
  await expect(page.locator(".selected-opportunity")).toContainText("暂无可靠预测");
  const weatherRequests = requests.filter((url) => url.includes("open-meteo.com"));
  expect(weatherRequests).toHaveLength(9);
  expect(weatherRequests.every((url) => !new URL(url).searchParams.has("apikey"))).toBe(true);
  expect(requests.some((url) => url.includes("/api/"))).toBe(false);
  await page.getByTitle("罕见天象", { exact: true }).click();
  await expect(page.locator(".rare-event-list > button")).toHaveCount(10);
});

test("daily agenda exposes every opportunity and links panel, time node, and selected map direction", async ({ page }) => {
  let forecastRequests = 0;
  page.on("request", (request) => { if (request.url().includes("open-meteo.com")) forecastRequests += 1; });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "每日拍摄机会" })).toBeVisible();
  await expect(page.locator(".opportunity-list > button")).toHaveCount(9);
  for (const name of ["朝霞", "日出与晨间金色时段", "雾景", "彩虹", "日落与傍晚蓝调", "晚霞", "月亮", "星空", "极光"]) {
    await expect(page.locator(".opportunity-list").getByText(name, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("低分机会不会被隐藏", { exact: false })).toBeVisible();
  const baselineRequests = forecastRequests;

  const dawn = page.locator(".opportunity-list > button").filter({ hasText: "朝霞" });
  await dawn.click();
  await expect(dawn).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".selected-opportunity")).toContainText("朝霞");
  await expect(page.locator(".map-direction-legend")).toContainText("朝霞光路");

  const rainbowNode = page.locator(".opportunity-node[aria-label^='彩虹']");
  await rainbowNode.click();
  await expect(page.locator(".selected-opportunity")).toContainText("单点网格不知道雨幕");
  const rainbowDirection = page.locator(".selected-opportunity").getByText("地图方向");
  if (await rainbowDirection.count()) {
    await expect(page.locator(".map-direction-legend")).toContainText("建议观虹方向");
  } else {
    await expect(page.locator(".selected-opportunity")).toContainText("观测方位—");
    await expect(page.locator(".map-direction-legend")).toHaveCount(0);
  }
  await expect(page.locator(".clock-cursor")).toBeVisible();

  const dayTabs = page.getByRole("tablist", { name: "七天机会日期" }).getByRole("tab");
  await expect(dayTabs).toHaveCount(7);
  await dayTabs.nth(2).click();
  await expect(dayTabs.nth(2)).toHaveAttribute("aria-selected", "true");
  expect(forecastRequests).toBe(baselineRequests);
  await expect(page).toHaveURL(/\/$/);
});

test("weather workspace follows a familiar hourly cloud, rain, and wind workflow without refetching", async ({ page }) => {
  let forecastRequests = 0;
  page.on("request", (request) => { if (request.url().includes("open-meteo.com")) forecastRequests += 1; });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "每日拍摄机会" })).toBeVisible();
  const baselineRequests = forecastRequests;
  await page.getByTitle("专业天气", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "天气工作台" })).toBeVisible();
  await expect(page.getByLabel("云雨风概览").getByRole("button")).toHaveCount(3);
  const hours = page.getByRole("listbox", { name: /逐小时天气/ }).getByRole("option");
  await expect(hours).toHaveCount(24);
  await hours.nth(18).click();
  await expect(hours.nth(18)).toHaveAttribute("aria-selected", "true");
  await hours.nth(18).press("ArrowDown");
  await expect(hours.nth(19)).toHaveAttribute("aria-selected", "true");
  await expect(hours.nth(19)).toBeFocused();

  await page.getByRole("tab", { name: "降雨" }).click();
  await expect(page.getByLabel("降雨详情")).toContainText("概率与实际量级分开显示");
  await page.getByRole("tab", { name: "风况" }).click();
  await expect(page.getByLabel("风况详情")).toContainText("阵风超过约 30 km/h");
  await expect(page.locator(".map-direction-legend")).toContainText("来风");
  await page.getByRole("tab", { name: "云层" }).click();
  await expect(page.getByLabel("云层详情")).toContainText("低云更容易遮住地平线");
  await expect(page.getByText("不会伪造全国云图", { exact: false })).toBeVisible();
  expect(forecastRequests).toBe(baselineRequests);
});

test("celestial calendar separates long-range geometry from seven-day weather", async ({ page }) => {
  await page.goto("/");
  await page.getByTitle("罕见天象", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "天象事件" })).toBeVisible();
  await expect(page.locator(".rare-event-list > button")).toHaveCount(10);
  await expect(page.getByText("远期看几何，临近再看天气", { exact: true })).toBeVisible();

  const shower = page.locator(".rare-event-list > button").filter({ hasText: "流星雨" }).first();
  await shower.click();
  await expect(page.locator(".event-detail")).toContainText("理想天顶流量");
  await expect(page.locator(".event-detail")).toContainText("峰值夜辐射点高度");
  await expect(page.locator(".event-detail")).toContainText("月面照明");

  const solar = page.locator(".rare-event-list > button").filter({ hasText: "日食" }).first();
  await solar.click();
  await expect(page.getByText("严禁用肉眼", { exact: false })).toBeVisible();
  await expect(page.getByText("天气只在进入七天预报窗口后显示", { exact: false })).toBeVisible();
});

test("search, refresh, map click, drag, and rejected picks preserve the shared location", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("[data-map-ready=true]")).toBeVisible();
  await page.getByLabel("搜索中国城市").fill("上海");
  await page.getByRole("option", { name: /上海/ }).click();
  await expect(page.locator(".coordinate-hud")).toContainText("上海");

  const refreshed = page.waitForResponse((response) => response.url().includes("api.open-meteo.com") && new URL(response.url()).searchParams.get("latitude") === "31.2304");
  await page.getByRole("button", { name: "刷新当前预测" }).click();
  await refreshed;
  await expect(page.getByRole("button", { name: "刷新当前预测" })).toBeEnabled();

  const map = await page.locator(".weather-map").boundingBox();
  expect(map).not.toBeNull();
  await page.mouse.click(map!.x + map!.width * .35, map!.y + map!.height * .42);
  await expect(page.locator(".coordinate-hud")).toContainText("地图落点", { timeout: 30_000 });
  const beforeDrag = await page.locator(".coordinate-hud").innerText();
  const marker = await page.locator(".map-pin-marker").boundingBox();
  expect(marker).not.toBeNull();
  await page.mouse.move(marker!.x + marker!.width / 2, marker!.y + marker!.height / 2);
  await page.mouse.down();
  await page.mouse.move(marker!.x + marker!.width / 2 + 45, marker!.y + marker!.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => page.locator(".coordinate-hud").innerText(), { timeout: 30_000 }).not.toBe(beforeDrag);
  expect(errors).toEqual([]);
});

test("mobile keeps three workspaces, map timeline, and panels free of horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("[data-map-ready=true]")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "工作区" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "每日拍摄机会" })).toBeVisible();
  await expect(page.locator(".map-stage")).toHaveCSS("height", "380px");
  for (const workspace of ["专业天气", "罕见天象", "每日拍摄机会"]) {
    await page.getByTitle(workspace, { exact: true }).click();
    await expect(page.locator(".photo-workspace")).toHaveAttribute("data-workspace", workspace === "专业天气" ? "weather" : workspace === "罕见天象" ? "events" : "opportunities");
  }
  await page.getByRole("button", { name: "EN" }).click();
  await expect(page.getByRole("heading", { name: "Daily opportunities" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspaces" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByTitle("Weather", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Weather workspace" })).toBeVisible();
  await page.getByRole("tab", { name: "Rain" }).click();
  await expect(page.getByLabel("Rain details")).toContainText("Probability and amount are shown separately");
  await page.getByTitle("Celestial events", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Celestial events" })).toBeVisible();
  await expect(page.getByText("Use geometry for long range, weather when near", { exact: true })).toBeVisible();
  await page.getByTitle("Daily opportunities", { exact: true }).click();
  const englishOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(englishOverflow).toBeLessThanOrEqual(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Daily opportunities" })).toBeVisible();
  await page.getByRole("button", { name: "CN" }).click();
  await expect(page.getByRole("heading", { name: "每日拍摄机会" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
