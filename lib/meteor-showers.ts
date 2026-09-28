import { Body, Equator, GeoVector, Horizon, Illumination, Observer, RotateVector, Rotation_EQJ_ECL, SphereFromVector } from "astronomy-engine";
import type { City, MeteorShowerForecast } from "@/lib/types";

interface ShowerDefinition {
  id: string;
  name: string;
  peakMonth: number;
  peakDay: number;
  /** IMO maximum as solar longitude, J2000.0 ecliptic. */
  solarLongitude: number;
  activeStart: [number, number];
  activeEnd: [number, number];
  zenithalHourlyRate: number;
  radiant: string;
  radiantRa: number;
  radiantDec: number;
  viewingAdvice: string;
}

// Major annual showers only. The maximum is defined by IMO as a solar longitude
// (J2000), so the instant is solved per year rather than pinned to a calendar
// date. Real maxima still scatter by hours, hence the "night-range" contract.
const MAJOR_SHOWERS: ShowerDefinition[] = [
  { id: "quadrantids", name: "象限仪座流星雨", peakMonth: 1, peakDay: 3, solarLongitude: 283.15, activeStart: [12, 28], activeEnd: [1, 12], zenithalHourlyRate: 80, radiant: "牧夫座北部", radiantRa: 15.33, radiantDec: 49, viewingAdvice: "后半夜辐射点升高，面向东北至天顶的大范围天空观察。" },
  { id: "lyrids", name: "天琴座流星雨", peakMonth: 4, peakDay: 22, solarLongitude: 32.32, activeStart: [4, 14], activeEnd: [4, 30], zenithalHourlyRate: 18, radiant: "天琴座", radiantRa: 18.07, radiantDec: 34, viewingAdvice: "午夜后辐射点逐渐升高，避开月亮并使用广角构图。" },
  { id: "eta-aquariids", name: "宝瓶座 η 流星雨", peakMonth: 5, peakDay: 6, solarLongitude: 45.5, activeStart: [4, 19], activeEnd: [5, 28], zenithalHourlyRate: 50, radiant: "宝瓶座", radiantRa: 22.53, radiantDec: -1, viewingAdvice: "中国多数地区以黎明前低空窗口为主，南方观测条件更好。" },
  { id: "perseids", name: "英仙座流星雨", peakMonth: 8, peakDay: 13, solarLongitude: 140.0, activeStart: [7, 17], activeEnd: [8, 24], zenithalHourlyRate: 100, radiant: "英仙座", radiantRa: 3.2, radiantDec: 58, viewingAdvice: "午夜后至晨光前辐射点较高，选择开阔北向天空。" },
  { id: "orionids", name: "猎户座流星雨", peakMonth: 10, peakDay: 21, solarLongitude: 208, activeStart: [10, 2], activeEnd: [11, 7], zenithalHourlyRate: 20, radiant: "猎户座", radiantRa: 6.33, radiantDec: 16, viewingAdvice: "后半夜猎户座升高，镜头避开明月可提升暗流星对比度。" },
  { id: "leonids", name: "狮子座流星雨", peakMonth: 11, peakDay: 17, solarLongitude: 235.27, activeStart: [11, 6], activeEnd: [11, 30], zenithalHourlyRate: 15, radiant: "狮子座", radiantRa: 10.13, radiantDec: 22, viewingAdvice: "黎明前辐射点最高，普通年份不应按历史暴雨强度做期待。" },
  { id: "geminids", name: "双子座流星雨", peakMonth: 12, peakDay: 14, solarLongitude: 262.2, activeStart: [12, 4], activeEnd: [12, 20], zenithalHourlyRate: 150, radiant: "双子座", radiantRa: 7.47, radiantDec: 33, viewingAdvice: "入夜后即可拍摄，午夜前后辐射点更高且持续时间长。" },
];
const chinaYearFormatter = new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Shanghai" });

const MINUTE = 60_000;
const eclipticRotation = Rotation_EQJ_ECL();

function chinaNight(year: number, month: number, day: number, hour = 23) {
  return new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00+08:00`);
}

function boundaryYear(peakYear: number, boundaryMonth: number, peakMonth: number, isStart: boolean) {
  if (isStart && boundaryMonth > peakMonth) return peakYear - 1;
  if (!isStart && boundaryMonth < peakMonth) return peakYear + 1;
  return peakYear;
}

/** Apparent geocentric solar longitude referred to the J2000 ecliptic, as IMO tabulates it. */
export function solarLongitudeJ2000(at: Date) {
  return SphereFromVector(RotateVector(eclipticRotation, GeoVector(Body.Sun, at, true))).lon;
}

/** Newton iteration from the catalogue date; the Sun moves ~0.9856° per day so it converges in a few steps. */
export function solarLongitudeInstant(target: number, guess: Date) {
  let time = guess.getTime();
  for (let index = 0; index < 8; index += 1) {
    const difference = ((target - solarLongitudeJ2000(new Date(time)) + 540) % 360) - 180;
    time += difference / 0.98561 * 86_400_000;
    if (Math.abs(difference) < 1e-5) break;
  }
  return new Date(time);
}

function sunAltitude(at: Date, observer: Observer) {
  const sun = Equator(Body.Sun, at, observer, true, true);
  return Horizon(at, observer, sun.ra, sun.dec).altitude;
}

/**
 * Observed rates scale with the sine of radiant altitude, so the best viewing
 * instant is the dark (sun < −12°) moment near the maximum with the radiant
 * highest, discounted by one degree per hour away from the maximum.
 */
function bestViewingInstant(peak: Date, observer: Observer, radiantRa: number, radiantDec: number) {
  for (const span of [12, 24]) {
    let best: { at: Date; value: number } | null = null;
    for (let offset = -span * 60; offset <= span * 60; offset += 10) {
      const at = new Date(peak.getTime() + offset * MINUTE);
      if (sunAltitude(at, observer) > -12) continue;
      const altitude = Horizon(at, observer, radiantRa, radiantDec, "normal").altitude;
      if (altitude <= 0) continue;
      const value = altitude - Math.abs(offset) / 60;
      if (!best || value > best.value) best = { at, value };
    }
    if (best) return best.at;
  }
  return peak;
}

export function getMeteorShowers(city: City, at = new Date()): MeteorShowerForecast[] {
  const chinaYear = Number(chinaYearFormatter.format(at));
  const observer = new Observer(city.latitude, city.longitude, 0);
  return [chinaYear - 1, chinaYear, chinaYear + 1]
    .flatMap((year) => MAJOR_SHOWERS.map((definition) => {
      const peak = solarLongitudeInstant(definition.solarLongitude, chinaNight(year, definition.peakMonth, definition.peakDay, 12));
      const startYear = boundaryYear(year, definition.activeStart[0], definition.peakMonth, true);
      const endYear = boundaryYear(year, definition.activeEnd[0], definition.peakMonth, false);
      const activeStart = chinaNight(startYear, definition.activeStart[0], definition.activeStart[1], 0);
      const activeEnd = chinaNight(endYear, definition.activeEnd[0], definition.activeEnd[1], 23);
      const viewing = bestViewingInstant(peak, observer, definition.radiantRa, definition.radiantDec);
      const radiant = Horizon(viewing, observer, definition.radiantRa, definition.radiantDec, "normal");
      return {
        id: `${definition.id}-${year}`,
        name: definition.name,
        peak: peak.toISOString(),
        activeStart: activeStart.toISOString(),
        activeEnd: activeEnd.toISOString(),
        peakPrecision: "night-range" as const,
        solarLongitude: definition.solarLongitude,
        bestViewing: viewing.toISOString(),
        zenithalHourlyRate: definition.zenithalHourlyRate,
        radiant: definition.radiant,
        radiantAltitude: radiant.altitude,
        radiantAzimuth: radiant.azimuth,
        viewingAdvice: definition.viewingAdvice,
        moonIllumination: Math.round(Illumination(Body.Moon, viewing).phase_fraction * 100),
        source: `IMO 主要流星雨年表；极大按太阳黄经 ${definition.solarLongitude}°（J2000）解算，实际峰值可偏差数小时`,
      };
    }))
    .filter((event) => new Date(event.activeEnd).getTime() >= at.getTime())
    .sort((a, b) => new Date(a.peak).getTime() - new Date(b.peak).getTime())
    .slice(0, 8);
}
