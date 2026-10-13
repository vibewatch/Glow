import { createHash } from "node:crypto";
import { expect, test } from "./fixtures";

test("static export uses hash CSP and rejects untrusted inline scripts", async ({ page }) => {
  const response = await page.goto("/");
  expect(response).not.toBeNull();
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("script-src-attr 'none'");
  expect(policy).toContain("object-src 'none'");
  const scriptPolicy = policy?.split("; ").find((directive) => directive.startsWith("script-src "));
  expect(scriptPolicy).toBeTruthy();
  expect(scriptPolicy).toContain("https://www.googletagmanager.com");
  expect(scriptPolicy).not.toContain("'unsafe-inline'");
  expect(policy).not.toContain("'unsafe-eval'");
  expect(policy).not.toContain("'nonce-");
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "strict-origin-when-cross-origin");

  const serverHtml = await response!.text();
  expect(serverHtml).toContain("G-6W7F2188X6");
  const inlineScripts = [...serverHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter((match) => !/\bsrc\s*=/.test(match[1]) && match[2]);
  expect(inlineScripts.length).toBeGreaterThan(0);
  for (const script of inlineScripts) {
    const hash = createHash("sha256").update(script[2]).digest("base64");
    expect(policy).toContain(`'sha256-${hash}'`);
  }
  expect(serverHtml.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(serverHtml.indexOf("<script"));
  await expect(page.getByRole("heading", { name: "每日拍摄机会" })).toBeVisible();

  for (const kind of ["handler", "script"]) {
    const violation = await page.evaluate((kind) => new Promise<string>((resolve) => {
      document.addEventListener("securitypolicyviolation", (event) => resolve(event.violatedDirective), { once: true });
      if (kind === "handler") {
        const button = document.createElement("button");
        button.setAttribute("onclick", "window.__untrustedInlineExecuted = true");
        document.body.append(button);
        button.click();
        button.remove();
      } else {
        const script = document.createElement("script");
        script.textContent = "window.__untrustedInlineExecuted = true";
        document.head.append(script);
        script.remove();
      }
      window.setTimeout(() => resolve("missing"), 1000);
    }), kind);
    expect(violation).toContain("script-src");
    expect(await page.evaluate(() => (window as Window & { __untrustedInlineExecuted?: boolean }).__untrustedInlineExecuted ?? false)).toBe(false);
  }
});

test("static hosting has no backend routes and rejects unsupported locations before fetching", async ({ page, request }) => {
  for (const route of ["/api/health", "/api/forecast?city=beijing", "/api/space-weather"]) {
    expect((await request.get(route)).status()).toBe(404);
  }
  let weatherRequests = 0;
  page.on("request", (request) => { if (request.url().includes("open-meteo.com")) weatherRequests += 1; });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (success: PositionCallback) => success({
        coords: { latitude: 37.5665, longitude: 126.978, accuracy: 1, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON() { return {}; } },
        timestamp: Date.now(),
        toJSON() { return {}; },
      }) },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "每日拍摄机会" })).toBeVisible();
  const baselineRequests = weatherRequests;
  await page.getByLabel("定位我的位置").click();
  await expect(page.locator(".workspace-toast")).toContainText("仅支持中国天气区域内的坐标");
  await expect(page.locator(".coordinate-hud")).toContainText("北京");
  expect(weatherRequests).toBe(baselineRequests);
});
