import { describe, expect, it } from "vitest";
import { getMeteorShowers, solarLongitudeJ2000 } from "./meteor-showers";
import { CITIES } from "./cities";

// Reference values from the IMO 2026 visual meteor shower working list
// (radiant RA converted from degrees to hours; maxima as J2000 solar longitude
// and the UT date IMO lists for 2026). Locks the catalog against drift.
const IMO_REFERENCE: Record<string, { zhr: number; ra: number; dec: number; solarLongitude: number; utcDate: string }> = {
  象限仪座流星雨: { zhr: 80, ra: 15.33, dec: 49, solarLongitude: 283.15, utcDate: "2026-01-03" },
  天琴座流星雨: { zhr: 18, ra: 18.07, dec: 34, solarLongitude: 32.32, utcDate: "2026-04-22" },
  "宝瓶座 η 流星雨": { zhr: 50, ra: 22.53, dec: -1, solarLongitude: 45.5, utcDate: "2026-05-06" },
  英仙座流星雨: { zhr: 100, ra: 3.2, dec: 58, solarLongitude: 140, utcDate: "2026-08-13" },
  猎户座流星雨: { zhr: 20, ra: 6.33, dec: 16, solarLongitude: 208, utcDate: "2026-10-21" },
  狮子座流星雨: { zhr: 15, ra: 10.13, dec: 22, solarLongitude: 235.27, utcDate: "2026-11-17" },
  双子座流星雨: { zhr: 150, ra: 7.47, dec: 33, solarLongitude: 262.2, utcDate: "2026-12-14" },
};

describe("meteor shower catalog vs IMO reference", () => {
  const beijing = CITIES[0];
  // Reach every 2026 shower across a two-window sweep.
  const events = getMeteorShowers(beijing, new Date("2025-12-25T00:00:00Z"))
    .concat(getMeteorShowers(beijing, new Date("2026-06-01T00:00:00Z")))
    .filter((item) => item.id.endsWith("-2026"));

  it("solves each maximum from its IMO solar longitude instead of a fixed calendar hour", () => {
    for (const [name, ref] of Object.entries(IMO_REFERENCE)) {
      const event = events.find((item) => item.name === name);
      expect(event, `missing shower ${name}`).toBeTruthy();
      expect(event!.zenithalHourlyRate, `${name} ZHR`).toBe(ref.zhr);
      expect(event!.solarLongitude, `${name} λ☉`).toBe(ref.solarLongitude);
      expect(event!.peak.slice(0, 10), `${name} UT date`).toBe(ref.utcDate);
      const solved = solarLongitudeJ2000(new Date(event!.peak));
      expect(Math.abs(((solved - ref.solarLongitude + 540) % 360) - 180), `${name} λ☉ residual`).toBeLessThan(0.001);
    }
  });

  it("reports radiant geometry at a dark best-viewing instant near the maximum", () => {
    for (const event of events) {
      const offset = Math.abs(new Date(event.bestViewing).getTime() - new Date(event.peak).getTime());
      expect(offset, event.name).toBeLessThanOrEqual(24 * 3_600_000);
      expect(event.radiantAltitude, event.name).toBeGreaterThan(0);
      expect(event.peakPrecision).toBe("night-range");
    }
    const perseids = events.find((item) => item.name === "英仙座流星雨")!;
    // Beijing: Perseid radiant climbs all night, so the best hour is before dawn.
    const hour = Number(new Intl.DateTimeFormat("en", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Shanghai" }).format(new Date(perseids.bestViewing)));
    expect(hour).toBeGreaterThanOrEqual(1);
    expect(hour).toBeLessThanOrEqual(4);
    expect(perseids.radiantAltitude).toBeGreaterThan(45);
  });
});
