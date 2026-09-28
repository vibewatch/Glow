import { describe, expect, it } from "vitest";
import { chinaMinute, getAstronomy, getMoonGeometry, getSolarAltitude, getSolarWindow, solarAltitudeCrossing } from "./astronomy";
import { CITIES } from "./cities";

describe("location-aware astronomy", () => {
  const beijing = CITIES[0];
  const at = new Date("2026-08-03T00:00:00Z");

  it("calculates the moon and next locally visible eclipses", () => {
    const result = getAstronomy(beijing, at);
    expect(new Date(result.nextSolarEclipse.peak).getTime()).toBeGreaterThan(at.getTime());
    expect(result.nextSolarEclipse.visible).toBe(true);
    expect(result.nextSolarEclipse.azimuth).toBeGreaterThanOrEqual(0);
    expect(result.nextLunarEclipse.visible).toBe(true);
    expect(result.meteorShowers).toHaveLength(8);
    expect(result.meteorShowers[0].peakPrecision).toBe("night-range");
    expect(result.meteorShowers[0].radiantAzimuth).toBeGreaterThanOrEqual(0);
  });

  it("calculates moon geometry for the selected forecast night", () => {
    const first = getMoonGeometry(beijing, new Date("2026-08-03T14:00:00Z"), "2026-08-03");
    const later = getMoonGeometry(beijing, new Date("2026-08-08T14:00:00Z"), "2026-08-08");
    expect(first.calculatedAt).not.toBe(later.calculatedAt);
    expect(first.illumination).not.toBe(later.illumination);
    expect(first.rise?.startsWith("2026-08-03")).toBe(true);
    expect(later.rise?.startsWith("2026-08-08")).toBe(true);
  });

  it("derives blue and golden-hour crossings for the selected day", () => {
    const window = getSolarWindow(beijing, "2026-08-03");
    // Beijing 2026-08-03: sunrise ≈ 05:14, sunset ≈ 19:26 CST (upper limb with standard refraction).
    expect(chinaMinute(new Date(window.sunriseAt!))).toMatch(/^2026-08-03T05:1[3-5]$/);
    expect(chinaMinute(new Date(window.sunsetAt!))).toMatch(/^2026-08-03T19:2[5-7]$/);
    expect(window.daylightMinutes).toBeGreaterThan(849);
    expect(window.daylightMinutes).toBeLessThan(855);
    expect(window.morningBlueStart).not.toBeNull();
    expect(window.eveningBlueEnd).not.toBeNull();
    expect(window.eveningAstronomicalStart).not.toBeNull();
    expect(window.morningAstronomicalEnd).not.toBeNull();
    expect(window.astronomicalDarknessMinutes).toBeGreaterThan(200);
    expect(window.sunriseAzimuth).toBeGreaterThan(0);
    expect(window.sunsetAzimuth).toBeGreaterThan(180);
    expect(getSolarAltitude(beijing, new Date(window.eveningAstronomicalStart!))).toBeCloseTo(-18, 1);
  });

  it("finds geometric solar altitude crossings used to bound the twilight scan", () => {
    const crossing = solarAltitudeCrossing(beijing, "2026-08-03", -1, -3);
    expect(crossing).not.toBeNull();
    expect(getSolarAltitude(beijing, crossing!)).toBeCloseTo(-3, 1);
  });
});
