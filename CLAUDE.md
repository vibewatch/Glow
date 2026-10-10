# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

霁光 (Glow) PRO — a landscape-photography planning workspace for China. Next.js 16 App Router, React 19, TypeScript strict, no UI framework and no CSS framework: one hand-written `app/globals.css` with design tokens. All user-facing copy is Simplified Chinese, and the e2e tests assert on those exact Chinese strings.

## Commands

```bash
npm run dev            # next dev
npm run lint           # eslint (flat config, next core-web-vitals + typescript)
npm run typecheck      # next typegen + tsc --noEmit
npm test               # vitest run lib app  (node environment)
npm run build && npm run test:e2e   # Playwright needs the static export
npm run check          # lint + typecheck + test + build
npm run verify         # check + test:e2e + verify:audit  (the full gate)
```

Single tests:

```bash
npx vitest run lib/weather.test.ts
npx vitest run -t "continues with one weather model"
npx playwright test e2e/glow.spec.ts -g "weather workspace"
```

Playwright's `webServer` runs `npm run start` (a static file preview of `out/`) with `reuseExistingServer: false`, so build first. Tests intercept public providers with raw deterministic fixtures; all calculations still run in the browser. `npm run verify:audit` reads `test-results/playwright-results.json`, so it is only meaningful after a **full**, unfiltered `test:e2e` run.

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
NOAA SWPC Kp  → lib/space-weather.ts → SpaceWeatherResponse (separate browser request, separate failure domain)
```

`lib/types.ts` is the single contract between browser data processing and UI — start there when tracing anything.

The app is backend-free: `output: "export"` generates `out/`, and `.github/workflows/pages.yml` publishes it to `https://glow.genisisiq.com`. There are no local API routes or private provider keys. Data sources must allow browser CORS requests.

- `lib/browser-data.ts` — validates coordinates with `isWithinChina()`, caches at most 20 locations for 10 minutes in page memory (invalidated at China midnight), and supports abort/forced refresh. No shared cache or per-IP rate limit.
- `spaceWeatherForecast()` — independently caches NOAA for 15 minutes; logs failures and returns `unavailableSpaceWeather()` for 2 minutes, without breaking ordinary weather.

### Scoring model convention

Scoring lives in pure, dependency-free functions: `lib/glow-model.ts` (dawn/dusk glow), `lib/photography-models.ts` (fog, moon, nightscape), `lib/weather-analysis.ts` (cloud, rain, rainbow). They all return `ScoreResult { probability, rawScore, completeness, contributions[] }`, where each contribution carries a name, signed value, direction and human-readable detail so the UI can explain the number.

Two rules these share, and any new scorer must follow:

- **A missing input is not a zero.** Each factor adds to `knownWeight` only when present; the final score is pulled toward neutral in proportion to what is missing, and `confidenceFromScores()` further discounts by model disagreement and forecast lead days.
- **Every model is scored independently, then averaged.** Disagreement between ECMWF and CMA is the uncertainty signal — `modelScores[]` is preserved in the response.

### Time handling

Open-Meteo returns naive local strings (`"2026-08-03T05:20"`); ISO instants end in `Z`. Both `lib/opportunities.ts` and `components/workspace-common.tsx` define a `forecastInstant()` that appends `:00+08:00` when there is no `Z`. All display formatting goes through `Intl` with `timeZone: "Asia/Shanghai"` — never rely on the host timezone.

### Map

`components/weather-map.tsx` (MapLibre GL, dynamically imported with `ssr: false`). Bearing lines are a **DOM overlay** re-projected on every `move`, not GeoJSON layers — an earlier double-drawn implementation was removed, so don't reintroduce map-layer direction lines. Only the currently selected item's direction is drawn; line length carries no distance meaning. Bounds are locked to China (`maxBounds: [[69,12],[140,57]]`).

The basemap is OpenFreeMap vector tiles. MapLibre 6 cannot locate its tile worker from inside the Next bundle, so `scripts/copy-maplibre-worker.mjs` (run by `predev`/`prebuild`) copies `maplibre-gl-worker.mjs` + `maplibre-gl-shared.mjs` into the git-ignored `public/maplibre/`, and the map calls `setWorkerUrl()`. If the map is blank but style/sprite requests succeed and no `.pbf` tiles are fetched, the worker failed to load.

### Security

`scripts/secure-static-export.mjs` runs after build and inserts CSP meta before all scripts in each exported HTML, authorizing inline Next bootstrap scripts with SHA-256 hashes. `e2e/security.spec.ts` verifies hashes, blocks untrusted inline scripts/handlers and confirms no backend routes exist. Rebuild hashes after changing exported HTML. GitHub Pages controls HTTP-only policies (HSTS, COOP, anti-framing); meta CSP cannot provide them. Never expose private keys through browser code or `NEXT_PUBLIC_*`.

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

- `docs/data-research.md` — why these sources, non-commercial Open-Meteo licensing, browser CORS, and per-source limits.
- `docs/weather-tools-architecture.md` — the three-workspace decision, shared state model, extension contract.
- `docs/professional-photography-audit.md` — the review matrix, including the P0/P1 gaps deliberately left unimplemented (light pollution, terrain horizon, Milky Way geometry, persistence/sharing, score calibration).
