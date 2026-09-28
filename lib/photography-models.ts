import type { FogMetrics, NightWeatherMetrics, ScoreResult } from "@/lib/types";

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));

export function scoreFog(metrics: FogMetrics): ScoreResult {
  let score = 18;
  let known = 0;
  const contributions: ScoreResult["contributions"] = [];
  const add = (name: string, value: number, detail: string, weight: number) => {
    score += value;
    known += weight;
    contributions.push({
      name,
      value: Math.round(value),
      direction: value > 2 ? "positive" : value < -2 ? "negative" : "neutral",
      detail,
    });
  };

  if (metrics.temperature !== null && metrics.dewPoint !== null) {
    const spread = Math.max(0, metrics.temperature - metrics.dewPoint);
    const value = spread <= 0.8 ? 27 : spread <= 2 ? 23 : spread <= 4 ? 11 : -Math.min((spread - 4) * 4, 20);
    add("露点差", value, `${spread.toFixed(1)}°C`, 28);
  }
  if (metrics.humidity !== null) {
    const value = metrics.humidity >= 96 ? 20 : metrics.humidity >= 90 ? 15 : metrics.humidity >= 82 ? 6 : -Math.min((82 - metrics.humidity) * .7, 16);
    add("近地饱和", value, `${Math.round(metrics.humidity)}% 湿度`, 20);
  }
  if (metrics.windSpeed !== null) {
    const speed = metrics.windSpeed;
    // Radiation fog, the common photographic case, needs near-calm air; stronger wind mixes the saturated layer away.
    // Advection fog tolerates more wind, but a single grid point cannot see the sea or lake it would come from.
    const value = speed <= 10 ? 11 : speed <= 18 ? 5 : -Math.min((speed - 18) * .9, 18);
    add("风速条件", value, `${speed.toFixed(0)} km/h 风速${speed <= 10 ? "，利于辐射雾稳定" : speed <= 18 ? "，辐射雾易被扰动" : "，雾层难以停留"}`, 17);
  }
  if (metrics.lowCloud !== null) {
    const value = metrics.lowCloud >= 70 ? 11 : metrics.lowCloud >= 35 ? 7 : -4;
    add("低层水汽", value, `${Math.round(metrics.lowCloud)}% 低云`, 13);
  }
  if (metrics.visibility !== null) {
    const km = metrics.visibility / 1000;
    const value = km <= 1 ? 14 : km <= 5 ? 10 : km <= 12 ? 4 : -3;
    add("能见度信号", value, `${km.toFixed(km < 10 ? 1 : 0)} km`, 14);
  }
  if (metrics.precipitation !== null) {
    const value = metrics.precipitation <= .1 ? 3 : -Math.min(metrics.precipitation * 8, 12);
    add("非降水性", value, `${metrics.precipitation.toFixed(1)} mm`, 8);
  }

  const completeness = Math.round(known);
  const adjusted = score + (42 - score) * ((100 - completeness) / 100) * .45;
  return {
    probability: Math.round(clamp(adjusted, 4, 96)),
    rawScore: Math.round(score),
    completeness,
    contributions: contributions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
  };
}

export function fogLevel(probability: number): "很高" | "较高" | "一般" | "较低" {
  if (probability >= 76) return "很高";
  if (probability >= 58) return "较高";
  if (probability >= 38) return "一般";
  return "较低";
}

export function fogSummary(probability: number, metrics: FogMetrics) {
  const spread = metrics.temperature !== null && metrics.dewPoint !== null ? metrics.temperature - metrics.dewPoint : null;
  if ((metrics.windSpeed ?? 0) > 28) return "风速偏强，雾层难以稳定停留";
  if (spread !== null && spread <= 2 && (metrics.humidity ?? 0) >= 90) return "近地空气接近饱和，具备成雾基础";
  if (probability >= 58) return "水汽与风速条件较配合，建议关注低洼和水面附近";
  if (probability >= 38) return "存在雾景窗口，但局地地形将决定最终形态";
  return "空气尚未接近饱和，形成稳定雾层的机会有限";
}

function dewSpread(metrics: NightWeatherMetrics) {
  return metrics.temperature !== null && metrics.dewPoint !== null
    ? Math.max(0, metrics.temperature - metrics.dewPoint)
    : null;
}

function cloudAverage(metrics: NightWeatherMetrics) {
  const values = [metrics.lowCloud, metrics.midCloud, metrics.highCloud].filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function finishScore(rawScore: number, known: number, contributions: ScoreResult["contributions"]): ScoreResult {
  const completeness = Math.round(clamp(known));
  const adjusted = rawScore + (45 - rawScore) * ((100 - completeness) / 100) * .55;
  return {
    probability: Math.round(clamp(adjusted, 4, 96)),
    rawScore: Math.round(rawScore),
    completeness,
    contributions: contributions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
  };
}

export function scoreNightscape(
  metrics: NightWeatherMetrics,
  astronomy: { sunAltitude: number; moonAltitude: number; moonIllumination: number },
): ScoreResult {
  let score = 47;
  let known = 32;
  const contributions: ScoreResult["contributions"] = [];
  const add = (name: string, value: number, detail: string, weight: number) => {
    score += value;
    known += weight;
    contributions.push({
      name,
      value: Math.round(value),
      direction: value > 2 ? "positive" : value < -2 ? "negative" : "neutral",
      detail,
    });
  };

  const darkness = astronomy.sunAltitude <= -18 ? 12 : astronomy.sunAltitude <= -15 ? -4 : astronomy.sunAltitude <= -12 ? -15 : -28;
  add("天文黑夜", darkness, `太阳高度 ${astronomy.sunAltitude.toFixed(1)}°`, 0);

  const moonInterference = astronomy.moonAltitude <= 0
    ? 10
    : -Math.min(28, astronomy.moonIllumination * (.12 + Math.min(astronomy.moonAltitude, 60) / 500));
  add("月光干扰", moonInterference, `${astronomy.moonIllumination}% 照明 · 高度 ${astronomy.moonAltitude.toFixed(1)}°`, 0);

  const cloud = cloudAverage(metrics);
  if (cloud !== null) add("三层云量", clamp(12 - cloud * .58, -42, 12), `${Math.round(cloud)}% 平均云量`, 28);

  if (metrics.precipitationProbability !== null || metrics.precipitation !== null) {
    const chance = metrics.precipitationProbability ?? Math.min(100, (metrics.precipitation ?? 0) * 35);
    const amount = metrics.precipitation ?? 0;
    add("降水风险", clamp(4 - chance * .26 - amount * 8, -25, 4), `${Math.round(chance)}% · ${amount.toFixed(1)} mm`, 15);
  }

  const spread = dewSpread(metrics);
  if (spread !== null || metrics.humidity !== null) {
    const humidity = metrics.humidity ?? 70;
    const value = (spread === null ? 0 : spread >= 4 ? 4 : spread >= 2 ? 0 : -10) + (humidity >= 94 ? -7 : humidity <= 75 ? 2 : 0);
    add("结露风险", clamp(value, -15, 6), `${spread === null ? "—" : spread.toFixed(1)}°C 露点差 · ${Math.round(humidity)}% 湿度`, 12);
  }

  if (metrics.windGusts !== null || metrics.windSpeed !== null) {
    const gust = metrics.windGusts ?? metrics.windSpeed ?? 0;
    const value = gust <= 18 ? 4 : gust <= 30 ? 1 : -Math.min((gust - 30) * .8, 20);
    add("脚架稳定", value, `${gust.toFixed(0)} km/h 阵风`, 8);
  }

  if (metrics.visibility !== null) {
    const kilometres = metrics.visibility / 1000;
    add("空气通透", clamp((kilometres - 10) * .3, -5, 5), `${kilometres.toFixed(0)} km 能见度`, 5);
  }

  return finishScore(score, known, contributions);
}

export function scoreMoon(
  metrics: NightWeatherMetrics,
  astronomy: { altitude: number; illumination: number },
): ScoreResult {
  let score = 35;
  let known = 29;
  const contributions: ScoreResult["contributions"] = [];
  const add = (name: string, value: number, detail: string, weight: number) => {
    score += value;
    known += weight;
    contributions.push({
      name,
      value: Math.round(value),
      direction: value > 2 ? "positive" : value < -2 ? "negative" : "neutral",
      detail,
    });
  };

  const altitudeValue = astronomy.altitude < 0 ? -38 : astronomy.altitude < 5 ? 4 : astronomy.altitude <= 65 ? 21 : 13;
  add("月面可见", altitudeValue, `高度 ${astronomy.altitude.toFixed(1)}°`, 0);
  add("月面亮度", astronomy.illumination >= 50 ? 4 : astronomy.illumination >= 15 ? 2 : -1, `${astronomy.illumination}% 照明`, 0);

  const cloud = cloudAverage(metrics);
  if (cloud !== null) add("云层遮挡", clamp(23 - cloud * .64, -38, 23), `${Math.round(cloud)}% 平均云量`, 30);

  if (metrics.precipitationProbability !== null || metrics.precipitation !== null) {
    const chance = metrics.precipitationProbability ?? Math.min(100, (metrics.precipitation ?? 0) * 35);
    add("降水风险", clamp(5 - chance * .3 - (metrics.precipitation ?? 0) * 7, -25, 5), `${Math.round(chance)}% 降水可能`, 15);
  }

  if (metrics.visibility !== null) {
    const kilometres = metrics.visibility / 1000;
    add("空气通透", clamp((kilometres - 8) * .34, -6, 7), `${kilometres.toFixed(0)} km 能见度`, 10);
  }

  const spread = dewSpread(metrics);
  if (spread !== null || metrics.humidity !== null) {
    const humidity = metrics.humidity ?? 70;
    const value = (spread !== null && spread < 1.5 ? -7 : 3) + (humidity >= 94 ? -5 : 0);
    add("镜片结露", clamp(value, -12, 5), `${spread === null ? "—" : spread.toFixed(1)}°C 露点差`, 8);
  }

  if (metrics.windGusts !== null || metrics.windSpeed !== null) {
    const gust = metrics.windGusts ?? metrics.windSpeed ?? 0;
    add("长焦稳定", gust <= 18 ? 5 : gust <= 30 ? 0 : -Math.min((gust - 30) * .75, 19), `${gust.toFixed(0)} km/h 阵风`, 8);
  }

  return finishScore(score, known, contributions);
}
