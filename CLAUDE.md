# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

霁光 (Glow) PRO — a landscape-photography planning workspace for China. Next.js 16 App Router, React 19, TypeScript strict, no UI framework and no CSS framework: one hand-written `app/globals.css` with design tokens. All user-facing copy is Simplified Chinese, and the e2e tests assert on those exact Chinese strings.

## Commands

```bash
npm run dev            # next dev
npm run lint           # eslint (flat config, next core-web-vitals + typescript)
npm run typecheck      # tsc --noEmit
npm test               # vitest run lib app  (node environment)
npm run build && npm run test:e2e   # Playwright needs a production server
npm run check          # lint + typecheck + test + build
npm run verify         # check + test:e2e + verify:audit  (the full gate)
```

Single tests:

```bash
npx vitest run lib/weather.test.ts
npx vitest run -t "continues with one weather model"
npx playwright test e2e/glow.spec.ts -g "weather workspace"
```

Playwright's `webServer` runs `npm run start` with `reuseExistingServer: true`, so build first (or leave a `next start` running). `npm run verify:audit` reads `test-results/playwright-results.json`, so it is only meaningful after a **full**, unfiltered `test:e2e` run.

## Architecture

### One page, three workspaces, shared context

`app/page.tsx` renders a single client component, `components/glow-dashboard.tsx`, which owns *all* state: location, `selectedIndex` (day 0–6), `selectedInstant`, `weatherTime`, `weatherView`, `selectedEventId`, plus load status and the independent space-weather status. Switching workspaces never navigates or refetches.

The shell is a fixed grid — top bar / catalog rail / map canvas / inspector / timeline dock. Each workspace supplies the same triple, which the dashboard slots into that grid:

| Workspace | File | Exports |
| --- | --- | --- |
| 每日拍摄机会 | `components/opportunity-workspace.tsx` | `OpportunityCatalog` / `OpportunityPanel` / `OpportunityDock` |
| 专业天气 | `components/weather-workspace.tsx` | `WeatherCatalog` / `WeatherPanel` / `WeatherDock` |
| 罕见天象 | `components/events-workspace.tsx` | `EventsCatalog` / `EventsPanel` / `EventsDock` |

`components/workspace-common.tsx` holds the shared primitives (`DateTabs`, `FieldBriefing`, `SourceDisclosure`) and the shared time helpers. `components/insight-graphics.tsx` holds the inspector's figures (`GlowProfile` light-path cross-section, `WindowRibbon`, `FactorBars`, `ModelAgreement`, `SkyDome`, `InsightSection`); the inspector is laid out as hairline-separated sections, not boxed cards. Adding a workspace means adding to the `WORKSPACES` registry *and* to `scripts/verify-audit-coverage.mjs` (see Verification gate).

### Data flow

```
Open-Meteo (ECMWF IFS HRES 9km + CMA GRAPES 15km + NOAA GFS + DWD ICON + CAMS air quality,
            plus 4 light-path points 40/120/220/350 km toward sunrise/sunset azimuth)
  → lib/weather.ts        getForecast() → ForecastResponse (7 days + 168 hourly + sources + provenance)
  → lib/opportunities.ts  buildDailyOpportunities(day, city, spaceWeather) → 9 DailyOpportunity, sorted by peak
NOAA SWPC Kp  → lib/space-weather.ts → SpaceWeatherResponse (separate route, separate failure domain)
```

`lib/types.ts` is the single contract between server and client — start there when tracing anything.

Two API routes, deliberately independent so an aurora/space-weather outage never 503s the ordinary weather:

- `app/api/forecast/route.ts` — validates the city or `lat`/`lon`, gates coordinates through `isWithinChina()` (400 outside), applies an in-memory per-IP rate limit to coordinate requests (90/min, per instance only), caches `s-maxage=1800`.
- `app/api/space-weather/route.ts` — on any failure returns `unavailableSpaceWeather()` with HTTP 200 and `status: "unavailable"`, never an error status.

### Scoring model convention

Scoring lives in pure, dependency-free functions: `lib/glow-model.ts` (dawn/dusk glow), `lib/photography-models.ts` (fog, moon, nightscape), `lib/weather-analysis.ts` (cloud, rain, rainbow). They all return `ScoreResult { probability, rawScore, completeness, contributions[] }`, where each contribution carries a name, signed value, direction and human-readable detail so the UI can explain the number.

Two rules these share, and any new scorer must follow:

- **A missing input is not a zero.** Each factor adds to `knownWeight` only when present; the final score is pulled toward neutral in proportion to what is missing, and `confidenceFromScores()` further discounts by model disagreement and forecast lead days.
- **Every model is scored independently, then averaged.** Disagreement between ECMWF and CMA is the uncertainty signal — `modelScores[]` is preserved in the response.

### Time handling

Open-Meteo returns naive local strings (`"2026-08-03T05:20"`); ISO instants end in `Z`. Both `lib/opportunities.ts` and `components/workspace-common.tsx` define a `forecastInstant()` that appends `:00+08:00` when there is no `Z`. All display formatting goes through `Intl` with `timeZone: "Asia/Shanghai"` — never rely on the host timezone.

### Map

`components/weather-map.tsx` (MapLibre GL, dynamically imported with `ssr: false`). Bearing lines are a **DOM overlay** re-projected on every `move`, not GeoJSON layers — an earlier double-drawn implementation was removed, so don't reintroduce map-layer direction lines. Only the currently selected item's direction is drawn; line length carries no distance meaning. Bounds are locked to China (`maxBounds: [[69,12],[140,57]]`).

The basemap is OpenFreeMap vector tiles. MapLibre 6 cannot locate its tile worker from inside the Next bundle, so `scripts/copy-maplibre-worker.mjs` (run by `predev`/`prebuild`) copies `maplibre-gl-worker.mjs` + `maplibre-gl-shared.mjs` into the git-ignored `public/maplibre/`, and the map calls `setWorkerUrl()`. `proxy.ts` excludes `/maplibre/` so the worker's module import is not subject to the document's nonce CSP. If the map is blank but style/sprite requests succeed and no `.pbf` tiles are fetched, the worker failed to load.

### Security

`proxy.ts` is Next.js 16's middleware equivalent: it mints a per-request nonce and sets a `strict-dynamic` CSP; `next.config.ts` adds the static headers. `e2e/security.spec.ts` asserts the nonce is unique per request, that every server-rendered `<script>` carries it, and that an injected inline handler is blocked. Inline `<script>` without the nonce and inline event attributes will fail that test.

## Data-honesty constraints

These are product invariants, enforced by tests and documented in `docs/`. Violating them is a correctness bug, not a style issue:

- Scores are **机会指数 (opportunity index)**, an explainable heuristic — never present them as calibrated probability. Purely astronomical items use `scoreType: "geometry-only"` with `score: null` instead of a fake number.
- An unavailable source degrades to an explicit "unavailable" state; it never becomes a 0 score or silently vanishes.
- Never interpolate the single-point 168h forecast into area cloud/rain/wind layers. Regional map layers require a licensed raster/tile service with documented resolution and timestamps.
- Every `DailyOpportunity` carries a `limitation` string stating what the data cannot prove (terrain occlusion, rain-curtain position, light pollution, aurora oval, …).
- Meteor-shower peaks are `peakPrecision: "night-range"`; ZHR is an ideal-sky figure, not an expected observed count.

## Verification gate

`scripts/verify-audit-coverage.mjs` cross-checks the green exit code against actual coverage, and **its expectations are hardcoded**:

- the three workspace ids, matched by regex against `components/glow-dashboard.tsx`;
- exactly 22 Playwright specs, all passing;
- exactly 82 UI-audit screenshots across 8 viewports (320×568 → 1920×1080), per-viewport counts in `expectedScreenshots`.

Adding or removing a spec, workspace, or audit state means updating that script in the same change. `docs/weather-tools-architecture.md` states the extension contract for new features: pure-function + degradation tests, API/source validation, desktop/mobile interaction plus an Axe scan, the screenshot matrix, and explicit units, freshness, source and limitations.

## Reference docs

- `docs/data-research.md` — why these sources, licensing (Open-Meteo open vs. `OPEN_METEO_API_KEY` customer endpoints), and per-source limits.
- `docs/weather-tools-architecture.md` — the three-workspace decision, shared state model, extension contract.
- `docs/professional-photography-audit.md` — the review matrix, including the P0/P1 gaps deliberately left unimplemented (light pollution, terrain horizon, Milky Way geometry, persistence/sharing, score calibration).
