"use client";

import type { DailyOpportunity, EventForecast, LightPathSample, ScoreResult, SkyMetrics } from "@/lib/types";
import { GLOW_LAYERS, layerLight, rayHeightKm } from "@/lib/glow-model";
import { useLocale, type Locale } from "@/components/locale-context";
import { forecastInstant, localTime } from "@/components/workspace-common";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function signedDegrees(value: number) {
  return `${value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}°`;
}

function duration(start: string, end: string, locale: Locale) {
  const minutes = Math.max(0, Math.round((forecastInstant(end) - forecastInstant(start)) / 60_000));
  if (minutes < 60) return locale === "en" ? `${minutes} min` : `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  if (locale === "en") return minutes % 60 ? `${hours} hr ${minutes % 60} min` : `${hours} hr`;
  return minutes % 60 ? `${hours} 小时 ${minutes % 60} 分` : `${hours} 小时`;
}

/** Section wrapper: a hairline, a small caps label and content — no boxed card. */
export function InsightSection({ title, meta, label, className, children }: { title: string; meta?: string; label?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`insight-section${className ? ` ${className}` : ""}`} aria-label={label ?? title}>
      <header><h3>{title}</h3>{meta && <small>{meta}</small>}</header>
      {children}
    </section>
  );
}

/* Glow: index curve across the twilight ------------------------------------------ */

const CURVE_W = 320;
const CURVE_TOP = 10;
const CURVE_H = 58;

function GlowCurve({ event, horizonAt, cursor }: { event: EventForecast; horizonAt: string | null; cursor: number | null }) {
  const { locale, t } = useLocale();
  const points = event.timeline;
  const first = forecastInstant(points[0].time);
  const last = forecastInstant(points[points.length - 1].time);
  const x = (time: number) => (time - first) / Math.max(1, last - first) * CURVE_W;
  const y = (probability: number) => CURVE_TOP + (1 - probability / 100) * CURVE_H;
  const line = points.map((point) => `${x(forecastInstant(point.time)).toFixed(1)},${y(point.probability).toFixed(1)}`);
  const area = `M0,${CURVE_TOP + CURVE_H} L${line.join(" L")} L${CURVE_W},${CURVE_TOP + CURVE_H} Z`;
  const peakX = x(forecastInstant(event.time));
  const windowStart = x(forecastInstant(event.window.start));
  const windowEnd = x(forecastInstant(event.window.end));
  const horizon = horizonAt ? forecastInstant(horizonAt) : null;
  const horizonX = horizon !== null && horizon >= first && horizon <= last ? x(horizon) : null;
  const cursorX = cursor !== null && cursor >= first && cursor <= last ? x(cursor) : null;
  const horizonLabel = t(event.kind === "dawn" ? "日出" : "日落");
  return (
    <figure className="glow-curve">
      <svg viewBox={`0 0 ${CURVE_W} ${CURVE_TOP + CURVE_H + 2}`} role="img" aria-label={locale === "en" ? `${t(event.kind === "dawn" ? "朝霞" : "晚霞")} opportunity index over time, peak ${localTime(event.time)}, high-index window ${localTime(event.window.start)}–${localTime(event.window.end)}` : `${event.kind === "dawn" ? "朝霞" : "晚霞"}机会指数随时间变化，峰值 ${localTime(event.time)}，高指数窗口 ${localTime(event.window.start)}–${localTime(event.window.end)}`}>
        {[25, 50, 75].map((level) => <line key={level} className="curve-grid" x1="0" x2={CURVE_W} y1={y(level)} y2={y(level)} />)}
        <rect className="curve-window" x={windowStart} width={Math.max(2, windowEnd - windowStart)} y={CURVE_TOP - 6} height={CURVE_H + 6} />
        <path className="curve-area" d={area} />
        <polyline className="curve-line" points={line.join(" ")} />
        {horizonX !== null && <line className="curve-horizon" x1={horizonX} x2={horizonX} y1={CURVE_TOP - 6} y2={CURVE_TOP + CURVE_H} />}
        {cursorX !== null && <line className="curve-cursor" x1={cursorX} x2={cursorX} y1={CURVE_TOP - 6} y2={CURVE_TOP + CURVE_H} />}
        <circle className="curve-peak" cx={peakX} cy={y(event.probability)} r="3.4" />
      </svg>
      <figcaption>
        <span>{localTime(points[0].time)}</span>
        {horizonX !== null && <span className="curve-horizon-label" style={{ left: `${horizonX / CURVE_W * 100}%` }}>{horizonLabel} {localTime(horizonAt)}</span>}
        <span>{localTime(points[points.length - 1].time)}</span>
      </figcaption>
    </figure>
  );
}

/* Glow: vertical light-path cross-section toward the sun ------------------------- */

const SECTION_W = 320;
const SECTION_H = 112;
const SECTION_LEFT = 14;
const SECTION_RIGHT = 306;
const SECTION_BOTTOM = 96;
const SECTION_TOP = 8;
const MAX_DISTANCE = 380;
const MAX_HEIGHT = 14;
const BANDS = [
  { id: "high", key: "highCloud", bottom: 6.5, top: 13 },
  { id: "mid", key: "midCloud", bottom: 2, top: 6.5 },
  { id: "low", key: "lowCloud", bottom: 0.5, top: 2 },
] as const;

const sx = (distance: number) => SECTION_LEFT + distance / MAX_DISTANCE * (SECTION_RIGHT - SECTION_LEFT);
const sy = (height: number) => SECTION_BOTTOM - height / MAX_HEIGHT * (SECTION_BOTTOM - SECTION_TOP);

/** Column extents: the local grid point, then one column per sunward sample, split at midpoints. */
function columns(samples: LightPathSample[], local: SkyMetrics) {
  const localColumn = { from: 0, to: 20, lowCloud: local.lowCloud, midCloud: local.midCloud, highCloud: local.highCloud };
  const sorted = [...samples].sort((a, b) => a.distanceKm - b.distanceKm);
  return [localColumn, ...sorted.map((sample, index) => ({
    from: index === 0 ? 20 : (sorted[index - 1].distanceKm + sample.distanceKm) / 2,
    to: index === sorted.length - 1 ? MAX_DISTANCE : (sample.distanceKm + sorted[index + 1].distanceKm) / 2,
    lowCloud: sample.lowCloud,
    midCloud: sample.midCloud,
    highCloud: sample.highCloud,
  }))];
}

function rayPath(layerHeight: number, solarAltitude: number) {
  const points: string[] = [];
  for (let distance = 0; distance <= MAX_DISTANCE; distance += 5) {
    const height = rayHeightKm(layerHeight, solarAltitude, distance);
    points.push(`${sx(distance).toFixed(1)},${sy(clamp(height, -0.5, MAX_HEIGHT + 0.5)).toFixed(1)}`);
    if (height > MAX_HEIGHT) break;
  }
  return points.join(" ");
}

function LightSection({ event, solarAltitude, time }: { event: EventForecast; solarAltitude: number; time: string }) {
  const { locale, t } = useLocale();
  const known = event.lightPath.status === "available";
  const samples = known ? event.lightPath.samples : [];
  const layers = GLOW_LAYERS.map((layer) => ({ layer, light: layerLight(layer, solarAltitude, known ? samples : null) }));
  const toward = t(event.kind === "dawn" ? "日出" : "日落");
  return (
    <figure className="light-section">
      <svg viewBox={`0 0 ${SECTION_W} ${SECTION_H}`} role="img" aria-label={locale === "en"
        ? `${toward} light-path section: solar altitude ${signedDegrees(solarAltitude)}; ${layers.map(({ layer, light }) => `${t(layer.name)} ${light.lit >= 0.5 ? "illuminated" : "in Earth's shadow"}${light.transmission === null ? "" : `, ${Math.round(light.transmission * 100)}% transmission`}`).join("; ")}`
        : `${toward}方向光路剖面：太阳高度 ${signedDegrees(solarAltitude)}，${layers.map(({ layer, light }) => `${layer.name}${light.lit >= 0.5 ? "被照亮" : "已入地影"}${light.transmission === null ? "" : `，透光 ${Math.round(light.transmission * 100)}%`}`).join("；")}`}>
        {columns(samples, event.metrics).map((column) => BANDS.map((band) => {
          const cover = column[band.key];
          return (
            <rect
              key={`${column.from}-${band.id}`}
              className={`section-cloud ${band.id}${cover === null ? " missing" : ""}`}
              x={sx(column.from) + 0.6}
              width={Math.max(1, sx(column.to) - sx(column.from) - 1.2)}
              y={sy(band.top)}
              height={sy(band.bottom) - sy(band.top)}
              opacity={cover === null ? 1 : 0.06 + (cover / 100) * 0.74}
            />
          );
        }))}
        {!known && <text className="section-note" x={sx(200)} y={sy(7.2)}>{t("远方光路暂无采样")}</text>}
        <line className="section-ground" x1={SECTION_LEFT} x2={SECTION_RIGHT} y1={SECTION_BOTTOM} y2={SECTION_BOTTOM} />
        {layers.map(({ layer, light }) => (
          <g key={layer.id} className={`section-ray ${layer.id}${light.lit >= 0.5 ? "" : " shadowed"}`}>
            <polyline points={rayPath(layer.heightKm, solarAltitude)} />
            <circle cx={sx(0)} cy={sy(layer.heightKm)} r="2.6" />
          </g>
        ))}
        <path className="section-observer" d={`M${sx(0) - 4},${SECTION_BOTTOM} L${sx(0)},${SECTION_BOTTOM - 7} L${sx(0) + 4},${SECTION_BOTTOM} Z`} />
        {[0, 100, 200].map((distance) => <text key={distance} className={`section-axis${distance === 0 ? " start" : ""}`} x={sx(distance)} y={SECTION_H - 3}>{distance === 0 ? t("本地") : `${distance} km`}</text>)}
        <text className="section-axis end" x={SECTION_RIGHT} y={SECTION_H - 3}>{locale === "en" ? `${toward} ${MAX_DISTANCE} km →` : `${toward}方向 ${MAX_DISTANCE} km →`}</text>
      </svg>
      <figcaption>
        <span>{localTime(time)} · {locale === "en" ? "Sun" : "太阳"} {signedDegrees(solarAltitude)}</span>
        {layers.map(({ layer, light }) => (
          <span key={layer.id} className={`ray-key ${layer.id}${light.lit >= 0.5 ? "" : " shadowed"}`}>
            {t(layer.name)} {layer.heightKm} km · {light.lit < 0.5 ? t("已入地影") : light.transmission === null ? t("受光") : locale === "en" ? `${Math.round(light.transmission * 100)}% transmission` : `透光 ${Math.round(light.transmission * 100)}%`}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Glow signature view: when the colour peaks, and why — the ray that reaches each cloud deck. */
export function GlowProfile({ event, horizonAt, selectedInstant }: { event: EventForecast; horizonAt: string | null; selectedInstant: number }) {
  if (event.timeline.length < 2) return null;
  const first = forecastInstant(event.timeline[0].time);
  const last = forecastInstant(event.timeline[event.timeline.length - 1].time);
  const inRange = selectedInstant >= first && selectedInstant <= last;
  const active = inRange
    ? event.timeline.reduce((best, point) => Math.abs(forecastInstant(point.time) - selectedInstant) < Math.abs(forecastInstant(best.time) - selectedInstant) ? point : best, event.timeline[0])
    : { time: event.time, solarAltitude: event.solarAltitude };
  return (
    <div className="glow-profile">
      <GlowCurve event={event} horizonAt={horizonAt} cursor={inRange ? selectedInstant : null} />
      <LightSection event={event} solarAltitude={active.solarAltitude} time={active.time} />
    </div>
  );
}

/* Generic time ribbon ------------------------------------------------------------ */

export function WindowRibbon({ start, peak, end, peakLabel, tone = "default" }: { start: string; peak: string; end: string; peakLabel: string; tone?: "default" | "sunrise" | "sunset" | "night" }) {
  const { locale, t } = useLocale();
  const from = forecastInstant(start);
  const span = Math.max(1, forecastInstant(end) - from);
  const peakAt = clamp((forecastInstant(peak) - from) / span * 100, 0, 100);
  // Keep the peak label inside the figure when the peak sits at either end of the window.
  const align = peakAt < 16 ? "start" : peakAt > 84 ? "end" : "center";
  return (
    <figure className={`window-ribbon tone-${tone}`}>
      <div className="ribbon-peak-row">
        <span className="ribbon-peak" data-align={align} style={{ left: `${peakAt}%` }}><small>{peakLabel}</small><strong>{localTime(peak)}</strong></span>
      </div>
      <div className="ribbon-track" role="img" aria-label={locale === "en" ? `${localTime(start)} to ${localTime(end)}, ${peakLabel} ${localTime(peak)}` : `${localTime(start)} 至 ${localTime(end)}，${peakLabel} ${localTime(peak)}`}>
        <i style={{ left: `${peakAt}%` }} />
      </div>
      <figcaption>
        <span><small>{t("开始")}</small><strong>{localTime(start)}</strong></span>
        <span className="ribbon-duration">{t("持续")} {duration(start, end, locale)}</span>
        <span><small>{t("结束")}</small><strong>{localTime(end)}</strong></span>
      </figcaption>
    </figure>
  );
}

/* Explanations ------------------------------------------------------------------- */

export function FactorBars({ factors }: { factors: ScoreResult["contributions"] }) {
  const { t } = useLocale();
  const scale = Math.max(12, ...factors.map((factor) => Math.abs(factor.value)));
  return (
    <ul className="factor-bars">
      {factors.map((factor) => (
        <li key={factor.name} data-direction={factor.direction}>
          <span className="factor-copy"><strong>{t(factor.name)}</strong><small>{t(factor.detail)}</small></span>
          <span className="factor-meter" aria-hidden="true">
            <b style={{ width: `${Math.abs(factor.value) / scale * 50}%`, ...(factor.value < 0 ? { right: "50%" } : { left: "50%" }) }} />
          </span>
          <em>{factor.value > 0 ? "+" : factor.value < 0 ? "−" : "±"}{Math.abs(factor.value)}</em>
        </li>
      ))}
    </ul>
  );
}

const MODEL_SHORT: Record<string, string> = { "ECMWF IFS": "ECMWF", "CMA GRAPES": "CMA", "NOAA GFS": "GFS", "DWD ICON": "ICON" };

export function ModelAgreement({ models, confidence }: { models: DailyOpportunity["models"]; confidence: number | null }) {
  const { locale, t } = useLocale();
  const scored = models.filter((item): item is { model: string; score: number } => item.score !== null);
  if (!scored.length) return <p className="model-empty">{t("暂无可用模式结果，不以 0 分代替。")}</p>;
  const values = scored.map((item) => item.score);
  const spread = Math.max(...values) - Math.min(...values);
  return (
    <div className="model-agreement">
      <div className="model-scale" role="img" aria-label={locale === "en" ? `Opportunity index by model: ${scored.map((item) => `${item.model} ${item.score}`).join(", ")}; spread ${spread}` : `各模式机会指数：${scored.map((item) => `${item.model} ${item.score}`).join("，")}；相差 ${spread}`}>
        <span className="model-range" style={{ left: `${Math.min(...values)}%`, width: `${Math.max(0.6, spread)}%` }} />
        {scored.map((item) => <i key={item.model} style={{ left: `${item.score}%` }} />)}
      </div>
      <dl className="model-values">
        {scored.map((item) => <div key={item.model}><dt>{MODEL_SHORT[item.model] ?? item.model}</dt><dd>{item.score}</dd></div>)}
        <div><dt>{t("模式相差")}</dt><dd>{scored.length > 1 ? spread : t("单模式")}</dd></div>
        <div><dt>{t("预测参考度")}</dt><dd>{confidence === null ? t("暂无") : confidence}</dd></div>
      </dl>
    </div>
  );
}

/* Sky dome ----------------------------------------------------------------------- */

/** Zenith-centred sky plot: the horizon is the outer ring, north up, east to the left as seen looking up. */
export function SkyDome({ azimuth, altitude, label }: { azimuth: number | null; altitude: number | null; label: string }) {
  const { locale } = useLocale();
  const known = azimuth !== null && altitude !== null;
  const radius = known ? clamp((90 - Math.max(altitude, 0)) / 90, 0, 1) * 41 : 0;
  const angle = known ? azimuth * Math.PI / 180 : 0;
  const cx = 50 - Math.sin(angle) * radius;
  const cy = 50 - Math.cos(angle) * radius;
  return (
    <svg className="sky-dome" viewBox="0 0 100 100" role="img" aria-label={known ? locale === "en" ? `${label}: azimuth ${Math.round(azimuth)}°, altitude ${altitude.toFixed(1)}°${altitude < 0 ? ", below the horizon" : ""}` : `${label}：方位 ${Math.round(azimuth)}°，高度 ${altitude.toFixed(1)}°${altitude < 0 ? "，位于地平线下" : ""}` : locale === "en" ? `${label}: position unavailable` : `${label}：暂无位置`}>
      <circle className="dome-horizon" cx="50" cy="50" r="41" />
      <circle className="dome-ring" cx="50" cy="50" r="27.3" />
      <circle className="dome-ring" cx="50" cy="50" r="13.7" />
      <line className="dome-ring" x1="50" x2="50" y1="9" y2="91" />
      <line className="dome-ring" x1="9" x2="91" y1="50" y2="50" />
      <text x="50" y="4">{locale === "en" ? "N" : "北"}</text>
      <text x="50" y="96">{locale === "en" ? "S" : "南"}</text>
      <text x="4" y="50">{locale === "en" ? "E" : "东"}</text>
      <text x="96" y="50">{locale === "en" ? "W" : "西"}</text>
      {known && <circle className={`dome-target${altitude < 0 ? " below" : ""}`} cx={cx} cy={cy} r="4.2" />}
    </svg>
  );
}
