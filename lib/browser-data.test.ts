import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CITIES } from "./cities";
import { unavailableSpaceWeather } from "./space-weather";

const { forecastMock, spaceMock } = vi.hoisted(() => ({ forecastMock: vi.fn(), spaceMock: vi.fn() }));
vi.mock("./weather", () => ({ getForecast: forecastMock }));
vi.mock("./space-weather", async (original) => ({
  ...await original<typeof import("./space-weather")>(),
  getSpaceWeather: spaceMock,
}));

let browser: typeof import("./browser-data");

function forecast(city = CITIES[0]) {
  return {
    location: city,
    generatedAt: new Date().toISOString(),
    days: [{ date: new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10) }],
  };
}

describe("backend-free data boundary", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T04:00:00Z"));
    forecastMock.mockReset().mockImplementation(async (city) => forecast(city));
    spaceMock.mockReset();
    browser = await import("./browser-data");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("validates coordinates before requesting any provider", () => {
    for (const [lat, lon] of [[NaN, 120], [30, Infinity], [37.5665, 126.978]]) {
      expect(() => browser.coordinateCity(lat, lon)).toThrow();
    }
    expect(browser.coordinateCity(31.23, 121.47)).toEqual(expect.objectContaining({
      name: "地图落点", latitude: 31.23, longitude: 121.47, province: "距上海最近",
    }));
    expect(forecastMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported locations and cancelled requests before fetching", async () => {
    await expect(browser.forecastForLocation({ ...CITIES[0], latitude: 37.5665, longitude: 126.978 })).rejects.toThrow("仅支持中国");
    const controller = new AbortController();
    controller.abort();
    await expect(browser.forecastForLocation(CITIES[0], { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(forecastMock).not.toHaveBeenCalled();
  });

  it("reuses fresh locations, expires after ten minutes and bypasses cache on refresh", async () => {
    await browser.forecastForLocation(CITIES[0]);
    await browser.forecastForLocation(CITIES[0]);
    expect(forecastMock).toHaveBeenCalledTimes(1);
    await browser.forecastForLocation(CITIES[0], { force: true });
    expect(forecastMock).toHaveBeenCalledTimes(2);
    expect(forecastMock).toHaveBeenLastCalledWith(CITIES[0], { force: true });
    vi.advanceTimersByTime(10 * 60_000);
    await browser.forecastForLocation(CITIES[0]);
    expect(forecastMock).toHaveBeenCalledTimes(3);
  });

  it("refreshes at China midnight even if the cached response is still young", async () => {
    vi.setSystemTime(new Date("2026-10-10T15:59:00Z"));
    await browser.forecastForLocation(CITIES[0]);
    vi.advanceTimersByTime(2 * 60_000);
    await browser.forecastForLocation(CITIES[0]);
    expect(forecastMock).toHaveBeenCalledTimes(2);
  });

  it("bounds the cache to twenty locations and keeps exact coordinates distinct", async () => {
    for (const city of CITIES.slice(0, 21)) await browser.forecastForLocation(city);
    await browser.forecastForLocation(CITIES[0]);
    expect(forecastMock).toHaveBeenCalledTimes(22);
    await browser.forecastForLocation(browser.coordinateCity(31.23001, 121.47001));
    await browser.forecastForLocation(browser.coordinateCity(31.23002, 121.47002));
    expect(forecastMock).toHaveBeenCalledTimes(24);
  });

  it("logs and sanitizes upstream failures without returning stale data as fresh", async () => {
    const logging = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await browser.forecastForLocation(CITIES[0]);
    forecastMock.mockRejectedValueOnce(new Error("provider-internal-detail"));
    await expect(browser.forecastForLocation(CITIES[0], { force: true })).rejects.toThrow("天气数据暂时不可用");
    expect(logging).toHaveBeenCalledOnce();
  });

  it("never caches cancelled results or logs cancellation as a failure", async () => {
    const logging = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const controller = new AbortController();
    let resolve!: (value: ReturnType<typeof forecast>) => void;
    forecastMock.mockImplementationOnce(() => new Promise<ReturnType<typeof forecast>>((done) => { resolve = done; }));
    const result = browser.forecastForLocation(CITIES[0], { signal: controller.signal });
    controller.abort();
    resolve(forecast(CITIES[0]));
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    await browser.forecastForLocation(CITIES[0]);
    expect(forecastMock).toHaveBeenCalledTimes(2);
    expect(logging).not.toHaveBeenCalled();
  });

  it("caches NOAA independently and returns an explicit unavailable result on an outage", async () => {
    const logging = vi.spyOn(console, "error").mockImplementation(() => undefined);
    spaceMock.mockResolvedValue({
      ...unavailableSpaceWeather(), status: "available",
      validUntil: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await browser.spaceWeatherForecast();
    await browser.spaceWeatherForecast();
    expect(spaceMock).toHaveBeenCalledTimes(1);
    spaceMock.mockRejectedValue(new Error("NOAA outage"));
    const unavailable = await browser.spaceWeatherForecast({ force: true });
    expect(unavailable).toEqual(expect.objectContaining({ status: "unavailable", points: [], source: { name: "NOAA SWPC", url: expect.any(String) } }));
    await browser.spaceWeatherForecast();
    expect(spaceMock).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(2 * 60_000);
    await browser.spaceWeatherForecast();
    expect(spaceMock).toHaveBeenCalledTimes(3);
    await expect(browser.forecastForLocation(CITIES[0])).resolves.toEqual(expect.objectContaining({ location: CITIES[0] }));
    expect(logging).toHaveBeenCalledTimes(2);
  });

  it("expires NOAA after fifteen minutes or at the end of its valid horizon", async () => {
    spaceMock.mockImplementation(async () => ({
      ...unavailableSpaceWeather(), status: "available",
      validUntil: new Date(Date.now() + 2 * 3_600_000).toISOString(),
    }));
    await browser.spaceWeatherForecast();
    vi.advanceTimersByTime(15 * 60_000);
    await browser.spaceWeatherForecast();
    expect(spaceMock).toHaveBeenCalledTimes(2);
    spaceMock.mockImplementation(async () => ({
      ...unavailableSpaceWeather(), status: "available",
      validUntil: new Date(Date.now() + 60_000).toISOString(),
    }));
    await browser.spaceWeatherForecast({ force: true });
    vi.advanceTimersByTime(60_001);
    await browser.spaceWeatherForecast();
    expect(spaceMock).toHaveBeenCalledTimes(4);
  });

  it("does not cache a cancelled NOAA result as unavailable", async () => {
    const logging = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const controller = new AbortController();
    let resolve!: (value: ReturnType<typeof unavailableSpaceWeather>) => void;
    spaceMock.mockImplementationOnce(() => new Promise<ReturnType<typeof unavailableSpaceWeather>>((done) => { resolve = done; }));
    const result = browser.spaceWeatherForecast({ signal: controller.signal });
    controller.abort();
    resolve(unavailableSpaceWeather());
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    spaceMock.mockResolvedValue(unavailableSpaceWeather());
    await browser.spaceWeatherForecast();
    expect(spaceMock).toHaveBeenCalledTimes(2);
    expect(logging).not.toHaveBeenCalled();
  });
});
