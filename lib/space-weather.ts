import type { SpaceWeatherKpPoint, SpaceWeatherResponse } from "@/lib/types";

export const NOAA_KP_URL = "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json";

type SpaceWeatherFetcher = (url: URL) => Promise<unknown>;

interface SpaceWeatherOptions {
  fetcher?: SpaceWeatherFetcher;
  now?: Date;
  signal?: AbortSignal;
  force?: boolean;
}

function asStatus(value: unknown): SpaceWeatherKpPoint["status"] {
  return value === "observed" || value === "estimated" ? value : "predicted";
}

export function parseKpForecast(value: unknown): SpaceWeatherKpPoint[] {
  if (!Array.isArray(value) || !value.length) return [];
  if (typeof value[0] === "object" && value[0] !== null && !Array.isArray(value[0])) {
    return value.flatMap((entry): SpaceWeatherKpPoint[] => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
      const row = entry as Record<string, unknown>;
      const time = String(row.time_tag ?? "");
      const kp = Number(row.kp);
      if (!Number.isFinite(new Date(time).getTime()) || !Number.isFinite(kp) || kp < 0 || kp > 9) return [];
      return [{
        time: new Date(time.endsWith("Z") ? time : `${time}Z`).toISOString(),
        kp,
        status: asStatus(row.observed),
        scale: row.noaa_scale ? String(row.noaa_scale) : null,
      }];
    }).sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  }
  if (value.length < 2 || !Array.isArray(value[0])) return [];
  const header = value[0].map((item) => String(item).toLowerCase());
  const timeIndex = header.indexOf("time_tag");
  const kpIndex = header.indexOf("kp");
  const observedIndex = header.indexOf("observed");
  const scaleIndex = header.indexOf("noaa_scale");
  if (timeIndex < 0 || kpIndex < 0) return [];
  return value.slice(1).flatMap((row): SpaceWeatherKpPoint[] => {
    if (!Array.isArray(row)) return [];
    const time = String(row[timeIndex] ?? "");
    const kp = Number(row[kpIndex]);
    if (!Number.isFinite(new Date(time).getTime()) || !Number.isFinite(kp) || kp < 0 || kp > 9) return [];
    return [{
      time: new Date(time.endsWith("Z") ? time : `${time}Z`).toISOString(),
      kp,
      status: asStatus(row[observedIndex]),
      scale: scaleIndex >= 0 && row[scaleIndex] ? String(row[scaleIndex]) : null,
    }];
  }).sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

async function fetchNoaa(url: URL, options: SpaceWeatherOptions): Promise<unknown> {
  let failure: unknown = new Error("Space weather provider unavailable");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    options.signal?.throwIfAborted();
    try {
      const response = await fetch(url, {
        cache: options.force ? "no-store" : "default",
        signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
      });
      if (response.ok) return response.json() as Promise<unknown>;
      failure = new Error(`Space weather provider returned ${response.status}`);
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      options.signal?.throwIfAborted();
      failure = error;
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw failure;
}

export async function getSpaceWeather(options: SpaceWeatherOptions = {}): Promise<SpaceWeatherResponse> {
  const now = options.now ?? new Date();
  options.signal?.throwIfAborted();
  const fetcher = options.fetcher ?? ((url: URL) => fetchNoaa(url, options));
  const points = parseKpForecast(await fetcher(new URL(NOAA_KP_URL)));
  options.signal?.throwIfAborted();
  if (!points.length) throw new Error("NOAA SWPC returned an invalid Kp forecast");
  return {
    status: "available",
    generatedAt: now.toISOString(),
    validUntil: points.at(-1)?.time ?? null,
    source: { name: "NOAA SWPC", url: NOAA_KP_URL },
    points,
    message: "Kp 是全球地磁活动指导，不等同于具体地点一定可见极光。",
  };
}

export function unavailableSpaceWeather(now = new Date()): SpaceWeatherResponse {
  return {
    status: "unavailable",
    generatedAt: now.toISOString(),
    validUntil: null,
    source: { name: "NOAA SWPC", url: NOAA_KP_URL },
    points: [],
    message: "空间天气源暂时不可用，极光机会不作评分。",
  };
}
