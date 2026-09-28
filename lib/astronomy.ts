import {
  Body,
  Equator,
  Horizon,
  Illumination,
  MoonPhase,
  NextLocalSolarEclipse,
  NextLunarEclipse,
  Observer,
  SearchAltitude,
  SearchLocalSolarEclipse,
  SearchLunarEclipse,
  SearchRiseSet,
} from "astronomy-engine";
import type { AstronomySummary, City, EclipseForecast, MoonGeometry, SolarWindow } from "@/lib/types";
import { getMeteorShowers } from "@/lib/meteor-showers";

const observerCache = new WeakMap<City, Observer>();

function observerFor(city: City) {
  let observer = observerCache.get(city);
  if (!observer) {
    observer = new Observer(city.latitude, city.longitude, 0);
    observerCache.set(city, observer);
  }
  return observer;
}

function localDateStart(date: Date, dateKey?: string) {
  const china = dateKey ?? new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return new Date(`${china}T00:00:00+08:00`);
}

function horizontal(body: Body, date: Date, observer: Observer, applyRefraction = true) {
  const equatorial = Equator(body, date, observer, true, true);
  return Horizon(date, observer, equatorial.ra, equatorial.dec, applyRefraction ? "normal" : undefined);
}

function phaseName(angle: number) {
  if (angle < 22.5 || angle >= 337.5) return "新月";
  if (angle < 67.5) return "娥眉月";
  if (angle < 112.5) return "上弦月";
  if (angle < 157.5) return "盈凸月";
  if (angle < 202.5) return "满月";
  if (angle < 247.5) return "亏凸月";
  if (angle < 292.5) return "下弦月";
  return "残月";
}

function visibleLunarEclipse(start: Date, observer: Observer): EclipseForecast {
  let eclipse = SearchLunarEclipse(start);
  let position = horizontal(Body.Moon, eclipse.peak.date, observer);
  for (let index = 0; index < 12 && position.altitude <= 0; index += 1) {
    eclipse = NextLunarEclipse(eclipse.peak);
    position = horizontal(Body.Moon, eclipse.peak.date, observer);
  }
  const halfDuration = eclipse.sd_penum || eclipse.sd_partial || eclipse.sd_total;
  return {
    kind: eclipse.kind,
    peak: eclipse.peak.date.toISOString(),
    begin: new Date(eclipse.peak.date.getTime() - halfDuration * 60000).toISOString(),
    end: new Date(eclipse.peak.date.getTime() + halfDuration * 60000).toISOString(),
    obscuration: eclipse.obscuration,
    altitude: position.altitude,
    azimuth: position.azimuth,
    visible: position.altitude > 0,
  };
}

function visibleSolarEclipse(start: Date, observer: Observer): EclipseForecast {
  let eclipse = SearchLocalSolarEclipse(start, observer);
  for (let index = 0; index < 12 && eclipse.peak.altitude <= 0; index += 1) {
    eclipse = NextLocalSolarEclipse(eclipse.peak.time, observer);
  }
  const position = horizontal(Body.Sun, eclipse.peak.time.date, observer);
  return {
    kind: eclipse.kind,
    peak: eclipse.peak.time.date.toISOString(),
    begin: eclipse.partial_begin.time.date.toISOString(),
    end: eclipse.partial_end.time.date.toISOString(),
    obscuration: eclipse.obscuration,
    altitude: eclipse.peak.altitude,
    azimuth: position.azimuth,
    visible: eclipse.peak.altitude > 0,
  };
}

export function getMoonGeometry(city: City, at: Date, dateKey?: string): MoonGeometry {
  const observer = observerFor(city);
  const moonPosition = horizontal(Body.Moon, at, observer);
  const phaseAngle = MoonPhase(at);
  const illumination = Illumination(Body.Moon, at).phase_fraction;
  const start = localDateStart(at, dateKey);
  const moonrise = SearchRiseSet(Body.Moon, observer, 1, start, 1.25);
  const moonset = SearchRiseSet(Body.Moon, observer, -1, start, 1.25);
  return {
    calculatedAt: at.toISOString(),
    phaseAngle,
    phaseName: phaseName(phaseAngle),
    illumination: Math.round(illumination * 100),
    altitude: moonPosition.altitude,
    azimuth: moonPosition.azimuth,
    rise: moonrise?.date.toISOString() ?? null,
    set: moonset?.date.toISOString() ?? null,
  };
}

export function getMoonPosition(city: City, at: Date) {
  const observer = observerFor(city);
  const position = horizontal(Body.Moon, at, observer);
  return {
    altitude: position.altitude,
    azimuth: position.azimuth,
    illumination: Math.round(Illumination(Body.Moon, at).phase_fraction * 100),
  };
}

export function getAstronomy(city: City, at = new Date()): AstronomySummary {
  const observer = observerFor(city);
  return {
    nextLunarEclipse: visibleLunarEclipse(at, observer),
    nextSolarEclipse: visibleSolarEclipse(at, observer),
    meteorShowers: getMeteorShowers(city, at),
  };
}

function crossing(body: Body, observer: Observer, direction: 1 | -1, start: Date, altitude: number) {
  return SearchAltitude(body, observer, direction, start, 1, altitude)?.date.toISOString() ?? null;
}

function azimuthAt(date: Date, observer: Observer) {
  return horizontal(Body.Sun, date, observer).azimuth;
}

export function getSolarAltitude(city: City, at: Date) {
  return getSolarPosition(city, at).altitude;
}

export function getSolarPosition(city: City, at: Date) {
  const position = horizontal(Body.Sun, at, observerFor(city), false);
  return { altitude: position.altitude, azimuth: position.azimuth };
}

/** Naive Asia/Shanghai minute string, the same shape Open-Meteo returns ("2026-08-03T05:20"). */
export function chinaMinute(value: Date) {
  return new Date(Math.round(value.getTime() / 60_000) * 60_000 + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

/** First time after local midnight of `date` the geometric solar centre crosses `altitude` in `direction`. */
export function solarAltitudeCrossing(city: City, date: string, direction: 1 | -1, altitude: number) {
  const start = new Date(`${date}T${direction === 1 ? "00" : "12"}:00:00+08:00`);
  return SearchAltitude(Body.Sun, observerFor(city), direction, start, 1, altitude)?.date ?? null;
}

export function getSunRiseSet(city: City, date: string) {
  const observer = observerFor(city);
  const sunrise = SearchRiseSet(Body.Sun, observer, 1, new Date(`${date}T00:00:00+08:00`), 1)?.date ?? null;
  const sunset = SearchRiseSet(Body.Sun, observer, -1, new Date(`${date}T12:00:00+08:00`), 1)?.date ?? null;
  return {
    sunrise,
    sunset,
    sunriseAzimuth: sunrise ? azimuthAt(sunrise, observer) : null,
    sunsetAzimuth: sunset ? azimuthAt(sunset, observer) : null,
  };
}

export function getSolarWindow(city: City, date: string): SolarWindow {
  const observer = observerFor(city);
  const start = new Date(`${date}T00:00:00+08:00`);
  const noon = new Date(`${date}T12:00:00+08:00`);
  const riseSet = getSunRiseSet(city, date);
  const eveningAstronomicalStart = crossing(Body.Sun, observer, -1, noon, -18);
  const morningAstronomicalEnd = crossing(Body.Sun, observer, 1, riseSet.sunset ?? noon, -18);
  const astronomicalDarknessMinutes = eveningAstronomicalStart && morningAstronomicalEnd
    ? Math.max(0, Math.round((new Date(morningAstronomicalEnd).getTime() - new Date(eveningAstronomicalStart).getTime()) / 60000))
    : 0;
  return {
    sunriseAt: riseSet.sunrise?.toISOString() ?? null,
    sunsetAt: riseSet.sunset?.toISOString() ?? null,
    morningBlueStart: crossing(Body.Sun, observer, 1, start, -6),
    sunriseAzimuth: riseSet.sunriseAzimuth,
    morningGoldenEnd: crossing(Body.Sun, observer, 1, start, 6),
    eveningGoldenStart: crossing(Body.Sun, observer, -1, noon, 6),
    sunsetAzimuth: riseSet.sunsetAzimuth,
    eveningBlueEnd: crossing(Body.Sun, observer, -1, noon, -6),
    eveningAstronomicalStart,
    morningAstronomicalEnd,
    astronomicalDarknessMinutes,
    daylightMinutes: riseSet.sunrise && riseSet.sunset ? Math.round((riseSet.sunset.getTime() - riseSet.sunrise.getTime()) / 60000) : 0,
  };
}
