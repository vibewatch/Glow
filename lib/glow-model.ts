import type { EventKind, LightPathSample, ScoreResult, SkyMetrics } from "@/lib/types";

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const RADIANS = Math.PI / 180;

function bell(value: number, ideal: number, width: number) {
  return Math.exp(-0.5 * ((value - ideal) / width) ** 2);
}

/**
 * Sunlight geometry for the two cloud decks that carry colour. Heights are
 * climatological mid-latitude deck heights, not model output: Open-Meteo only
 * publishes layer cover, so the exact cloud base remains unknown.
 */
export const EARTH_RADIUS_KM = 6371;
export const GLOW_LAYERS = [
  { id: "mid", name: "中云", heightKm: 4.5 },
  { id: "high", name: "高云", heightKm: 9 },
] as const;
export type GlowLayerId = (typeof GLOW_LAYERS)[number]["id"];
/** Below this grazing height the ray is extinguished by the boundary-layer haze and terrain. */
export const SHADOW_TOP_KM = 0.5;
const LOW_TOP_KM = 2;
const MID_TOP_KM = 6.5;
const HIGH_TOP_KM = 13;
/** Fraction of light a fully covered layer removes. Cirrus is optically thin, low stratus is not. */
const LAYER_OPACITY = { low: 0.92, mid: 0.8, high: 0.3 } as const;

export interface GlowContext {
  solarAltitude: number;
  /** Cloud cover sampled toward the sun. `null`/absent means the light path is unknown, not clear. */
  path?: LightPathSample[] | null;
}

export interface LayerLight {
  id: GlowLayerId;
  heightKm: number;
  /** Lowest height (km) the sunlight ray passes on its way to this layer. */
  grazingKm: number;
  /** 0 = in the earth's shadow, 1 = directly lit. */
  lit: number;
  /** 0.1 = white daylight, 1 = deepest red just before the shadow arrives. */
  colour: number;
  /** Transmission along the sampled light path; null when no sample is known. */
  transmission: number | null;
  /** Human-readable blocking layer, e.g. "180 km 低云". */
  blocker: string | null;
}

/** Atmospheric bending of the sunlight ray (degrees). Grazing rays below the horizon cross the atmosphere twice. */
export function sunlightBending(solarAltitude: number) {
  if (solarAltitude >= 0) return 1.02 / Math.tan((solarAltitude + 10.3 / (solarAltitude + 5.11)) * RADIANS) / 60;
  return 0.48 + 0.5 * (1 - Math.exp(solarAltitude / 1.2));
}

function apparentRayAngle(solarAltitude: number) {
  return solarAltitude + sunlightBending(solarAltitude);
}

/** Height (km) of the ray that reaches a cloud at `layerHeightKm` above the observer, `distanceKm` toward the sun. */
export function rayHeightKm(layerHeightKm: number, solarAltitude: number, distanceKm: number) {
  return layerHeightKm + distanceKm * Math.tan(apparentRayAngle(solarAltitude) * RADIANS) + distanceKm ** 2 / (2 * EARTH_RADIUS_KM);
}

/** Lowest point of that ray; it touches bottom at `R·tan|a|` km toward the sun when the sun is below the cloud's horizon. */
export function grazingHeightKm(layerHeightKm: number, solarAltitude: number) {
  const angle = apparentRayAngle(solarAltitude);
  if (angle >= 0) return layerHeightKm;
  return layerHeightKm - EARTH_RADIUS_KM * Math.tan(angle * RADIANS) ** 2 / 2;
}

/** Geometric solar altitude (degrees) at which a layer enters the earth's shadow. */
export function shadowCutoffAltitude(layerHeightKm: number) {
  const apparent = -Math.atan(Math.sqrt(2 * (layerHeightKm - SHADOW_TOP_KM) / EARTH_RADIUS_KM)) / RADIANS;
  // Solve apparent = alt + bending(alt) by fixed-point iteration; bending varies slowly.
  let altitude = apparent - 0.9;
  for (let index = 0; index < 6; index += 1) altitude = apparent - sunlightBending(altitude);
  return altitude;
}

function blockingLayer(height: number): keyof typeof LAYER_OPACITY | null {
  if (height < 0) return null;
  if (height < LOW_TOP_KM) return "low";
  if (height < MID_TOP_KM) return "mid";
  if (height < HIGH_TOP_KM) return "high";
  return null;
}

const LAYER_LABEL = { low: "低云", mid: "中云", high: "高云" } as const;

export function layerLight(layer: (typeof GLOW_LAYERS)[number], solarAltitude: number, path?: LightPathSample[] | null): LayerLight {
  const grazingKm = grazingHeightKm(layer.heightKm, solarAltitude);
  const lit = clamp((grazingKm - (SHADOW_TOP_KM - 0.2)) / 0.9, 0, 1);
  const apparentCutoff = -Math.atan(Math.sqrt(2 * (layer.heightKm - SHADOW_TOP_KM) / EARTH_RADIUS_KM)) / RADIANS;
  const depth = apparentRayAngle(solarAltitude) - apparentCutoff;
  // Reddening grows fastest in the last degree before the shadow, when the ray's air mass climbs steeply.
  const colour = 1 - 0.9 * Math.sqrt(clamp(depth / 10, 0, 1));
  let transmission: number | null = null;
  let strongestBlock = 0;
  let blocker: string | null = null;
  for (const sample of path ?? []) {
    const height = rayHeightKm(layer.heightKm, solarAltitude, sample.distanceKm);
    const band = blockingLayer(height);
    if (band === null) {
      if (height >= HIGH_TOP_KM) transmission ??= 1;
      continue;
    }
    const cover = band === "low" ? sample.lowCloud : band === "mid" ? sample.midCloud : sample.highCloud;
    if (cover === null) continue;
    const block = LAYER_OPACITY[band] * clamp(cover) / 100;
    transmission = (transmission ?? 1) * (1 - block);
    if (block > strongestBlock) {
      strongestBlock = block;
      blocker = `${sample.distanceKm} km ${LAYER_LABEL[band]} ${Math.round(cover)}%`;
    }
  }
  return { id: layer.id, heightKm: layer.heightKm, grazingKm, lit, colour, transmission, blocker: strongestBlock >= 0.15 ? blocker : null };
}

function present(values: (number | null)[]) {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

export function averageMetrics(items: SkyMetrics[]): SkyMetrics {
  const average = (key: keyof SkyMetrics) => {
    const values = present(items.map((item) => item[key]));
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };

  return {
    lowCloud: average("lowCloud"),
    midCloud: average("midCloud"),
    highCloud: average("highCloud"),
    humidity: average("humidity"),
    visibility: average("visibility"),
    precipitationProbability: average("precipitationProbability"),
    precipitation: average("precipitation"),
    aerosolOpticalDepth: average("aerosolOpticalDepth"),
    pm25: average("pm25"),
  };
}

function contribution(name: string, value: number, detail: string): ScoreResult["contributions"][number] {
  return { name, value: Math.round(value), direction: value > 2 ? "positive" : value < -2 ? "negative" : "neutral", detail };
}

/** How much each deck contributes to the colour canvas; used to weight the per-layer light geometry. */
function canvasWeights(metrics: SkyMetrics) {
  const mid = metrics.midCloud === null ? 0 : bell(metrics.midCloud, 52, 28) * 13;
  const high = metrics.highCloud === null ? 0 : bell(metrics.highCloud, 52, 32) * 15;
  return mid + high < 0.5 ? { mid: 1, high: 1 } : { mid, high };
}

function formatAltitude(value: number) {
  return `${value >= 0 ? "" : "−"}${Math.abs(value).toFixed(1)}°`;
}

export function scoreGlow(metrics: SkyMetrics, kind: EventKind, context?: GlowContext): ScoreResult {
  let rawScore = 34;
  let knownWeight = 0;
  const totalWeight = 120;
  const contributions: ScoreResult["contributions"] = [];
  const add = (name: string, value: number, detail: string) => {
    rawScore += value;
    contributions.push(contribution(name, value, detail));
  };

  if (metrics.midCloud !== null || metrics.highCloud !== null) {
    const mid = metrics.midCloud ?? metrics.highCloud ?? 0;
    const high = metrics.highCloud ?? metrics.midCloud ?? 0;
    const texture = bell(mid, 52, 28) * 13 + bell(high, 52, 32) * 15;
    add("染色云层", texture - 7, `${Math.round(mid)}% 中云 · ${Math.round(high)}% 高云`);
    knownWeight += 30;
  }

  if (metrics.lowCloud !== null) {
    const penalty = metrics.lowCloud <= 18 ? 8 : metrics.lowCloud <= 42 ? 4 - (metrics.lowCloud - 18) * 0.35 : -4 - (metrics.lowCloud - 42) * 0.52;
    add("近地低云遮挡", clamp(penalty, -28, 8), `${Math.round(metrics.lowCloud)}% 本地低云`);
    knownWeight += 24;
  }

  if (metrics.precipitationProbability !== null || metrics.precipitation !== null) {
    const probability = metrics.precipitationProbability ?? clamp((metrics.precipitation ?? 0) * 34);
    const amount = metrics.precipitation ?? 0;
    const penalty = -(probability * 0.22 + Math.min(amount * 7, 12));
    add("降水干扰", clamp(penalty, -26, 0), `${Math.round(probability)}% 降水可能`);
    knownWeight += 18;
  }

  if (metrics.visibility !== null) {
    const kilometres = metrics.visibility / 1000;
    const value = clamp((kilometres - 7) * 0.72, -9, 8);
    add("空气通透", value, `${kilometres.toFixed(0)} km 能见度`);
    knownWeight += 10;
  }

  if (metrics.humidity !== null) {
    const value = metrics.humidity <= 82 ? 0 : -(metrics.humidity - 82) * 0.55;
    add("近地湿度", clamp(value, -10, 0), `${Math.round(metrics.humidity)}% 相对湿度；仅用于识别雾霾与低层遮挡风险`);
    knownWeight += 8;
  }

  if (metrics.aerosolOpticalDepth !== null || metrics.pm25 !== null) {
    const aod = metrics.aerosolOpticalDepth;
    const pm25 = metrics.pm25;
    let value = 0;
    if (aod !== null) value += aod < 0.08 ? -1 : aod <= 0.35 ? 2 : aod <= 0.7 ? 0 : -Math.min((aod - 0.7) * 18, 12);
    if (pm25 !== null && pm25 > 75) value -= Math.min((pm25 - 75) * 0.11, 9);
    add("气溶胶背景", clamp(value, -15, 2), `${aod === null ? "—" : aod.toFixed(2)} AOD · PM₂.₅ ${pm25 === null ? "—" : Math.round(pm25)}；粗分辨率背景修正`);
    knownWeight += 10;
  }

  const layers = context ? GLOW_LAYERS.map((layer) => layerLight(layer, context.solarAltitude, context.path)) : [];
  const pathKnown = layers.some((layer) => layer.transmission !== null);
  if (pathKnown) knownWeight += 20;

  const completeness = Math.round((knownWeight / totalWeight) * 100);
  const uncertaintyPull = (100 - completeness) * 0.13;
  const weatherScore = clamp(rawScore + (50 - rawScore) * (uncertaintyPull / 100), 4, 96);
  if (!context) return { probability: Math.round(weatherScore), rawScore: Math.round(rawScore), completeness, contributions };

  const weights = canvasWeights(metrics);
  const weightOf = (layer: LayerLight) => weights[layer.id];
  const totalLayerWeight = layers.reduce((sum, layer) => sum + weightOf(layer), 0);
  const illumination = layers.reduce((sum, layer) => sum + weightOf(layer) * layer.lit * layer.colour, 0) / totalLayerWeight;
  const timing = 0.2 + 0.8 * illumination;
  const pathIllumination = layers.reduce((sum, layer) => sum + weightOf(layer) * layer.lit * layer.colour * (layer.transmission ?? 1), 0) / totalLayerWeight;
  const pathFactor = pathKnown && illumination > 0.01 ? 0.3 + 0.7 * (pathIllumination / illumination) : 1;
  const probability = Math.round(clamp(4 + (weatherScore - 4) * timing * pathFactor, 4, 96));

  const litLayers = layers.filter((layer) => layer.lit >= 0.5).map((layer) => GLOW_LAYERS.find((item) => item.id === layer.id)!.name);
  const timingValue = (weatherScore - 4) * (timing - 1);
  contributions.push(contribution(
    "光照几何",
    timingValue,
    `太阳高度 ${formatAltitude(context.solarAltitude)}；${litLayers.length ? `${litLayers.join("、")}仍被直射` : "中高云已进入地影"}，${illumination >= 0.8 ? "光线接近最红" : illumination >= 0.45 ? "光色偏暖但未到最深" : "染色很弱"}`,
  ));
  if (pathKnown) {
    const pathValue = (weatherScore - 4) * timing * (pathFactor - 1);
    const blockers = layers.filter((layer) => layer.lit >= 0.5 && layer.blocker).map((layer) => layer.blocker!);
    const transmission = layers
      .filter((layer) => layer.transmission !== null)
      .map((layer) => `${GLOW_LAYERS.find((item) => item.id === layer.id)!.name}透光 ${Math.round((layer.transmission ?? 1) * 100)}%`)
      .join(" · ");
    contributions.push(contribution(
      "远方光路",
      pathValue,
      `${kind === "dawn" ? "日出" : "日落"}方向采样：${transmission}${blockers.length ? `；主要遮挡 ${[...new Set(blockers)].join("、")}` : "；未见明显遮挡"}`,
    ));
  }

  return { probability, rawScore: Math.round(rawScore), completeness, contributions };
}

export function probabilityLevel(probability: number): "极佳" | "值得期待" | "可以等等" | "机会较低" {
  if (probability >= 76) return "极佳";
  if (probability >= 58) return "值得期待";
  if (probability >= 38) return "可以等等";
  return "机会较低";
}

export function confidenceFromScores(scores: ScoreResult[], leadDays: number) {
  if (!scores.length) return 20;
  const average = scores.reduce((sum, score) => sum + score.probability, 0) / scores.length;
  const disagreement = scores.reduce((sum, score) => sum + Math.abs(score.probability - average), 0) / scores.length;
  const completeness = scores.reduce((sum, score) => sum + score.completeness, 0) / scores.length;
  const multiModel = scores.length > 1 ? 12 : -8;
  return Math.round(clamp(58 + multiModel + completeness * 0.22 - disagreement * 1.25 - leadDays * 4, 24, 94));
}
