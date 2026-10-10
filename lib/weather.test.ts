import { afterEach, describe, expect, it, vi } from "vitest";
import { CITIES } from "./cities";
import { getForecast } from "./weather";

const start = new Date("2026-08-03T00:00:00Z");
const hourlyTime = Array.from({ length: 168 }, (_, index) => new Date(start.getTime() + index * 3_600_000).toISOString().slice(0, 16));
const dailyTime = Array.from({ length: 7 }, (_, index) => new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10));
const values = (value: number) => hourlyTime.map(() => value);

function forecastFixture(offset = 0) {
  return {
    elevation: 47,
    hourly: {
      time: hourlyTime,
      temperature_2m: values(20 + offset),
      dew_point_2m: values(12),
      cloud_cover: values(45 + offset),
      cloud_cover_low: values(10 + offset),
      cloud_cover_mid: values(40),
      cloud_cover_high: values(55),
      relative_humidity_2m: values(60),
      visibility: values(30_000),
      precipitation_probability: values(5),
      precipitation: values(0),
      rain: values(0),
      showers: values(0),
      weather_code: values(1),
      direct_radiation: values(180),
      wind_speed_10m: values(9),
      wind_gusts_10m: values(16),
      wind_direction_10m: values(315),
      surface_pressure: values(1002),
    },
    daily: {
      time: dailyTime,
      sunrise: dailyTime.map((date) => `${date}T05:20`),
      sunset: dailyTime.map((date) => `${date}T19:20`),
    },
  };
}

function pathFixture(url: URL, bank = 0) {
  const count = url.searchParams.get("latitude")!.split(",").length;
  return Array.from({ length: count }, () => ({
    hourly: { time: hourlyTime, cloud_cover_low: values(bank), cloud_cover_mid: values(Math.max(10, bank)), cloud_cover_high: values(20) },
  }));
}

const isPath = (url: URL) => url.searchParams.get("latitude")!.includes(",");

const airFixture = {
  hourly: {
    time: hourlyTime,
    aerosol_optical_depth: values(.2),
    pm2_5: values(18),
  },
};

describe("forecast subsystem degradation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses only public, keyless endpoints in the browser build", async () => {
    const urls: URL[] = [];
    const response = await getForecast(CITIES[0], {
      now: start,
      fetcher: async (url) => {
        urls.push(url);
        return url.hostname.startsWith("air-quality") ? airFixture : isPath(url) ? pathFixture(url) : forecastFixture();
      },
    });
    expect(new Set(urls.map((url) => url.hostname))).toEqual(new Set(["api.open-meteo.com", "air-quality-api.open-meteo.com"]));
    expect(urls.every((url) => !url.searchParams.has("apikey"))).toBe(true);
    expect(response.provenance.access).toBe("open-access");
  });

  it("builds the complete seven-day contract from deterministic provider data", async () => {
    const response = await getForecast(CITIES[0], {
      now: new Date("2026-08-03T00:00:00Z"),
      fetcher: async (url: URL) => url.hostname.startsWith("air-quality") ? airFixture : isPath(url) ? pathFixture(url) : forecastFixture(url.searchParams.get("models") === "cma_grapes_global" ? 4 : 0),
    });
    expect(response.generatedAt).toBe("2026-08-03T00:00:00.000Z");
    expect(response.days).toHaveLength(7);
    expect(response.hourly).toHaveLength(168);
    expect(response.days[0].dawn.modelScores).toHaveLength(4);
    expect(response.days[0].weather.cloud.modelScores).toHaveLength(4);
    expect(response.days[0].weather.rain.score).not.toBeNull();
    expect(response.days[0].weather.rain.score!).toBeGreaterThanOrEqual(0);
    expect(response.hourly[0].solarAzimuth).toBeGreaterThanOrEqual(0);
    expect(response.provenance).toEqual(expect.objectContaining({ delivery: "Open-Meteo", warningAuthority: false }));
    expect(response.sources.every((source) => source.status === "available")).toBe(true);
    const dusk = response.days[0].dusk;
    expect(dusk.lightPath.status).toBe("available");
    expect(dusk.lightPath.samples.map((sample) => sample.distanceKm)).toEqual([40, 120, 220, 350]);
    expect(dusk.lightPath.azimuth).toBeGreaterThan(270);
    expect(dusk.timeline.length).toBeGreaterThan(30);
    expect(new Date(dusk.window.start).getTime()).toBeLessThanOrEqual(new Date(dusk.time).getTime());
    expect(new Date(dusk.window.end).getTime()).toBeGreaterThanOrEqual(new Date(dusk.time).getTime());
    // Beijing sunset 2026-08-03 ≈ 19:26 CST; a constant sky peaks within minutes after it, not at a fixed offset.
    const minutesAfterSunset = (new Date(dusk.time).getTime() - new Date(response.days[0].solar.sunsetAt!).getTime()) / 60_000;
    expect(minutesAfterSunset).toBeGreaterThan(3);
    expect(minutesAfterSunset).toBeLessThan(25);
    expect(response.days[0].sunset).toMatch(/^2026-08-03T19:2[5-7]$/);
  });

  it("scores a distant cloud bank toward the sunset below an open light path", async () => {
    const run = (cloud: number) => getForecast(CITIES[0], {
      now: new Date("2026-08-03T00:00:00Z"),
      fetcher: async (url: URL) => url.hostname.startsWith("air-quality") ? airFixture : isPath(url) ? pathFixture(url, cloud) : forecastFixture(),
    });
    const [open, blocked] = await Promise.all([run(0), run(95)]);
    expect(blocked.days[0].dusk.probability).toBeLessThan(open.days[0].dusk.probability - 10);
    expect(blocked.days[0].dusk.contributions.find((item) => item.name === "远方光路")?.value).toBeLessThan(-5);
    // Distant low cloud blocks the ray only after sunset, so the blocked peak moves earlier.
    expect(new Date(blocked.days[0].dusk.time).getTime()).toBeLessThanOrEqual(new Date(open.days[0].dusk.time).getTime());
    expect(blocked.days[0].dusk.summary).toContain("日落方向");
  });

  it("drops a model from hours past its published horizon instead of averaging a neutral guess", async () => {
    const response = await getForecast(CITIES[0], {
      now: new Date("2026-08-03T00:00:00Z"),
      fetcher: async (url: URL) => {
        if (url.hostname.startsWith("air-quality")) return airFixture;
        if (isPath(url)) return pathFixture(url);
        const model = url.searchParams.get("models");
        if (model !== "ecmwf_ifs" && model !== "cma_grapes_global") throw new Error("simulated outage");
        const fixture = forecastFixture(model === "cma_grapes_global" ? 40 : 0);
        if (model === "cma_grapes_global") {
          for (const key of Object.keys(fixture.hourly) as (keyof typeof fixture.hourly)[]) {
            if (key !== "time") (fixture.hourly[key] as (number | null)[]) = (fixture.hourly[key] as number[]).map((value, index) => index >= 122 ? null : value);
          }
        }
        return fixture;
      },
    });
    expect(response.days[1].dusk.modelScores.map((item) => item.model)).toEqual(["ECMWF IFS", "CMA GRAPES"]);
    expect(response.days[6].dusk.modelScores.map((item) => item.model)).toEqual(["ECMWF IFS"]);
    expect(response.days[6].fog.modelScores.map((item) => item.model)).toEqual(["ECMWF IFS"]);
    expect(response.days[6].night.modelScores.map((item) => item.model)).toEqual(["ECMWF IFS"]);
  });

  it("keeps fog in the night-to-morning window and times rainbows at the middle of the rain hour", async () => {
    const response = await getForecast(CITIES[0], {
      now: new Date("2026-08-03T00:00:00Z"),
      fetcher: async (url: URL) => url.hostname.startsWith("air-quality") ? airFixture : isPath(url) ? pathFixture(url) : forecastFixture(),
    });
    for (const day of response.days) {
      expect(new Date(`${day.fog.time}:00+08:00`).getTime()).toBeLessThanOrEqual(new Date(`${day.sunrise}:00+08:00`).getTime() + 3 * 3_600_000);
    }
    const hour = response.hourly.find((point) => point.time === "2026-08-03T18:00")!;
    const rainbowHour = response.days[0].weather.rainbow;
    expect(rainbowHour.metrics.solarAltitude).not.toBe(hour.solarAltitude);
  });

  it("continues with one weather model when its peers and CAMS are unavailable", async () => {
    const response = await getForecast(CITIES[0], {
      now: new Date("2026-08-03T00:00:00Z"),
      fetcher: async (url: URL) => {
        if (url.hostname.startsWith("air-quality") || url.searchParams.get("models") !== "cma_grapes_global" || isPath(url)) throw new Error("simulated outage");
        return forecastFixture(3);
      },
    });
    expect(response.days[0].dawn.modelScores).toHaveLength(1);
    expect(response.days[0].weather.cloud.modelScores).toHaveLength(1);
    expect(response.sources.map((source) => source.status)).toEqual(["unavailable", "available", "unavailable", "unavailable", "unavailable", "unavailable"]);
    expect(response.days[0].dusk.lightPath).toEqual(expect.objectContaining({ status: "unavailable", samples: [] }));
    expect(response.days[0].dusk.contributions.some((item) => item.name === "远方光路")).toBe(false);
    expect(response.days).toHaveLength(7);
  });

  it("uses the containing hourly precipitation interval when choosing a glow window", async () => {
    const changing = forecastFixture();
    changing.hourly.precipitation_probability = values(0);
    changing.hourly.precipitation = values(0);
    changing.hourly.precipitation_probability[6] = 100;
    changing.hourly.precipitation[6] = 5;
    const response = await getForecast(CITIES[0], {
      now: new Date("2026-08-03T00:00:00Z"),
      fetcher: async (url: URL) => url.hostname.startsWith("air-quality") ? airFixture : changing,
    });
    expect(new Date(response.days[0].dawn.time).getTime()).toBeLessThan(new Date("2026-08-02T21:20:00Z").getTime());
    expect(response.days[0].dawn.metrics.precipitationProbability).toBe(0);
  });

  it("rejects malformed success payloads instead of crashing later in the model", async () => {
    await expect(getForecast(CITIES[0], {
      now: new Date("2026-08-03T00:00:00Z"),
      fetcher: async () => ({ hourly: { time: [] }, daily: {} }),
    })).rejects.toThrow("当前天气源暂时不可用");
  });

  it("retries each transient provider failure once within the bounded adapter", async () => {
    const attempts = new Map<string, number>();
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => {
      const url = input.toString();
      const count = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, count);
      if (count === 1) return new Response("temporary", { status: 503 });
      const parsed = new URL(url);
      const payload = url.includes("air-quality-api") ? airFixture : isPath(parsed) ? pathFixture(parsed) : forecastFixture();
      return Response.json(payload);
    }));

    const response = await getForecast(CITIES[0], { now: new Date("2026-08-03T00:00:00Z") });
    expect(response.days).toHaveLength(7);
    // Four models, four light-path requests and CAMS, each retried exactly once.
    expect([...attempts.values()]).toEqual(Array(9).fill(2));
    expect(response.days[0].dusk.lightPath.status).toBe("available");
  });

  it("uses browser fetch options and bypasses HTTP caching on explicit refresh", async () => {
    const fetch = vi.fn(async (input: URL | RequestInfo, options?: RequestInit) => {
      expect(options).toEqual({ cache: "no-store", signal: expect.any(AbortSignal) });
      const url = new URL(input.toString());
      return Response.json(url.hostname.startsWith("air-quality") ? airFixture : isPath(url) ? pathFixture(url) : forecastFixture());
    });
    vi.stubGlobal("fetch", fetch);
    await getForecast(CITIES[0], { now: start, force: true });
    expect(fetch).toHaveBeenCalledTimes(9);
  });

  it("cancels every provider request without retrying or replacing cancellation with an outage", async () => {
    const controller = new AbortController();
    const fetch = vi.fn((_input: URL | RequestInfo, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetch);
    const result = getForecast(CITIES[0], { now: start, signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(9);
  });
});
