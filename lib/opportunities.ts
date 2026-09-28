import type { City, DailyOpportunity, DayForecast, SpaceWeatherResponse } from "@/lib/types";

const MINUTE = 60_000;
const KP_INTERVAL = 3 * 60 * MINUTE;
const clockFormatter = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Shanghai" });
const spaceWeatherTimeFormatter = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" });

function instant(value: string) {
  return new Date(value.endsWith("Z") ? value : `${value}:00+08:00`);
}

function offset(value: string, minutes: number) {
  return new Date(instant(value).getTime() + minutes * MINUTE).toISOString();
}

function normalized(value: string | null, fallback: string) {
  return value ? instant(value).toISOString() : instant(fallback).toISOString();
}

function clock(value: string | null) {
  return value ? clockFormatter.format(instant(value)) : "—";
}

function signed(value: number) {
  return `${value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}°`;
}

function lightPathLabel(event: DayForecast["dawn"]) {
  if (event.lightPath.status !== "available") return "暂无采样";
  const path = event.contributions.find((item) => item.name === "远方光路");
  if (!path) return "已采样";
  return path.value <= -8 ? "明显遮挡" : path.value <= -3 ? "部分遮挡" : "基本通透";
}

function byMagnitude(factors: DailyOpportunity["factors"] | undefined) {
  return [...(factors ?? [])].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

function modelList(scores: { model: string; probability: number }[] | undefined) {
  return (scores ?? []).map((item) => ({ model: item.model, score: item.probability }));
}

function status(score: number | null): DailyOpportunity["status"] {
  if (score === null) return "unavailable";
  if (score >= 72) return "excellent";
  if (score >= 42) return "watch";
  return "poor";
}

function percent(value: number | null) {
  return value === null ? "—" : `${Math.round(value)}%`;
}

function kilometres(value: number | null) {
  return value === null ? "—" : `${Math.round(value / 1000)} km`;
}

function auroraOpportunity(day: DayForecast, city: City, spaceWeather: SpaceWeatherResponse | null): DailyOpportunity {
  const start = normalized(day.solar.eveningAstronomicalStart, day.sunset);
  const end = normalized(day.solar.morningAstronomicalEnd, offset(day.sunset, 12 * 60));
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  const points = spaceWeather?.status === "available"
    ? spaceWeather.points.filter((point) => {
        // Each Kp value covers the three hours starting at its timestamp.
        const time = new Date(point.time).getTime();
        return time <= endTime && time + KP_INTERVAL >= startTime;
      })
    : [];
  const strongest = points.reduce<(typeof points)[number] | null>((current, point) => !current || point.kp > current.kp ? point : current, null);
  const requiredKp = city.latitude >= 52 ? 6 : city.latitude >= 48 ? 7 : city.latitude >= 44 ? 8 : 9;
  const magneticSignal = strongest ? Math.max(0, Math.min(100, (strongest.kp - (requiredKp - 3)) / 3 * 100)) : null;
  const score = magneticSignal === null ? null : Math.round(magneticSignal * day.night.probability / 100);
  const peak = strongest
    ? new Date((Math.max(startTime, new Date(strongest.time).getTime()) + Math.min(endTime, new Date(strongest.time).getTime() + KP_INTERVAL)) / 2).toISOString()
    : instant(day.night.time).toISOString();
  const availability = spaceWeather?.status !== "available"
    ? "空间天气源暂时不可用"
    : strongest === null
      ? "超出 NOAA Kp 有效预报范围"
      : strongest.kp < requiredKp
        ? `Kp ${strongest.kp.toFixed(1)}，未达到本纬度约 Kp ${requiredKp} 的经验门槛`
        : `Kp ${strongest.kp.toFixed(1)} 达到本纬度经验门槛，仍需确认极光椭圆与现场天空`;
  return {
    id: "aurora",
    kind: "aurora",
    title: "极光",
    shortTitle: "极光",
    start,
    peak,
    end,
    score,
    scoreType: "opportunity-index",
    confidence: strongest ? Math.min(62, day.night.confidence) : null,
    status: status(score),
    summary: strongest ? `${availability}；本地黑夜与云量共同计入机会指数。` : availability,
    limitation: "Kp 是全球地磁指导；未接入实时极光椭圆与 Bz，不能承诺具体地点可见。",
    direction: score !== null ? { azimuth: 0, label: "建议先查看北方天空" } : null,
    details: [
      { label: "最强 Kp", value: strongest ? `${strongest.kp.toFixed(1)}（${clock(strongest.time)} 起 3 小时）` : "—" },
      { label: "本地经验门槛", value: `约 Kp ${requiredKp}` },
      { label: "星空天气", value: `${day.night.probability}/100` },
      { label: "数据时效", value: spaceWeather?.validUntil ? `至 ${spaceWeatherTimeFormatter.format(new Date(spaceWeather.validUntil))}` : "暂无" },
    ],
    factors: [],
    models: [],
  };
}

const GLOW_LIMITATION = "机会指数是透明启发式评分，不是统计概率；光路只在太阳方向 40–350 km 取 4 个格点，云底高度按气候平均估计，分辨不出更细的云缝。";

export function buildDailyOpportunities(day: DayForecast, city: City, spaceWeather: SpaceWeatherResponse | null): DailyOpportunity[] {
  const rainbow = day.weather.rainbow;
  // Rainbow inputs are hour-accumulated; the analysis time marks the end of that hour.
  const rainbowPeak = offset(rainbow.time, -30);
  const sunrise = day.solar.sunriseAt ?? instant(day.sunrise).toISOString();
  const sunset = day.solar.sunsetAt ?? instant(day.sunset).toISOString();
  const glowDetails = (event: DayForecast["dawn"]) => [
    { label: "高指数窗口", value: `${clock(event.window.start)}–${clock(event.window.end)}` },
    { label: "峰值太阳高度", value: signed(event.solarAltitude) },
    { label: "低云", value: percent(event.metrics.lowCloud) },
    { label: "中云", value: percent(event.metrics.midCloud) },
    { label: "高云", value: percent(event.metrics.highCloud) },
    { label: "远方光路", value: lightPathLabel(event) },
  ];
  const items: DailyOpportunity[] = [
    {
      id: "dawn-glow", kind: "dawn-glow", title: "朝霞", shortTitle: "朝霞",
      start: day.dawn.window.start, peak: instant(day.dawn.time).toISOString(), end: day.dawn.window.end,
      score: day.dawn.probability, scoreType: "opportunity-index", confidence: day.dawn.confidence, status: status(day.dawn.probability),
      summary: day.dawn.summary, limitation: GLOW_LIMITATION,
      direction: day.solar.sunriseAzimuth === null ? null : { azimuth: day.solar.sunriseAzimuth, label: "朝霞光路 / 日出方位" },
      details: glowDetails(day.dawn),
      factors: byMagnitude(day.dawn.contributions), models: modelList(day.dawn.modelScores),
    },
    {
      id: "sunrise", kind: "sunrise", title: "日出与晨间金色时段", shortTitle: "日出",
      start: normalized(day.solar.morningBlueStart, offset(day.sunrise, -35)), peak: sunrise, end: normalized(day.solar.morningGoldenEnd, offset(day.sunrise, 45)),
      score: null, scoreType: "geometry-only", confidence: 100, status: "watch",
      summary: "日出时刻按日面上缘与标准大气折射解算，方位由定位点天文几何计算；是否出片仍取决于地平线云层与遮挡。", limitation: "按海平面理想地平线计算；山体、建筑会让实际见日推迟数分钟，异常折射也会带来约 1 分钟偏差。",
      direction: day.solar.sunriseAzimuth === null ? null : { azimuth: day.solar.sunriseAzimuth, label: "日出方位" },
      details: [
        { label: "日出", value: clock(sunrise) },
        { label: "日出方位", value: day.solar.sunriseAzimuth === null ? "—" : `${Math.round(day.solar.sunriseAzimuth)}°` },
        { label: "蓝调开始", value: clock(day.solar.morningBlueStart) },
        { label: "金色时段结束", value: clock(day.solar.morningGoldenEnd) },
      ],
      factors: [], models: [],
    },
    {
      id: "fog", kind: "fog", title: "雾景", shortTitle: "雾景",
      start: day.fog.window.start, peak: instant(day.fog.time).toISOString(), end: day.fog.window.end,
      score: day.fog.probability, scoreType: "opportunity-index", confidence: day.fog.confidence, status: status(day.fog.probability),
      summary: day.fog.summary, limitation: "单点模式未计入水体距离、精细地形与雾的局地输送；辐射雾常在日出前后最浓，谷地与平原差异很大。", direction: null,
      details: [
        { label: "湿度", value: percent(day.fog.metrics.humidity) },
        { label: "低云", value: percent(day.fog.metrics.lowCloud) },
        { label: "能见度", value: kilometres(day.fog.metrics.visibility) },
        { label: "风速", value: day.fog.metrics.windSpeed === null ? "—" : `${Math.round(day.fog.metrics.windSpeed)} km/h` },
      ],
      factors: byMagnitude(day.fog.contributions), models: modelList(day.fog.modelScores),
    },
    {
      id: "rainbow", kind: "rainbow", title: "彩虹", shortTitle: "彩虹",
      start: offset(rainbow.time, -60), peak: rainbowPeak, end: instant(rainbow.time).toISOString(),
      score: rainbow.score, scoreType: "opportunity-index", confidence: rainbow.confidence, status: status(rainbow.score),
      summary: rainbow.summary, limitation: "单点网格不知道雨幕是否位于反太阳方向，只能表达彩虹潜势。",
      direction: rainbow.viewingAzimuth === null ? null : { azimuth: rainbow.viewingAzimuth, label: "建议观虹方向" },
      details: [
        { label: "彩虹潜势", value: rainbow.score === null ? "暂无" : `${rainbow.score}/100` },
        { label: "太阳高度", value: `${rainbow.metrics.solarAltitude.toFixed(1)}°` },
        { label: "直射辐射", value: rainbow.metrics.directRadiation === null ? "—" : `${Math.round(rainbow.metrics.directRadiation)} W/m²` },
        { label: "观测方位", value: rainbow.viewingAzimuth === null ? "—" : `${Math.round(rainbow.viewingAzimuth)}°` },
      ],
      factors: [], models: rainbow.modelScores ?? [],
    },
    {
      id: "sunset", kind: "sunset", title: "日落与傍晚蓝调", shortTitle: "日落",
      start: normalized(day.solar.eveningGoldenStart, offset(day.sunset, -50)), peak: sunset, end: normalized(day.solar.eveningBlueEnd, offset(day.sunset, 40)),
      score: null, scoreType: "geometry-only", confidence: 100, status: "watch",
      summary: "日落按日面上缘与标准大气折射解算，金色时段与蓝调由太阳高度确定，可直接用于到场和构图计划。", limitation: "按海平面理想地平线计算；山体、建筑会让实际日没提前数分钟，异常折射也会带来约 1 分钟偏差。",
      direction: day.solar.sunsetAzimuth === null ? null : { azimuth: day.solar.sunsetAzimuth, label: "日落方位" },
      details: [
        { label: "日落", value: clock(sunset) },
        { label: "日落方位", value: day.solar.sunsetAzimuth === null ? "—" : `${Math.round(day.solar.sunsetAzimuth)}°` },
        { label: "金色时段开始", value: clock(day.solar.eveningGoldenStart) },
        { label: "蓝调结束", value: clock(day.solar.eveningBlueEnd) },
      ],
      factors: [], models: [],
    },
    {
      id: "dusk-glow", kind: "dusk-glow", title: "晚霞", shortTitle: "晚霞",
      start: day.dusk.window.start, peak: instant(day.dusk.time).toISOString(), end: day.dusk.window.end,
      score: day.dusk.probability, scoreType: "opportunity-index", confidence: day.dusk.confidence, status: status(day.dusk.probability),
      summary: day.dusk.summary, limitation: GLOW_LIMITATION,
      direction: day.solar.sunsetAzimuth === null ? null : { azimuth: day.solar.sunsetAzimuth, label: "晚霞光路 / 日落方位" },
      details: glowDetails(day.dusk),
      factors: byMagnitude(day.dusk.contributions), models: modelList(day.dusk.modelScores),
    },
    {
      id: "moon", kind: "moon", title: "月亮", shortTitle: "月亮",
      start: day.moon.window.start, peak: instant(day.moon.time).toISOString(), end: day.moon.window.end,
      score: day.moon.probability, scoreType: "opportunity-index", confidence: day.moon.confidence, status: status(day.moon.probability),
      summary: `${day.moon.phaseName}，照明 ${day.moon.illumination}%。${day.moon.summary}`, limitation: "方位线未计入山体和建筑遮挡。",
      direction: day.moon.altitude > 0 ? { azimuth: day.moon.azimuth, label: "月面方位" } : null,
      details: [
        { label: "月面高度", value: `${day.moon.altitude.toFixed(1)}°` },
        { label: "月面方位", value: `${Math.round(day.moon.azimuth)}°` },
        { label: "照明", value: `${day.moon.illumination}%` },
        { label: "月出 / 月落", value: `${clock(day.moon.rise)} / ${clock(day.moon.set)}` },
        { label: "阵风", value: day.moon.weather.windGusts === null ? "—" : `${Math.round(day.moon.weather.windGusts)} km/h` },
      ],
      factors: byMagnitude(day.moon.contributions), models: modelList(day.moon.modelScores),
    },
    {
      id: "stars", kind: "stars", title: "星空", shortTitle: "星空",
      start: day.night.window.start, peak: instant(day.night.time).toISOString(), end: day.night.window.end,
      score: day.night.probability, scoreType: "opportunity-index", confidence: day.night.confidence, status: status(day.night.probability),
      summary: day.night.summary, limitation: "当前未计入光污染、银河核心位置和地形地平线。", direction: null,
      details: [
        { label: "天文黑夜", value: day.night.astronomicalDusk ? `${clock(day.night.astronomicalDusk)}–${clock(day.night.astronomicalDawn)}` : "无完整黑夜" },
        { label: "完整黑夜", value: `${Math.round(day.night.darknessMinutes / 60 * 10) / 10} 小时` },
        { label: "月光", value: `${day.night.moon.illumination}%` },
        { label: "低云", value: percent(day.night.weather.lowCloud) },
        { label: "阵风", value: day.night.weather.windGusts === null ? "—" : `${Math.round(day.night.weather.windGusts)} km/h` },
      ],
      factors: byMagnitude(day.night.contributions), models: modelList(day.night.modelScores),
    },
    auroraOpportunity(day, city, spaceWeather),
  ];
  return items.sort((a, b) => new Date(a.peak).getTime() - new Date(b.peak).getTime());
}
