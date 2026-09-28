import { averageMetrics, confidenceFromScores, probabilityLevel, scoreGlow } from "@/lib/glow-model";
import { chinaMinute, getAstronomy, getMoonGeometry, getMoonPosition, getSolarAltitude, getSolarPosition, getSolarWindow, getSunRiseSet, solarAltitudeCrossing } from "@/lib/astronomy";
import { fogLevel, fogSummary, scoreFog, scoreMoon, scoreNightscape } from "@/lib/photography-models";
import { buildWeatherAnalysis, type WeatherHourCandidate } from "@/lib/weather-analysis";
import type { City, DayForecast, EventForecast, EventKind, FogForecast, FogMetrics, ForecastResponse, ForecastWindow, HourlyWeatherPoint, LightPathSample, MoonForecast, NightForecast, NightWeatherMetrics, ScoreResult, SkyMetrics, SolarWindow, WeatherAnalysisMetrics } from "@/lib/types";

interface OpenMeteoForecast {
  elevation?: number;
  hourly: Record<string, (string | number | null)[]> & { time: string[] };
  daily: { time: string[]; sunrise: string[]; sunset: string[] };
}

interface OpenMeteoAir {
  hourly: Record<string, (string | number | null)[]> & { time: string[] };
}

type OpenMeteoPathPoint = OpenMeteoAir;

interface LightPathData {
  dawn: { azimuth: number; points: OpenMeteoPathPoint[] };
  dusk: { azimuth: number; points: OpenMeteoPathPoint[] };
}

interface ModelRun {
  config: ModelConfig;
  data: OpenMeteoForecast;
  path: LightPathData | null;
}

interface ModelConfig {
  id: string;
  name: string;
  role: string;
}

type ForecastFetcher = (url: URL) => Promise<unknown>;

interface ForecastOptions {
  fetcher?: ForecastFetcher;
  now?: Date;
}

const MODELS: ModelConfig[] = [
  { id: "ecmwf_ifs", name: "ECMWF IFS", role: "ECMWF IFS HRES 9 km 开放数据，全球大尺度云雨结构基准，并提供能见度" },
  { id: "cma_grapes_global", name: "CMA GRAPES", role: "中国气象局 15 km 全球模式，提供独立区域判断" },
  { id: "gfs_global", name: "NOAA GFS", role: "美国 NCEP 全球模式，提供独立于欧洲中心的全球判断" },
  { id: "icon_global", name: "DWD ICON", role: "德国气象局全球模式，补充第三个独立预报中心视角" },
];

const OPEN_METEO_API_KEY = process.env.OPEN_METEO_API_KEY?.trim() || null;
export function openMeteoEndpoints(apiKey: string | null) {
  return apiKey
    ? {
        forecast: "https://customer-api.open-meteo.com/v1/forecast",
        air: "https://customer-air-quality-api.open-meteo.com/v1/air-quality",
        access: "customer" as const,
      }
    : {
        forecast: "https://api.open-meteo.com/v1/forecast",
        air: "https://air-quality-api.open-meteo.com/v1/air-quality",
        access: "open-access" as const,
      };
}
const OPEN_METEO_ENDPOINTS = openMeteoEndpoints(OPEN_METEO_API_KEY);
const FORECAST_URL = OPEN_METEO_ENDPOINTS.forecast;
const AIR_URL = OPEN_METEO_ENDPOINTS.air;
const HOURLY_FIELD_KEYS = [
  "temperature_2m",
  "dew_point_2m",
  "cloud_cover",
  "cloud_cover_low",
  "cloud_cover_mid",
  "cloud_cover_high",
  "relative_humidity_2m",
  "visibility",
  "precipitation_probability",
  "precipitation",
  "rain",
  "showers",
  "weather_code",
  "direct_radiation",
  "wind_speed_10m",
  "wind_gusts_10m",
  "wind_direction_10m",
  "surface_pressure",
] as const;
const HOURLY_FIELDS = HOURLY_FIELD_KEYS.join(",");
const PATH_FIELD_KEYS = ["cloud_cover_low", "cloud_cover_mid", "cloud_cover_high"] as const;
/** Distances toward the sun where the ray feeding local mid/high cloud passes through low, mid and high decks. */
export const LIGHT_PATH_DISTANCES_KM = [40, 120, 220, 350] as const;
const GLOW_STEP_MINUTES = 2;
const NIGHT_STEP_MINUTES = 20;
const timeIndexCache = new WeakMap<object, Map<string, number>>();
const parsedTimeCache = new WeakMap<string[], number[]>();
const weekdayFormatter = new Intl.DateTimeFormat("zh-CN", { weekday: "short", timeZone: "Asia/Shanghai" });
const shortDateFormatter = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", timeZone: "Asia/Shanghai" });

function asNumber(value: string | number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function average(values: (number | null)[]): number | null {
  const valid = values.filter((value): value is number => value !== null);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function circularAverage(values: (number | null)[]): number | null {
  const valid = values.filter((value): value is number => value !== null);
  if (!valid.length) return null;
  const x = valid.reduce((sum, value) => sum + Math.cos(value * Math.PI / 180), 0);
  const y = valid.reduce((sum, value) => sum + Math.sin(value * Math.PI / 180), 0);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function forecastInstant(value: string) {
  return new Date(value.endsWith("Z") ? value : `${value}:00+08:00`);
}

function parsedTimes(times: string[]) {
  let parsed = parsedTimeCache.get(times);
  if (!parsed) {
    parsed = times.map((time) => forecastInstant(time).getTime());
    parsedTimeCache.set(times, parsed);
  }
  return parsed;
}

function interpolationPosition(times: string[], target: Date) {
  const parsed = parsedTimes(times);
  const targetTime = target.getTime();
  if (!parsed.length || targetTime <= parsed[0]) return { lower: 0, upper: 0, fraction: 0 };
  if (targetTime >= parsed[parsed.length - 1]) return { lower: parsed.length - 1, upper: parsed.length - 1, fraction: 0 };
  let low = 0;
  let high = parsed.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (parsed[middle] <= targetTime) low = middle;
    else high = middle;
  }
  if (parsed[low] === targetTime) return { lower: low, upper: low, fraction: 0 };
  return { lower: low, upper: high, fraction: (targetTime - parsed[low]) / (parsed[high] - parsed[low]) };
}

/** Whether an instant is covered by the hourly series; nothing outside it is extrapolated. */
function withinSeries(times: string[], target: Date) {
  const parsed = parsedTimes(times);
  return parsed.length > 0 && target.getTime() >= parsed[0] && target.getTime() <= parsed[parsed.length - 1];
}

function interpolatedValue(data: Record<string, (string | number | null)[]>, key: string, position: ReturnType<typeof interpolationPosition>) {
  const lower = asNumber(data[key]?.[position.lower]);
  const upper = asNumber(data[key]?.[position.upper]);
  if (lower === null) return upper;
  if (upper === null || position.lower === position.upper) return lower;
  return lower + (upper - lower) * position.fraction;
}

function intervalValue(data: Record<string, (string | number | null)[]>, key: string, position: ReturnType<typeof interpolationPosition>) {
  const index = position.fraction > 0 ? position.upper : position.lower;
  return asNumber(data[key]?.[index]);
}

function timeIndex(data: OpenMeteoForecast | OpenMeteoAir, time: string) {
  let indices = timeIndexCache.get(data);
  if (!indices) {
    indices = new Map(data.hourly.time.map((value, index) => [value, index]));
    timeIndexCache.set(data, indices);
  }
  return indices.get(time) ?? -1;
}

function airMetricsAtInstant(air: OpenMeteoAir | null, target: Date) {
  if (!air) return { aerosolOpticalDepth: null, pm25: null };
  const position = interpolationPosition(air.hourly.time, target);
  return {
    aerosolOpticalDepth: interpolatedValue(air.hourly, "aerosol_optical_depth", position),
    pm25: interpolatedValue(air.hourly, "pm2_5", position),
  };
}

function glowMetricsAt(model: OpenMeteoForecast, air: OpenMeteoAir | null, target: Date): SkyMetrics {
  const position = interpolationPosition(model.hourly.time, target);
  const airMetrics = airMetricsAtInstant(air, target);
  return {
    lowCloud: interpolatedValue(model.hourly, "cloud_cover_low", position),
    midCloud: interpolatedValue(model.hourly, "cloud_cover_mid", position),
    highCloud: interpolatedValue(model.hourly, "cloud_cover_high", position),
    humidity: interpolatedValue(model.hourly, "relative_humidity_2m", position),
    visibility: interpolatedValue(model.hourly, "visibility", position),
    precipitationProbability: intervalValue(model.hourly, "precipitation_probability", position),
    precipitation: intervalValue(model.hourly, "precipitation", position),
    ...airMetrics,
  };
}

function scanTimes(from: Date, to: Date, stepMinutes: number) {
  const step = stepMinutes * 60_000;
  const first = Math.ceil(from.getTime() / step) * step;
  const times: Date[] = [];
  for (let time = first; time <= to.getTime(); time += step) times.push(new Date(time));
  return times;
}

/** Twilight scan bounds: sun from +8° down to −7° at dusk (reverse at dawn), which spans every lit-cloud phase. */
function glowScanTimes(city: City, date: string, kind: EventKind, fallback: string) {
  const bright = solarAltitudeCrossing(city, date, kind === "dawn" ? 1 : -1, 8);
  const dark = solarAltitudeCrossing(city, date, kind === "dawn" ? 1 : -1, -7);
  const anchor = forecastInstant(fallback).getTime();
  const from = kind === "dawn" ? dark ?? new Date(anchor - 50 * 60_000) : bright ?? new Date(anchor - 45 * 60_000);
  const to = kind === "dawn" ? bright ?? new Date(anchor + 45 * 60_000) : dark ?? new Date(anchor + 50 * 60_000);
  return scanTimes(from, to, GLOW_STEP_MINUTES);
}

function pathSamplesAt(path: LightPathData | null, kind: EventKind, target: Date): LightPathSample[] | null {
  if (!path) return null;
  const points = path[kind].points;
  const samples = points.map((point, index): LightPathSample => {
    if (!withinSeries(point.hourly.time, target)) return { distanceKm: LIGHT_PATH_DISTANCES_KM[index], lowCloud: null, midCloud: null, highCloud: null };
    const position = interpolationPosition(point.hourly.time, target);
    return {
      distanceKm: LIGHT_PATH_DISTANCES_KM[index],
      lowCloud: interpolatedValue(point.hourly, "cloud_cover_low", position),
      midCloud: interpolatedValue(point.hourly, "cloud_cover_mid", position),
      highCloud: interpolatedValue(point.hourly, "cloud_cover_high", position),
    };
  });
  return samples.some((sample) => sample.lowCloud !== null || sample.midCloud !== null || sample.highCloud !== null) ? samples : null;
}

function averagePathSamples(paths: (LightPathSample[] | null)[]): LightPathSample[] {
  const known = paths.filter((path): path is LightPathSample[] => path !== null);
  return LIGHT_PATH_DISTANCES_KM.map((distanceKm, index) => ({
    distanceKm,
    lowCloud: average(known.map((path) => path[index]?.lowCloud ?? null)),
    midCloud: average(known.map((path) => path[index]?.midCloud ?? null)),
    highCloud: average(known.map((path) => path[index]?.highCloud ?? null)),
  }));
}

/** Expands around the peak while the index stays within `tolerance` points of it. */
function windowAround<T>(items: T[], peakIndex: number, value: (item: T) => number, time: (item: T) => string, tolerance: number, stepMinutes: number): ForecastWindow {
  const threshold = value(items[peakIndex]) - tolerance;
  let start = peakIndex;
  let end = peakIndex;
  while (start > 0 && value(items[start - 1]) >= threshold) start -= 1;
  while (end < items.length - 1 && value(items[end + 1]) >= threshold) end += 1;
  const half = stepMinutes * 30_000;
  return {
    start: new Date(forecastInstant(time(items[start])).getTime() - (start === end ? half : 0)).toISOString(),
    end: new Date(forecastInstant(time(items[end])).getTime() + (start === end ? half : 0)).toISOString(),
  };
}

function peakIndex<T>(items: T[], value: (item: T) => number) {
  return items.reduce((best, item, index) => value(item) > value(items[best]) ? index : best, 0);
}

function meanProbability(scores: { score: ScoreResult }[]) {
  return Math.round(scores.reduce((sum, item) => sum + item.score.probability, 0) / scores.length);
}

const hasAny = (...values: (number | null)[]) => values.some((value) => value !== null);

function fogMetricsAt(model: OpenMeteoForecast, time: string): FogMetrics {
  const index = timeIndex(model, time);
  return {
    temperature: asNumber(model.hourly.temperature_2m?.[index]),
    dewPoint: asNumber(model.hourly.dew_point_2m?.[index]),
    humidity: asNumber(model.hourly.relative_humidity_2m?.[index]),
    lowCloud: asNumber(model.hourly.cloud_cover_low?.[index]),
    visibility: asNumber(model.hourly.visibility?.[index]),
    windSpeed: asNumber(model.hourly.wind_speed_10m?.[index]),
    precipitation: asNumber(model.hourly.precipitation?.[index]),
  };
}

function averageFogMetrics(items: FogMetrics[]): FogMetrics {
  const value = (key: keyof FogMetrics) => average(items.map((item) => item[key]));
  return {
    temperature: value("temperature"),
    dewPoint: value("dewPoint"),
    humidity: value("humidity"),
    lowCloud: value("lowCloud"),
    visibility: value("visibility"),
    windSpeed: value("windSpeed"),
    precipitation: value("precipitation"),
  };
}

function nightMetricsAt(model: OpenMeteoForecast, target: Date): NightWeatherMetrics {
  const position = interpolationPosition(model.hourly.time, target);
  const nearest = position.fraction >= 0.5 ? position.upper : position.lower;
  const value = (key: string) => interpolatedValue(model.hourly, key, position);
  return {
    temperature: value("temperature_2m"),
    dewPoint: value("dew_point_2m"),
    humidity: value("relative_humidity_2m"),
    lowCloud: value("cloud_cover_low"),
    midCloud: value("cloud_cover_mid"),
    highCloud: value("cloud_cover_high"),
    visibility: value("visibility"),
    precipitationProbability: intervalValue(model.hourly, "precipitation_probability", position),
    precipitation: intervalValue(model.hourly, "precipitation", position),
    windSpeed: value("wind_speed_10m"),
    windGusts: value("wind_gusts_10m"),
    windDirection: asNumber(model.hourly.wind_direction_10m?.[nearest]),
  };
}

function averageNightMetrics(items: NightWeatherMetrics[]): NightWeatherMetrics {
  const value = (key: Exclude<keyof NightWeatherMetrics, "windDirection">) => average(items.map((item) => item[key]));
  return {
    temperature: value("temperature"),
    dewPoint: value("dewPoint"),
    humidity: value("humidity"),
    lowCloud: value("lowCloud"),
    midCloud: value("midCloud"),
    highCloud: value("highCloud"),
    visibility: value("visibility"),
    precipitationProbability: value("precipitationProbability"),
    precipitation: value("precipitation"),
    windSpeed: value("windSpeed"),
    windGusts: value("windGusts"),
    windDirection: circularAverage(items.map((item) => item.windDirection)),
  };
}

function weatherAnalysisMetricsAt(city: City, model: OpenMeteoForecast, time: string): WeatherAnalysisMetrics {
  const index = timeIndex(model, time);
  // Precipitation and radiation are totals/means over the preceding hour, so the sun is evaluated mid-interval.
  const solar = getSolarPosition(city, new Date(forecastInstant(time).getTime() - 30 * 60_000));
  return {
    totalCloud: asNumber(model.hourly.cloud_cover?.[index]),
    lowCloud: asNumber(model.hourly.cloud_cover_low?.[index]),
    midCloud: asNumber(model.hourly.cloud_cover_mid?.[index]),
    highCloud: asNumber(model.hourly.cloud_cover_high?.[index]),
    precipitationProbability: asNumber(model.hourly.precipitation_probability?.[index]),
    precipitation: asNumber(model.hourly.precipitation?.[index]),
    rain: asNumber(model.hourly.rain?.[index]),
    showers: asNumber(model.hourly.showers?.[index]),
    directRadiation: asNumber(model.hourly.direct_radiation?.[index]),
    solarAltitude: solar.altitude,
    solarAzimuth: solar.azimuth,
    weatherCode: asNumber(model.hourly.weather_code?.[index]),
  };
}

function buildDailyWeatherAnalysis(
  city: City,
  date: string,
  leadDays: number,
  available: ModelRun[],
) {
  const times = available[0].data.hourly.time.filter((time) => time.startsWith(date));
  const candidates: WeatherHourCandidate[] = times.map((time) => ({
    time,
    models: available.map(({ config, data }) => ({
      model: config.name,
      metrics: weatherAnalysisMetricsAt(city, data, time),
    })),
  }));
  return buildWeatherAnalysis(candidates, leadDays);
}

/** Sunset to next sunrise, clipped to the forecast series so nothing past the last hour is extrapolated. */
function nightScanTimes(reference: OpenMeteoForecast, sunset: string, nextSunrise: string | null) {
  const start = forecastInstant(sunset);
  const end = nextSunrise ? forecastInstant(nextSunrise) : new Date(start.getTime() + 11 * 60 * 60 * 1000);
  const last = parsedTimes(reference.hourly.time).at(-1) ?? end.getTime();
  const times = scanTimes(start, new Date(Math.min(end.getTime(), last)), NIGHT_STEP_MINUTES);
  return times.length ? times : [new Date(Math.min(start.getTime(), last))];
}

interface ScoredCandidate {
  time: string;
  byModel: { config: ModelConfig; metrics: NightWeatherMetrics; score: ScoreResult }[];
  metrics: NightWeatherMetrics;
  combined: ScoreResult;
  probability: number;
  moonAltitude?: number;
}

/**
 * Scores each model that actually has data at `at`. A model whose horizon has
 * ended (CMA GRAPES stops publishing after ~5 days) is left out rather than
 * contributing a neutral-pulled guess; if none has data, all are kept so the
 * missing-input discount stays visible in completeness.
 */
function modelsWithData<T>(available: ModelRun[], metricsFor: (run: ModelRun) => T, usable: (metrics: T) => boolean) {
  const all = available.map((run) => ({ run, metrics: metricsFor(run) }));
  const usableModels = all.filter((item) => usable(item.metrics));
  return usableModels.length ? usableModels : all;
}

const nightUsable = (metrics: NightWeatherMetrics) => hasAny(metrics.lowCloud, metrics.midCloud, metrics.highCloud);

function buildMoonForecast(
  city: City,
  date: string,
  leadDays: number,
  times: Date[],
  available: ModelRun[],
): MoonForecast {
  const candidates = times.map((at): ScoredCandidate => {
    const position = getMoonPosition(city, at);
    const byModel = modelsWithData(available, ({ data }) => nightMetricsAt(data, at), nightUsable)
      .map(({ run, metrics }) => ({ config: run.config, metrics, score: scoreMoon(metrics, position) }));
    const metrics = averageNightMetrics(byModel.map((item) => item.metrics));
    return {
      time: at.toISOString(),
      byModel,
      metrics,
      combined: scoreMoon(metrics, position),
      probability: meanProbability(byModel),
      moonAltitude: position.altitude,
    };
  });
  const visibleCandidates = candidates.filter((candidate) => (candidate.moonAltitude ?? -90) > 0);
  const pool = visibleCandidates.length ? visibleCandidates : candidates;
  const bestIndex = peakIndex(pool, (item) => item.probability);
  const best = pool[bestIndex];
  const geometry = getMoonGeometry(city, forecastInstant(best.time), date);
  const summary = geometry.altitude < 0
    ? "天气预报时效内月面仍在地平线下；月升后的云风条件暂无数据"
    : best.probability >= 76
      ? "月面高度与天气配合，适合安排长焦或带景拍摄"
      : best.probability >= 50
        ? "存在可拍窗口，云量和阵风仍需临场复核"
        : "云层、降水或月面高度暂不利于稳定拍摄";
  const fullIndex = candidates.indexOf(best);
  return {
    ...geometry,
    time: best.time,
    window: windowAround(candidates, fullIndex, (item) => !visibleCandidates.length || (item.moonAltitude ?? -90) > 0 ? item.probability : -1, (item) => item.time, 6, NIGHT_STEP_MINUTES),
    probability: best.probability,
    confidence: confidenceFromScores(best.byModel.map((item) => item.score), leadDays),
    level: probabilityLevel(best.probability),
    summary,
    weather: best.metrics,
    contributions: best.combined.contributions,
    modelScores: best.byModel.map(({ config, score }) => ({ model: config.name, probability: score.probability })),
  };
}

function buildNightForecast(
  city: City,
  date: string,
  leadDays: number,
  times: Date[],
  solar: SolarWindow,
  available: ModelRun[],
): NightForecast {
  const candidates = times.map((at): ScoredCandidate => {
    const moon = getMoonPosition(city, at);
    const sunAltitude = getSolarAltitude(city, at);
    const astronomy = { sunAltitude, moonAltitude: moon.altitude, moonIllumination: moon.illumination };
    const byModel = modelsWithData(available, ({ data }) => nightMetricsAt(data, at), nightUsable)
      .map(({ run, metrics }) => ({ config: run.config, metrics, score: scoreNightscape(metrics, astronomy) }));
    const metrics = averageNightMetrics(byModel.map((item) => item.metrics));
    return {
      time: at.toISOString(),
      byModel,
      metrics,
      combined: scoreNightscape(metrics, astronomy),
      probability: meanProbability(byModel),
    };
  });
  const bestIndex = peakIndex(candidates, (item) => item.probability);
  const best = candidates[bestIndex];
  const at = forecastInstant(best.time);
  const moon = getMoonGeometry(city, at, date);
  const sunAltitude = getSolarAltitude(city, at);
  const summary = solar.astronomicalDarknessMinutes === 0
    ? "该日期没有完整天文黑夜，深空与银河背景会受到暮光影响"
    : best.probability >= 76
      ? "黑夜、云量和月光条件配合，适合进入踩点与构图阶段"
      : best.probability >= 50
        ? "有可用黑夜窗口，需重点复核月光、结露与阵风"
        : "云量、月光、暮光或地面湿风风险暂不理想";
  return {
    time: best.time,
    window: windowAround(candidates, bestIndex, (item) => item.probability, (item) => item.time, 6, NIGHT_STEP_MINUTES),
    astronomicalDusk: solar.eveningAstronomicalStart,
    astronomicalDawn: solar.morningAstronomicalEnd,
    darknessMinutes: solar.astronomicalDarknessMinutes,
    sunAltitude,
    probability: best.probability,
    confidence: confidenceFromScores(best.byModel.map((item) => item.score), leadDays),
    level: probabilityLevel(best.probability),
    summary,
    moon,
    weather: best.metrics,
    contributions: best.combined.contributions,
    modelScores: best.byModel.map(({ config, score }) => ({ model: config.name, probability: score.probability })),
  };
}

/**
 * Photogenic fog is a night-to-morning phenomenon (radiation fog forms under
 * nocturnal cooling and burns off after sunrise), so the search runs from local
 * midnight to three hours after sunrise instead of across the afternoon.
 */
function buildFogForecast(date: string, sunrise: string, leadDays: number, available: ModelRun[]): FogForecast {
  const limit = forecastInstant(sunrise).getTime() + 3 * 60 * 60 * 1000;
  const dayTimes = available[0].data.hourly.time.filter((time) => time.startsWith(date));
  const morning = dayTimes.filter((time) => forecastInstant(time).getTime() <= limit);
  const times = morning.length ? morning : dayTimes;
  const candidates = times.map((time) => {
    const byModel = modelsWithData(available, ({ data }) => fogMetricsAt(data, time), (metrics) => hasAny(metrics.temperature, metrics.dewPoint, metrics.humidity))
      .map(({ run, metrics }) => ({ config: run.config, metrics, score: scoreFog(metrics) }));
    const metrics = averageFogMetrics(byModel.map((item) => item.metrics));
    return { time, byModel, metrics, combined: scoreFog(metrics), probability: meanProbability(byModel) };
  });
  const bestIndex = peakIndex(candidates, (item) => item.probability);
  const best = candidates[bestIndex];
  return {
    time: best.time,
    window: windowAround(candidates, bestIndex, (item) => item.probability, (item) => item.time, 6, 60),
    probability: best.probability,
    confidence: confidenceFromScores(best.byModel.map((item) => item.score), leadDays),
    level: fogLevel(best.probability),
    summary: fogSummary(best.probability, best.metrics),
    metrics: best.metrics,
    contributions: best.combined.contributions,
    modelScores: best.byModel.map(({ config, score }) => ({ model: config.name, probability: score.probability })),
  };
}

function buildHourly(city: City, available: ModelRun[], air: OpenMeteoAir | null): HourlyWeatherPoint[] {
  const reference = available[0].data;
  return reference.hourly.time.map((time) => {
    const indices = available.map(({ data }) => timeIndex(data, time));
    const modelValues = (key: string) => available.map(({ data }, modelIndex) => asNumber(data.hourly[key]?.[indices[modelIndex]]));
    const airIndex = air ? timeIndex(air, time) : -1;
    const solar = getSolarPosition(city, forecastInstant(time));
    return {
      time,
      temperature: average(modelValues("temperature_2m")),
      dewPoint: average(modelValues("dew_point_2m")),
      humidity: average(modelValues("relative_humidity_2m")),
      totalCloud: average(modelValues("cloud_cover")),
      lowCloud: average(modelValues("cloud_cover_low")),
      midCloud: average(modelValues("cloud_cover_mid")),
      highCloud: average(modelValues("cloud_cover_high")),
      visibility: average(modelValues("visibility")),
      precipitationProbability: average(modelValues("precipitation_probability")),
      precipitation: average(modelValues("precipitation")),
      windSpeed: average(modelValues("wind_speed_10m")),
      windGusts: average(modelValues("wind_gusts_10m")),
      windDirection: circularAverage(modelValues("wind_direction_10m")),
      pressure: average(modelValues("surface_pressure")),
      aerosolOpticalDepth: airIndex >= 0 ? asNumber(air?.hourly.aerosol_optical_depth?.[airIndex]) : null,
      rain: average(modelValues("rain")),
      showers: average(modelValues("showers")),
      weatherCode: modelValues("weather_code").find((value) => value !== null) ?? null,
      directRadiation: average(modelValues("direct_radiation")),
      solarAltitude: solar.altitude,
      solarAzimuth: solar.azimuth,
    };
  });
}

function eventSummary(kind: EventKind, probability: number, metrics: SkyMetrics, contributions: ScoreResult["contributions"]) {
  const label = kind === "dawn" ? "朝霞" : "晚霞";
  const toward = kind === "dawn" ? "日出" : "日落";
  const path = contributions.find((item) => item.name === "远方光路");
  if ((metrics.lowCloud ?? 0) > 70) return `本地低云可能遮住地平线，${label}展开空间有限`;
  if ((metrics.precipitationProbability ?? 0) > 60) return `降水信号偏强，建议临近时再看一次更新`;
  if (path && path.value <= -10) return `${toward}方向远处云层可能挡住阳光，本地云层难以被照亮`;
  if (probability >= 76) return `低云少、中高云可染色，${toward}方向光路基本畅通`;
  if (probability >= 58) return `云层结构不错，按峰值时刻前 10 分钟到位`;
  if (probability >= 38) return `仍有变化窗口，模式更新后可能上调`;
  return `关键条件暂不配合，适合把期待留给下一天`;
}

const glowUsable = (metrics: SkyMetrics) => hasAny(metrics.lowCloud, metrics.midCloud, metrics.highCloud);

function buildEvent(
  kind: EventKind,
  date: string,
  anchor: string,
  leadDays: number,
  city: City,
  available: ModelRun[],
  air: OpenMeteoAir | null,
): EventForecast {
  const candidates = glowScanTimes(city, date, kind, anchor).map((candidateTime) => {
    const solarAltitude = getSolarAltitude(city, candidateTime);
    const byModel = modelsWithData(available, ({ data }) => glowMetricsAt(data, air, candidateTime), glowUsable)
      .map(({ run, metrics }) => {
        const path = pathSamplesAt(run.path, kind, candidateTime);
        return { config: run.config, metrics, path, score: scoreGlow(metrics, kind, { solarAltitude, path }) };
      });
    return { candidateTime, solarAltitude, byModel, probability: meanProbability(byModel) };
  });
  const bestIndex = peakIndex(candidates, (candidate) => candidate.probability);
  const best = candidates[bestIndex];
  const metrics = averageMetrics(best.byModel.map(({ metrics: value }) => value));
  const pathKnown = best.byModel.some((item) => item.path !== null);
  const samples = averagePathSamples(best.byModel.map((item) => item.path));
  const combined = scoreGlow(metrics, kind, { solarAltitude: best.solarAltitude, path: pathKnown ? samples : null });
  const contributions = combined.contributions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const reference = available.find((run) => run.path)?.path;

  return {
    kind,
    time: best.candidateTime.toISOString(),
    window: windowAround(candidates, bestIndex, (item) => item.probability, (item) => item.candidateTime.toISOString(), Math.max(5, Math.round(best.probability * 0.1)), GLOW_STEP_MINUTES),
    solarAltitude: Math.round(best.solarAltitude * 100) / 100,
    timeline: candidates.map((item) => ({ time: item.candidateTime.toISOString(), probability: item.probability, solarAltitude: Math.round(item.solarAltitude * 100) / 100 })),
    lightPath: {
      status: pathKnown ? "available" : "unavailable",
      azimuth: reference?.[kind].azimuth ?? 0,
      samples: pathKnown ? samples : [],
    },
    probability: best.probability,
    confidence: confidenceFromScores(best.byModel.map(({ score }) => score), leadDays),
    level: probabilityLevel(best.probability),
    summary: eventSummary(kind, best.probability, metrics, contributions),
    metrics,
    contributions,
    modelScores: best.byModel.map(({ config, score }) => ({ model: config.name, probability: score.probability })),
  };
}

function formatDay(date: string) {
  const value = new Date(`${date}T12:00:00+08:00`);
  return {
    weekday: weekdayFormatter.format(value),
    shortDate: shortDateFormatter.format(value),
  };
}

async function fetchJson(url: URL): Promise<unknown> {
  let failure: unknown = new Error("Weather provider unavailable");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Jiguang-Sky-Forecast/0.1" },
        next: { revalidate: 1800 },
        signal: AbortSignal.timeout(6000),
      });
      if (response.ok) return response.json() as Promise<unknown>;
      failure = new Error(`Weather provider returned ${response.status}`);
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      failure = error;
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw failure;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validForecastPayload(value: unknown): value is OpenMeteoForecast {
  if (!isRecord(value) || !isRecord(value.hourly) || !isRecord(value.daily)) return false;
  const hourly = value.hourly;
  const daily = value.daily;
  const hourlyTime = hourly.time;
  const dailyTime = daily.time;
  const sunrise = daily.sunrise;
  const sunset = daily.sunset;
  return Array.isArray(hourlyTime) && hourlyTime.length >= 168
    && HOURLY_FIELD_KEYS.every((field) => Array.isArray(hourly[field]) && hourly[field].length >= hourlyTime.length)
    && Array.isArray(dailyTime) && dailyTime.length === 7
    && Array.isArray(sunrise) && sunrise.length === dailyTime.length
    && Array.isArray(sunset) && sunset.length === dailyTime.length;
}

function validAirPayload(value: unknown): value is OpenMeteoAir {
  if (!isRecord(value) || !isRecord(value.hourly)) return false;
  const hourly = value.hourly;
  const time = hourly.time;
  return Array.isArray(time)
    && time.length >= 168
    && ["aerosol_optical_depth", "pm2_5"].every((field) => Array.isArray(hourly[field]) && hourly[field].length >= time.length);
}

async function fetchModel(city: City, model: ModelConfig, fetcher: ForecastFetcher) {
  const url = new URL(FORECAST_URL);
  url.search = new URLSearchParams({
    latitude: city.latitude.toString(),
    longitude: city.longitude.toString(),
    hourly: HOURLY_FIELDS,
    daily: "sunrise,sunset",
    timezone: city.timezone,
    forecast_days: "7",
    models: model.id,
  }).toString();
  if (OPEN_METEO_API_KEY) url.searchParams.set("apikey", OPEN_METEO_API_KEY);
  const payload = await fetcher(url);
  if (!validForecastPayload(payload)) throw new Error("Weather provider returned an invalid forecast payload");
  return payload;
}

function validPathPayload(value: unknown, expected: number): value is OpenMeteoPathPoint[] {
  return Array.isArray(value) && value.length === expected && value.every((point) => isRecord(point)
    && isRecord(point.hourly)
    && Array.isArray(point.hourly.time)
    && point.hourly.time.length >= 168
    && PATH_FIELD_KEYS.every((field) => Array.isArray((point.hourly as Record<string, unknown>)[field])));
}

/** Great-circle destination from the observer along `azimuth` (degrees from north). */
export function destinationPoint(latitude: number, longitude: number, azimuth: number, distanceKm: number) {
  const radians = Math.PI / 180;
  const angular = distanceKm / 6371;
  const lat1 = latitude * radians;
  const bearing = azimuth * radians;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
  const lon2 = longitude * radians + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
  return { latitude: lat2 / radians, longitude: ((lon2 / radians + 540) % 360) - 180 };
}

/**
 * One multi-location request per model: layer cover at four points toward the
 * sunrise and four toward the sunset. Only three variables are requested to keep
 * the Open-Meteo call weight low. A failure leaves the light path unknown.
 */
async function fetchLightPath(city: City, model: ModelConfig, azimuths: { dawn: number; dusk: number }, fetcher: ForecastFetcher): Promise<LightPathData> {
  const points = (["dawn", "dusk"] as const).flatMap((kind) => LIGHT_PATH_DISTANCES_KM.map((distance) => destinationPoint(city.latitude, city.longitude, azimuths[kind], distance)));
  const url = new URL(FORECAST_URL);
  url.search = new URLSearchParams({
    latitude: points.map((point) => point.latitude.toFixed(3)).join(","),
    longitude: points.map((point) => point.longitude.toFixed(3)).join(","),
    hourly: PATH_FIELD_KEYS.join(","),
    timezone: city.timezone,
    forecast_days: "7",
    models: model.id,
  }).toString();
  if (OPEN_METEO_API_KEY) url.searchParams.set("apikey", OPEN_METEO_API_KEY);
  const payload = await fetcher(url);
  if (!validPathPayload(payload, points.length)) throw new Error("Weather provider returned an invalid light-path payload");
  const count = LIGHT_PATH_DISTANCES_KM.length;
  return {
    dawn: { azimuth: azimuths.dawn, points: payload.slice(0, count) },
    dusk: { azimuth: azimuths.dusk, points: payload.slice(count) },
  };
}

async function fetchAir(city: City, fetcher: ForecastFetcher) {
  const url = new URL(AIR_URL);
  url.search = new URLSearchParams({
    latitude: city.latitude.toString(),
    longitude: city.longitude.toString(),
    hourly: "aerosol_optical_depth,pm2_5",
    timezone: city.timezone,
    forecast_days: "7",
  }).toString();
  if (OPEN_METEO_API_KEY) url.searchParams.set("apikey", OPEN_METEO_API_KEY);
  const payload = await fetcher(url);
  if (!validAirPayload(payload)) throw new Error("Weather provider returned an invalid air-quality payload");
  return payload;
}

function recommendedDayIndex(days: DayForecast[], now: Date) {
  const nowInChina = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const index = days.findIndex((day) => day.sunset >= nowInChina);
  return index < 0 ? 0 : index;
}

function chinaDate(at: Date, offsetDays = 0) {
  return new Date(at.getTime() + 8 * 60 * 60 * 1000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

export async function getForecast(city: City, options: ForecastOptions = {}): Promise<ForecastResponse> {
  const fetcher = options.fetcher ?? fetchJson;
  const now = options.now ?? new Date();
  // Mid-week azimuths: they drift < 3° over seven days, well inside the model grid spacing at 40–350 km.
  const midWeek = getSunRiseSet(city, chinaDate(now, 3));
  const azimuths = { dawn: midWeek.sunriseAzimuth ?? 90, dusk: midWeek.sunsetAzimuth ?? 270 };
  const [modelResults, pathResults, airResult] = await Promise.all([
    Promise.allSettled(MODELS.map(async (config) => ({ config, data: await fetchModel(city, config, fetcher) }))),
    Promise.all(MODELS.map((config) => fetchLightPath(city, config, azimuths, fetcher).catch(() => null))),
    fetchAir(city, fetcher).catch(() => null),
  ]);
  const available: ModelRun[] = modelResults.flatMap((result, index) => result.status === "fulfilled" ? [{ ...result.value, path: pathResults[index] }] : []);
  if (!available.length) throw new Error("当前天气源暂时不可用，请稍后再试");

  const reference = available[0].data;
  const solarWindows = reference.daily.time.map((date) => getSolarWindow(city, date));
  const sunriseOf = (index: number) => solarWindows[index]?.sunriseAt ? chinaMinute(new Date(solarWindows[index].sunriseAt!)) : reference.daily.sunrise[index];
  const sunsetOf = (index: number) => solarWindows[index]?.sunsetAt ? chinaMinute(new Date(solarWindows[index].sunsetAt!)) : reference.daily.sunset[index];
  const days = reference.daily.time.map((date, index): DayForecast => {
    const sunrise = sunriseOf(index);
    const sunset = sunsetOf(index);
    const solar = solarWindows[index];
    const followingSunrise = index + 1 < solarWindows.length ? null : getSunRiseSet(city, chinaDate(forecastInstant(`${date}T12:00`), 1)).sunrise;
    const nextSunrise = index + 1 < solarWindows.length ? sunriseOf(index + 1) : followingSunrise && chinaMinute(followingSunrise);
    const nightTimes = nightScanTimes(reference, sunset, nextSunrise);
    return {
      date,
      ...formatDay(date),
      sunrise,
      sunset,
      dawn: buildEvent("dawn", date, sunrise, index, city, available, airResult),
      dusk: buildEvent("dusk", date, sunset, index, city, available, airResult),
      fog: buildFogForecast(date, sunrise, index, available),
      solar,
      moon: buildMoonForecast(city, date, index, nightTimes, available),
      night: buildNightForecast(city, date, index, nightTimes, solar, available),
      weather: buildDailyWeatherAnalysis(city, date, index, available),
    };
  });
  const pathAvailable = available.some((run) => run.path !== null);

  return {
    location: { ...city, elevation: reference.elevation ?? null },
    generatedAt: now.toISOString(),
    recommendedIndex: recommendedDayIndex(days, now),
    days,
    hourly: buildHourly(city, available, airResult),
    astronomy: getAstronomy(city, now),
    sources: [
      ...MODELS.map((model, index) => ({
        id: model.id,
        name: model.name,
        role: model.role,
        status: modelResults[index].status === "fulfilled" ? "available" as const : "unavailable" as const,
      })),
      {
        id: "cams_global",
        name: "CAMS 全球大气成分",
        role: "气溶胶光学厚度与 PM₂.₅，用于评估散射和霾",
        status: airResult ? "available" as const : "unavailable" as const,
      },
      {
        id: "light_path",
        name: "日出/日落方向光路采样",
        role: `沿日出 ${Math.round(azimuths.dawn)}°、日落 ${Math.round(azimuths.dusk)}° 方位 ${LIGHT_PATH_DISTANCES_KM.join("/")} km 取分层云量，判断阳光能否照到本地中高云`,
        status: pathAvailable ? "available" as const : "unavailable" as const,
      },
    ],
    provenance: {
      delivery: "Open-Meteo",
      access: OPEN_METEO_ENDPOINTS.access,
      license: "CC BY 4.0",
      modelGuidance: true,
      warningAuthority: false,
    },
    disclaimer: "结果是基于数值预报的机会指数，并非气象部门发布的确定性预报；山体遮挡、局地云和临近日出日落的快速变化仍可能改变实况。",
  };
}
