"use client";

import { ChevronDown, Database } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLocale, type Locale } from "@/components/locale-context";
import type { DayForecast, ForecastResponse, HourlyWeatherPoint, SpaceWeatherResponse } from "@/lib/types";

const localTimeFormatter = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" });
const timePartsFormatter = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" });

export function forecastInstant(value: string) {
  return new Date(value.endsWith("Z") ? value : `${value}:00+08:00`).getTime();
}

export function localTime(value: string | null) {
  if (!value) return "—";
  return localTimeFormatter.format(new Date(forecastInstant(value)));
}

export function localDate(value: string, locale: Locale = "zh") {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", { month: "short", day: "numeric", weekday: "short", timeZone: "Asia/Shanghai" }).format(new Date(forecastInstant(value)));
}

export function longDateTime(value: string, locale: Locale = "zh") {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date(forecastInstant(value)));
}

export function shortDate(value: string, locale: Locale = "zh") {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", { month: "short", day: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(forecastInstant(`${value}T12:00`)));
}

export function weekday(value: string, locale: Locale = "zh") {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", { weekday: "short", timeZone: "Asia/Shanghai" }).format(new Date(forecastInstant(`${value}T12:00`)));
}

export function compass(value: number | null, locale: Locale = "zh") {
  if (value === null) return "—";
  const directions = locale === "en"
    ? ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    : ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
  return `${directions[Math.round(value / 45) % 8]} ${Math.round(value)}°`;
}

export function closestHour(hourly: HourlyWeatherPoint[], target: string) {
  const targetTime = forecastInstant(target);
  const point = hourly.reduce<HourlyWeatherPoint | null>((current, item) => {
    if (!current) return item;
    return Math.abs(forecastInstant(item.time) - targetTime) < Math.abs(forecastInstant(current.time) - targetTime) ? item : current;
  }, null);
  return point && Math.abs(forecastInstant(point.time) - targetTime) <= 90 * 60 * 1000 ? point : null;
}

export function minuteOfDay(value: string) {
  const parts = timePartsFormatter.formatToParts(new Date(forecastInstant(value)));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

/** Workspace title block. Owns the page `h1`, so the catalog rail names the whole workspace. */
export function CatalogHead({ icon: Icon, eyebrow, title, badge }: { icon: LucideIcon; eyebrow: string; title: string; badge: string }) {
  return (
    <header className="catalog-head">
      <div className="scene-title">
        <span aria-hidden="true"><Icon size={16} /></span>
        <div><small>{eyebrow}</small><h1>{title}</h1></div>
      </div>
      <span className="catalog-badge">{badge}</span>
    </header>
  );
}

/** Seven forecast days, rendered as the primary axis of the timeline dock. */
export function DateTabs({ data, selected, onSelect, label = "选择预报日期" }: { data: ForecastResponse; selected: number; onSelect: (index: number) => void; label?: string }) {
  const { locale, t } = useLocale();
  const move = (index: number, key: string) => {
    const next = key === "ArrowRight" ? (index + 1) % data.days.length
      : key === "ArrowLeft" ? (index - 1 + data.days.length) % data.days.length
        : key === "Home" ? 0
          : key === "End" ? data.days.length - 1
            : index;
    if (next !== index) {
      onSelect(next);
      window.requestAnimationFrame(() => document.getElementById(`forecast-day-${next}`)?.focus());
    }
  };
  return (
    <div className="date-tabs" role="tablist" aria-label={t(label)}>
      {data.days.map((day, index) => (
        <button
          id={`forecast-day-${index}`}
          key={day.date}
          type="button"
          role="tab"
          tabIndex={selected === index ? 0 : -1}
          aria-selected={selected === index}
          aria-controls="workspace-detail"
          onKeyDown={(event) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              move(index, event.key);
            }
          }}
          onClick={() => onSelect(index)}
        >
          <span>{index === 0 ? t("今天") : weekday(day.date, locale)}</span>
          <strong>{shortDate(day.date, locale)}</strong>
        </button>
      ))}
    </div>
  );
}

/** Right-hand dock segment: the light budget of the selected day. */
export function DockAstro({ day }: { day: DayForecast }) {
  const { t } = useLocale();
  const darkness = Math.round(day.solar.astronomicalDarknessMinutes / 60);
  return (
    <div className="dock-astro" aria-label={t("所选日期的光线预算")}>
      <span><small>{t("日出")}</small><strong>{localTime(day.sunrise)}</strong></span>
      <span><small>{t("日落")}</small><strong>{localTime(day.sunset)}</strong></span>
      <span><small>{t("天文暗夜")}</small><strong>{darkness} h</strong></span>
      <span><small>{t("月面照明")}</small><strong>{Math.round(day.moon.illumination)}%</strong></span>
    </div>
  );
}

export function FieldBriefing({ point, label, elevation }: { point: HourlyWeatherPoint | null; label: string; elevation: number | null }) {
  const { locale, t } = useLocale();
  const translatedLabel = t(label);
  if (!point) return <p className="field-unavailable">{locale === "en" ? `${translatedLabel} is outside the seven-day weather range, so field conditions are not attached.` : `${label}超出七天天气时效，暂不附加现场条件。`}</p>;
  const dewGap = point.temperature !== null && point.dewPoint !== null ? point.temperature - point.dewPoint : null;
  return (
    <section className="insight-section field-briefing" aria-label={locale === "en" ? `${translatedLabel} field conditions` : `${label}现场条件`}>
      <header><h3>{locale === "en" ? `${translatedLabel} field conditions` : `${label}现场条件`}</h3><small>{locale === "en" ? `${localTime(point.time)} point forecast` : `${localTime(point.time)} 点位预报`}</small></header>
      <dl className="reading-grid">
        <div><dt>{t("气温 / 露点差")}</dt><dd>{point.temperature?.toFixed(0) ?? "—"}° / {dewGap?.toFixed(1) ?? "—"}°</dd></div>
        <div><dt>{t("持续 / 阵风")}</dt><dd>{point.windSpeed?.toFixed(0) ?? "—"} / {point.windGusts?.toFixed(0) ?? "—"} km/h</dd></div>
        <div><dt>{t("来风方向")}</dt><dd>{compass(point.windDirection, locale)}</dd></div>
        <div><dt>{t("能见度")}</dt><dd>{point.visibility === null ? "—" : `${Math.round(point.visibility / 1000)} km`}</dd></div>
        <div><dt>{t("总云量")}</dt><dd>{point.totalCloud === null ? "—" : `${Math.round(point.totalCloud)}%`}</dd></div>
        <div><dt>{t("降水")}</dt><dd>{point.precipitation === null ? "—" : `${point.precipitation.toFixed(1)} mm`}</dd></div>
      </dl>
      <p className="section-note">{locale === "en"
        ? `Elevation ${elevation === null ? "—" : `${Math.round(elevation)} m`} · Watch for lens condensation when the dew-point spread nears 0°C; gusts affect telephoto and tripod stability.`
        : `海拔 ${elevation === null ? "—" : `${Math.round(elevation)} m`} · 露点差接近 0°C 时注意镜片结露，阵风会影响长焦与脚架稳定。`}</p>
    </section>
  );
}

export function SourceDisclosure({ data, includeSpaceWeather = false, spaceWeatherStatus }: {
  data: ForecastResponse;
  includeSpaceWeather?: boolean;
  spaceWeatherStatus?: SpaceWeatherResponse["status"];
}) {
  const { locale, t } = useLocale();
  const spaceWeatherAvailable = spaceWeatherStatus === "available";
  const spaceWeatherLabel = spaceWeatherStatus === "available"
    ? locale === "en" ? "Kp space-weather guidance; independent failures do not affect ordinary weather" : "Kp 空间天气指导；独立接口失败时不会影响普通天气"
    : spaceWeatherStatus === "unavailable"
      ? locale === "en" ? "Source unavailable; aurora opportunity is not replaced with zero" : "当前源不可用，极光机会不会补成 0 分"
      : locale === "en" ? "Connecting to the independent space-weather source" : "正在连接独立空间天气接口";
  return (
    <details className="source-disclosure">
      <summary><span><Database size={14} /> {t("数据、模型与边界")}</span><ChevronDown size={14} /></summary>
      <div>
        {data.sources.map((source) => <p key={source.id}><i className={source.status} /><span><strong>{source.name}</strong><small>{t(source.role)}</small></span></p>)}
        {includeSpaceWeather && <p><i className={spaceWeatherAvailable ? "available" : spaceWeatherStatus === "unavailable" ? "unavailable" : ""} /><span><strong><a href="https://www.swpc.noaa.gov/" target="_blank" rel="noreferrer">NOAA SWPC ↗</a></strong><small>{spaceWeatherLabel}</small></span></p>}
        <p><i className="available" /><span><strong><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo ↗</a></strong><small>{t(data.provenance.access === "customer" ? "商业客户接口" : "非商业开放接口")} · {data.provenance.license} · {locale === "en" ? "ECMWF / CMA / GFS / ICON / CAMS delivery layer" : "ECMWF / CMA / GFS / ICON / CAMS 交付层"}</small></span></p>
        <p><i className="available" /><span><strong>Astronomy Engine</strong><small>{t("日月位置、暮光与本地食象几何")}</small></span></p>
        <p><i /><span><strong><a href="https://weather.cma.cn/web/alarm/map.html" target="_blank" rel="noreferrer">{t("中国气象局预警 ↗")}</a></strong><small>{t("权威灾害预警；当前工作台不替代官方预警")}</small></span></p>
      </div>
    </details>
  );
}
