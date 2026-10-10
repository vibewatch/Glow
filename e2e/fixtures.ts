import { test as base, expect } from "@playwright/test";

export { expect };

export const test = base.extend({
  page: async ({ page }, run) => {
    await page.route("https://*.open-meteo.com/**", async (route) => {
      const url = new URL(route.request().url());
      const start = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
      const times = Array.from({ length: 168 }, (_, index) => new Date(Date.parse(`${start}T00:00:00Z`) + index * 3_600_000).toISOString().slice(0, 16));
      const dates = times.filter((_, index) => index % 24 === 0).map((time) => time.slice(0, 10));
      const values: Record<string, number> = {
        temperature_2m: 20, dew_point_2m: 12, cloud_cover: 45,
        cloud_cover_low: 10, cloud_cover_mid: 40, cloud_cover_high: 55,
        relative_humidity_2m: 60, visibility: 30_000, precipitation_probability: 5,
        precipitation: 0, rain: 0, showers: 0, weather_code: 1,
        direct_radiation: 180, wind_speed_10m: 9, wind_gusts_10m: 16,
        wind_direction_10m: 315, surface_pressure: 1002,
        aerosol_optical_depth: .2, pm2_5: 18,
      };
      const hourly = Object.fromEntries((url.searchParams.get("hourly") ?? "").split(",")
        .map((field) => [field, times.map((_, index) => {
          const hour = index % 24;
          if (field === "direct_radiation" && (hour < 7 || hour >= 18)) return 0;
          if (hour === 16) {
            if (field === "precipitation" || field === "showers") return .6;
            if (field === "precipitation_probability") return 65;
            if (field === "weather_code") return 80;
          }
          return values[field];
        })]));
      const payload = {
        elevation: 47,
        hourly: { time: times, ...hourly },
        daily: { time: dates, sunrise: dates.map((date) => `${date}T06:00`), sunset: dates.map((date) => `${date}T18:00`) },
      };
      const points = url.searchParams.get("latitude")?.split(",").length ?? 1;
      await route.fulfill({ json: points > 1 ? Array.from({ length: points }, () => payload) : payload });
    });
    await page.route("https://services.swpc.noaa.gov/**", (route) => route.fulfill({ json: [
      ["time_tag", "Kp", "observed", "noaa_scale"],
      [new Date().toISOString(), "3.33", "observed", null],
      [new Date(Date.now() + 24 * 3_600_000).toISOString(), "6.00", "predicted", "G2"],
    ] }));
    await run(page);
  },
});
