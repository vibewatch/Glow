import { isWithinChina, nearestCity } from "@/lib/cities";
import { getSpaceWeather, unavailableSpaceWeather } from "@/lib/space-weather";
import type { City, ForecastResponse, SpaceWeatherResponse } from "@/lib/types";
import { getForecast } from "@/lib/weather";

interface LoadOptions {
  signal?: AbortSignal;
  force?: boolean;
}

const forecastCache = new Map<string, ForecastResponse>();
const MAX_LOCATIONS = 20;
const FORECAST_FRESH_MS = 10 * 60_000;
let spaceWeatherCache: SpaceWeatherResponse | null = null;

export function coordinateCity(latitude: number, longitude: number): City {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("坐标格式无效，请同时提供有效的纬度和经度");
  }
  if (!isWithinChina(latitude, longitude)) {
    throw new Error("当前版本仅支持中国天气区域内的坐标");
  }
  const nearest = nearestCity(latitude, longitude);
  return {
    ...nearest,
    id: `coordinate-${latitude.toFixed(5)}-${longitude.toFixed(5)}`,
    name: "地图落点",
    province: `距${nearest.name}最近`,
    latitude,
    longitude,
  };
}

export async function forecastForLocation(city: City, options: LoadOptions = {}): Promise<ForecastResponse> {
  options.signal?.throwIfAborted();
  if (!isWithinChina(city.latitude, city.longitude)) {
    throw new Error("当前版本仅支持中国天气区域内的坐标");
  }
  const key = JSON.stringify(city);
  const cached = forecastCache.get(key);
  const now = Date.now();
  const chinaDate = new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
  if (!options.force && cached && now - Date.parse(cached.generatedAt) < FORECAST_FRESH_MS && cached.days[0]?.date === chinaDate) {
    return cached;
  }
  try {
    const forecast = await getForecast(city, options);
    options.signal?.throwIfAborted();
    forecastCache.delete(key);
    if (forecastCache.size >= MAX_LOCATIONS) {
      const oldest = forecastCache.keys().next().value;
      if (oldest !== undefined) forecastCache.delete(oldest);
    }
    forecastCache.set(key, forecast);
    return forecast;
  } catch (error) {
    options.signal?.throwIfAborted();
    console.error("Forecast request failed", error);
    throw new Error("天气数据暂时不可用，请稍后再试");
  }
}

export async function spaceWeatherForecast(options: LoadOptions = {}): Promise<SpaceWeatherResponse> {
  options.signal?.throwIfAborted();
  const now = Date.now();
  if (!options.force && spaceWeatherCache) {
    const freshMs = spaceWeatherCache.status === "available" ? 15 * 60_000 : 2 * 60_000;
    if (now - Date.parse(spaceWeatherCache.generatedAt) < freshMs
      && (spaceWeatherCache.status === "unavailable" || (spaceWeatherCache.validUntil && Date.parse(spaceWeatherCache.validUntil) >= now))) {
      return spaceWeatherCache;
    }
  }
  try {
    const forecast = await getSpaceWeather(options);
    options.signal?.throwIfAborted();
    spaceWeatherCache = forecast;
  } catch (error) {
    options.signal?.throwIfAborted();
    console.error("Space weather request failed", error);
    spaceWeatherCache = unavailableSpaceWeather();
  }
  return spaceWeatherCache;
}
