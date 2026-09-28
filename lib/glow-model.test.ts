import { describe, expect, it } from "vitest";
import { GLOW_LAYERS, confidenceFromScores, grazingHeightKm, rayHeightKm, scoreGlow, shadowCutoffAltitude } from "./glow-model";
import type { LightPathSample, SkyMetrics } from "./types";

const ideal: SkyMetrics = {
  lowCloud: 8,
  midCloud: 52,
  highCloud: 54,
  humidity: 58,
  visibility: 30000,
  precipitationProbability: 4,
  precipitation: 0,
  aerosolOpticalDepth: 0.22,
  pm25: 18,
};

describe("glow scoring model", () => {
  it("rewards textured upper cloud and a clear horizon", () => {
    expect(scoreGlow(ideal, "dusk").probability).toBeGreaterThan(65);
  });

  it("strongly penalises a blocked, rainy horizon", () => {
    const blocked = scoreGlow({
      ...ideal,
      lowCloud: 94,
      precipitationProbability: 88,
      precipitation: 2.4,
      humidity: 96,
      visibility: 3000,
    }, "dawn");
    expect(blocked.probability).toBeLessThan(25);
  });

  it("peaks just before the colour decks enter the earth's shadow, not at an arbitrary plateau", () => {
    const series = Array.from({ length: 76 }, (_, index) => 8 - index * 0.2).map((solarAltitude) => ({ solarAltitude, probability: scoreGlow(ideal, "dusk", { solarAltitude }).probability }));
    const peak = series.reduce((best, item) => item.probability > best.probability ? item : best);
    // Mid deck (4.5 km) leaves direct sunlight near −2.9°, the high deck (9 km) near −3.9°.
    expect(peak.solarAltitude).toBeLessThan(-2);
    expect(peak.solarAltitude).toBeGreaterThan(-4.2);
    const daylight = series.find((item) => Math.abs(item.solarAltitude - 8) < 0.01)!;
    const shadow = series.at(-1)!;
    expect(daylight.probability).toBeLessThan(peak.probability - 15);
    expect(shadow.probability).toBeLessThan(peak.probability - 20);
    const late = scoreGlow(ideal, "dusk", { solarAltitude: -7 });
    expect(late.contributions.find((item) => item.name === "光照几何")?.value).toBeLessThan(-20);
    expect(late.contributions.find((item) => item.name === "光照几何")?.detail).toContain("地影");
  });

  it("derives shadow cutoffs from ray geometry with refraction", () => {
    const [mid, high] = GLOW_LAYERS.map((layer) => shadowCutoffAltitude(layer.heightKm));
    expect(mid).toBeCloseTo(-2.9, 0);
    expect(high).toBeLessThan(mid);
    expect(high).toBeGreaterThan(-4.5);
    expect(grazingHeightKm(4.5, 1)).toBe(4.5);
    expect(grazingHeightKm(4.5, mid)).toBeCloseTo(0.5, 1);
    // At −2.7° the ray lighting a 4.5 km deck grazes the low-cloud band ~200–300 km toward the sun,
    // while before sunset the same distances are crossed far above any cloud.
    expect(rayHeightKm(4.5, -2.7, 220)).toBeLessThan(2);
    expect(rayHeightKm(4.5, -2.7, 40)).toBeGreaterThan(2);
    expect(rayHeightKm(4.5, 3, 220)).toBeGreaterThan(13);
  });

  it("penalises a sunward light path blocked by a distant cloud bank, and treats an unknown path as unknown", () => {
    const clear: LightPathSample[] = [40, 120, 220, 350].map((distanceKm) => ({ distanceKm, lowCloud: 0, midCloud: 5, highCloud: 10 }));
    // A frontal bank 120–350 km toward the sun; the grazing ray passes through its 2–6 km layer.
    const blocked: LightPathSample[] = clear.map((sample) => sample.distanceKm >= 120 ? { ...sample, lowCloud: 95, midCloud: 90 } : sample);
    const open = scoreGlow(ideal, "dusk", { solarAltitude: -2.2, path: clear });
    const shut = scoreGlow(ideal, "dusk", { solarAltitude: -2.2, path: blocked });
    const unknown = scoreGlow(ideal, "dusk", { solarAltitude: -2.2, path: null });
    expect(shut.probability).toBeLessThan(open.probability - 12);
    expect(shut.contributions.find((item) => item.name === "远方光路")?.detail).toMatch(/主要遮挡 .*km 中云/);
    expect(unknown.contributions.some((item) => item.name === "远方光路")).toBe(false);
    expect(unknown.completeness).toBeLessThan(open.completeness);
    // Before sunset the same distant low cloud sits below the ray and should not matter.
    const early = scoreGlow(ideal, "dusk", { solarAltitude: 3, path: blocked });
    const earlyOpen = scoreGlow(ideal, "dusk", { solarAltitude: 3, path: clear });
    expect(Math.abs(early.probability - earlyOpen.probability)).toBeLessThanOrEqual(2);
  });

  it("does not reward low surface humidity as a direct cause of vivid glow", () => {
    const dry = scoreGlow({ ...ideal, humidity: 30 }, "dawn");
    expect(dry.contributions.find((item) => item.name === "近地湿度")?.value).toBe(0);
  });

  it("does not treat missing observations as perfect conditions", () => {
    const missing = scoreGlow({
      lowCloud: null,
      midCloud: null,
      highCloud: null,
      humidity: null,
      visibility: null,
      precipitationProbability: null,
      precipitation: null,
      aerosolOpticalDepth: null,
      pm25: null,
    }, "dusk");
    expect(missing.completeness).toBe(0);
    expect(missing.probability).toBeLessThan(50);
  });

  it("reduces confidence when models disagree and lead time grows", () => {
    const high = scoreGlow(ideal, "dusk");
    const low = scoreGlow({ ...ideal, lowCloud: 100, precipitationProbability: 100 }, "dusk");
    expect(confidenceFromScores([high, low], 5)).toBeLessThan(confidenceFromScores([high, high], 0));
  });
});
