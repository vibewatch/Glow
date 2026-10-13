"use client";

import { AlertTriangle, CalendarDays, Eclipse, Orbit, Sparkles, Telescope } from "lucide-react";
import { useLocale, type Locale } from "@/components/locale-context";
import type { EclipseForecast, ForecastResponse, MeteorShowerForecast } from "@/lib/types";
import { CatalogHead, FieldBriefing, SourceDisclosure, closestHour, compass, forecastInstant, localDate, localTime, longDateTime } from "@/components/workspace-common";
import { SkyDome } from "@/components/insight-graphics";

export interface RareEvent {
  id: string;
  kind: "lunar-eclipse" | "solar-eclipse" | "meteor-shower";
  title: string;
  peak: string;
  start: string;
  end: string;
  metric: string;
  metricLabel: string;
  summary: string;
  sourceNote: string;
  azimuth: number | null;
  altitude: number | null;
  moonIllumination: number | null;
  eclipse?: EclipseForecast;
  shower?: MeteorShowerForecast;
}

const ECLIPSE_KIND: Record<EclipseForecast["kind"], string> = {
  penumbral: "半影食",
  partial: "偏食",
  annular: "环食",
  total: "全食",
};
const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai" });

export function buildRareEvents(data: ForecastResponse): RareEvent[] {
  const lunar = data.astronomy.nextLunarEclipse;
  const solar = data.astronomy.nextSolarEclipse;
  return [
    {
      id: `lunar-${lunar.peak}`,
      kind: "lunar-eclipse" as const,
      title: `${ECLIPSE_KIND[lunar.kind]} · 月食`,
      peak: lunar.peak,
      start: lunar.begin,
      end: lunar.end,
      metric: lunar.kind === "penumbral" ? "半影" : `${Math.round(lunar.obscuration * 100)}%`,
      metricLabel: lunar.kind === "penumbral" ? "无本影遮掩" : "最大遮掩",
      summary: `${data.location.name}定位点在食甚时月面${lunar.visible ? "位于地平线上" : "不在地平线上"}。`,
      sourceNote: "Astronomy Engine 本地可见食象几何",
      azimuth: lunar.azimuth,
      altitude: lunar.altitude,
      moonIllumination: null,
      eclipse: lunar,
    },
    {
      id: `solar-${solar.peak}`,
      kind: "solar-eclipse" as const,
      title: `${ECLIPSE_KIND[solar.kind]} · 日食`,
      peak: solar.peak,
      start: solar.begin,
      end: solar.end,
      metric: `${Math.round(solar.obscuration * 100)}%`,
      metricLabel: "本地最大遮掩",
      summary: `${data.location.name}定位点在食甚时太阳${solar.visible ? "位于地平线上" : "不在地平线上"}。`,
      sourceNote: "Astronomy Engine 本地日食接触时刻与遮掩",
      azimuth: solar.azimuth,
      altitude: solar.altitude,
      moonIllumination: null,
      eclipse: solar,
    },
    ...data.astronomy.meteorShowers.map((shower): RareEvent => ({
      id: shower.id,
      kind: "meteor-shower",
      title: shower.name,
      peak: shower.peak,
      start: shower.activeStart,
      end: shower.activeEnd,
      metric: `ZHR ${shower.zenithalHourlyRate}`,
      metricLabel: "理想天顶流量",
      summary: shower.viewingAdvice,
      sourceNote: shower.source,
      azimuth: shower.radiantAzimuth,
      altitude: shower.radiantAltitude,
      moonIllumination: shower.moonIllumination,
      shower,
    })),
  ].sort((a, b) => forecastInstant(a.peak) - forecastInstant(b.peak));
}

function daysAway(data: ForecastResponse, event: RareEvent) {
  return Math.max(0, Math.ceil((forecastInstant(event.peak) - forecastInstant(data.generatedAt)) / 86_400_000));
}

function dateKey(value: string) {
  return dateKeyFormatter.format(new Date(forecastInstant(value)));
}

/** Axis ticks can span several years, so they always carry the year — `8/5` alone would read as a date in the past. */
function axisDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", { year: "2-digit", month: "numeric", day: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(forecastInstant(value)));
}

function EventIcon({ kind }: { kind: RareEvent["kind"] }) {
  if (kind === "meteor-shower") return <Sparkles />;
  if (kind === "lunar-eclipse") return <Orbit />;
  return <Eclipse />;
}

/** Left rail: every upcoming event ranked by date, so nothing is hidden behind a horizontal scroll. */
export function EventsCatalog({ data, events, selectedId, onSelect }: { data: ForecastResponse; events: RareEvent[]; selectedId: string; onSelect: (event: RareEvent) => void }) {
  const { locale, t } = useLocale();
  const soon = events.filter((event) => daysAway(data, event) <= 30).length;
  return (
    <section className="catalog-rail" aria-label={t("罕见天象列表")}>
      <CatalogHead icon={Telescope} eyebrow="CELESTIAL CALENDAR" title={t("天象事件")} badge={locale === "en" ? `${events.length} events` : `${events.length} 个事件`} />
      <div className="catalog-scroll">
        <p className="catalog-summary">
          <strong>{t("远期看几何，临近再看天气")}</strong>
          <span>{soon ? locale === "en" ? `${soon} events within 30 days` : `${soon} 个事件在 30 天内` : t("30 天内没有事件")}. {t("流星雨峰值按夜间范围表达，不伪装成分钟级确定时刻。")}</span>
        </p>
        <div className="rare-event-list" aria-label={t("按峰值日期排序的天象事件")}>
          {events.map((event) => (
            <button type="button" key={event.id} aria-pressed={selectedId === event.id} data-kind={event.kind} onClick={() => onSelect(event)}>
              <span className="event-icon"><EventIcon kind={event.kind} /></span>
              <span className="event-copy"><strong>{t(event.title)}</strong><small>{localDate(event.peak, locale)} · {locale === "en" ? `in ${daysAway(data, event)} days` : `${daysAway(data, event)} 天后`}</small></span>
              <em>{t(event.metric)}</em>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Bottom dock: a square-root compressed axis from today to the furthest event, so the near term is readable. */
export function EventsDock({ data, events, selectedId, onSelect }: { data: ForecastResponse; events: RareEvent[]; selectedId: string; onSelect: (event: RareEvent) => void }) {
  const { locale, t } = useLocale();
  const selected = events.find((event) => event.id === selectedId) ?? events[0];
  const origin = forecastInstant(data.generatedAt);
  const horizon = Math.max(origin + 86_400_000, ...events.map((event) => forecastInstant(event.peak)));
  const span = horizon - origin;
  /** Eclipses can sit years out while showers sit weeks out; a linear axis would collapse the near term into a few pixels. */
  const position = (value: string) => Math.sqrt(Math.max(0, forecastInstant(value) - origin) / span) * 100;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({ ratio, at: new Date(origin + span * ratio * ratio).toISOString() }));
  return (
    <div className="planner-timeline events-dock" aria-label={t("未来天象事件时间线，按时间平方根压缩，近期事件间距更大")}>
      <div className="dock-lead">
        <span className="dock-eyebrow"><CalendarDays size={12} /> {t(selected.metricLabel)}</span>
        <strong>{t(selected.metric)}</strong>
        <small>{t(selected.title)} · {locale === "en" ? `in ${daysAway(data, selected)} days` : `${daysAway(data, selected)} 天后`}</small>
      </div>
      <div className="dock-main">
        <div className="event-axis">
          <div className="axis-track">
            <span className="axis-rule" aria-hidden="true" />
            {ticks.map((tick) => <small key={tick.ratio} className="axis-tick" style={{ left: `${tick.ratio * 100}%` }}>{axisDate(tick.at, locale)}</small>)}
            {events.map((event) => (
              <button
                type="button"
                key={event.id}
                className="axis-node"
                data-kind={event.kind}
                aria-pressed={selected.id === event.id}
                aria-label={`${t(event.title)}, ${localDate(event.peak, locale)}, ${locale === "en" ? `in ${daysAway(data, event)} days` : `${daysAway(data, event)} 天后`}`}
                title={`${t(event.title)} · ${localDate(event.peak, locale)}`}
                style={{ left: `${position(event.peak)}%` }}
                onClick={() => onSelect(event)}
              ><EventIcon kind={event.kind} /></button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Active-period bar: meteor showers span weeks and eclipses span hours, so the labels follow the scale. */
/** Meteor maxima are only known to within hours, so name the night ("10/21–22 夜") instead of a minute. */
function peakNight(value: string, locale: Locale) {
  const nightFormatter = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "zh-CN", { month: "numeric", day: "numeric", timeZone: "Asia/Shanghai" });
  const evening = forecastInstant(value) - 12 * 3_600_000;
  const [month, day] = nightFormatter.format(new Date(evening)).split("/");
  const next = nightFormatter.format(new Date(evening + 24 * 3_600_000)).split("/");
  return `${month}/${day}–${next[0] === month ? next[1] : next.join("/")}${locale === "en" ? " night" : " 夜"}`;
}

function EventSpan({ event }: { event: RareEvent }) {
  const { locale, t } = useLocale();
  const from = forecastInstant(event.start);
  const span = Math.max(1, forecastInstant(event.end) - from);
  const at = (value: string) => Math.min(100, Math.max(0, (forecastInstant(value) - from) / span * 100));
  const shower = event.kind === "meteor-shower";
  const format = shower ? (value: string) => localDate(value, locale) : localTime;
  const peak = shower ? peakNight(event.peak, locale) : longDateTime(event.peak, locale);
  const best = event.shower?.bestViewing ?? null;
  return (
    <figure className={`event-span ${event.kind}`}>
      <div className="span-track" role="img" aria-label={locale === "en" ? `${t(shower ? "活跃期" : "食象过程")} ${longDateTime(event.start, locale)} to ${longDateTime(event.end, locale)}, ${t(shower ? "极大" : "食甚")} ${peak}` : `${shower ? "活跃期" : "食象过程"} ${longDateTime(event.start)} 至 ${longDateTime(event.end)}，${shower ? "极大" : "食甚"} ${peak}`}>
        <i className="span-peak" style={{ left: `${at(event.peak)}%` }} />
        {best && <i className="span-best" style={{ left: `${at(best)}%` }} />}
      </div>
      <figcaption>
        <span><small>{t(shower ? "活跃期起" : event.kind === "solar-eclipse" ? "初亏" : "半影食始")}</small><strong>{format(event.start)}</strong></span>
        <span><small>{t(shower ? "预计峰值夜" : "食甚")}</small><strong>{peak}</strong></span>
        <span><small>{t(shower ? "活跃期止" : event.kind === "solar-eclipse" ? "复圆" : "半影食终")}</small><strong>{format(event.end)}</strong></span>
      </figcaption>
    </figure>
  );
}

export function EventsPanel({ data, events, selectedId, onSelect }: { data: ForecastResponse; events: RareEvent[]; selectedId: string; onSelect: (event: RareEvent) => void }) {
  const { locale, t } = useLocale();
  const selected = events.find((event) => event.id === selectedId) ?? events[0];
  const inWeatherRange = data.days.some((day) => day.date === dateKey(selected.peak));
  const fieldPoint = inWeatherRange ? closestHour(data.hourly, selected.shower?.bestViewing ?? selected.peak) : null;
  const index = events.findIndex((event) => event.id === selected.id);
  const step = (delta: number) => onSelect(events[(index + delta + events.length) % events.length]);
  const shower = selected.shower;
  return (
    <aside className="inspector events-inspector" aria-label={t("所选天象事件详情")}>
      <header className="inspector-head">
        <div><small>{localDate(selected.peak, locale)}</small><strong>{locale === "en" ? `in ${daysAway(data, selected)} days` : `${daysAway(data, selected)} 天后`}</strong></div>
        <span className="inspector-steppers">
          <span>{index + 1} / {events.length}</span>
          <button type="button" aria-label={t("上一个天象事件")} onClick={() => step(-1)}>‹</button>
          <button type="button" aria-label={t("下一个天象事件")} onClick={() => step(1)}>›</button>
        </span>
      </header>
      <div className="inspector-scroll" id="workspace-detail" role="tabpanel">
        <section className={`event-detail ${selected.kind}`} aria-live="polite">
          <div className="opportunity-hero">
            <div>
              <span className="hero-eyebrow"><EventIcon kind={selected.kind} /> {t(selected.kind === "meteor-shower" ? "流星雨" : selected.kind === "solar-eclipse" ? "日食" : "月食")}</span>
              <h2>{t(selected.title)}</h2>
            </div>
            <div className="hero-index event-metric">
              <strong>{t(selected.metric)}</strong>
              <small>{t(selected.metricLabel)}</small>
            </div>
          </div>
          <p>{t(selected.summary)}</p>
          <EventSpan event={selected} />
          <div className="signature-split">
            <dl className="reading-grid">
              {shower && <div><dt>{t("最佳观测")}</dt><dd>{longDateTime(shower.bestViewing, locale)}</dd></div>}
              {shower && <div><dt>{t("极大太阳黄经")}</dt><dd>λ☉ {shower.solarLongitude.toFixed(1)}°</dd></div>}
              <div><dt>{t(shower ? "峰值夜辐射点高度" : "食甚高度")}</dt><dd>{selected.altitude === null ? "—" : `${selected.altitude.toFixed(1)}°`}</dd></div>
              <div><dt>{t("本地方位")}</dt><dd>{selected.azimuth === null ? "—" : compass(selected.azimuth, locale)}</dd></div>
              {shower && <div><dt>{t("辐射点")}</dt><dd>{t(shower.radiant)}</dd></div>}
              {shower && <div><dt>{t("月面照明")}</dt><dd>{selected.moonIllumination}%</dd></div>}
              <div><dt>{t("天气状态")}</dt><dd>{t(inWeatherRange ? "已进入七天预报" : "尚无可信天气")}</dd></div>
            </dl>
            <SkyDome azimuth={selected.azimuth} altitude={selected.altitude} label={t(shower ? "最佳观测时辐射点位置" : "食甚时天体位置")} />
          </div>
          <p className="event-source-note">{t(selected.sourceNote)}</p>
          {selected.kind === "solar-eclipse" && <p className="event-safety"><AlertTriangle /> {t("严禁用肉眼或普通减光镜直视太阳；拍摄日食必须使用合格的太阳滤镜。")}</p>}
        </section>
        {inWeatherRange ? <FieldBriefing point={fieldPoint} label={shower ? "最佳观测" : locale === "en" ? "Event peak" : "事件峰值"} elevation={data.location.elevation} /> : <p className="event-weather-wait">{locale === "en" ? `The event is ${daysAway(data, selected)} days away. Weather appears only inside the seven-day forecast window; no long-range cloud or success rate is generated.` : `事件距今 ${daysAway(data, selected)} 天。天气只在进入七天预报窗口后显示，当前不生成远期云量或成功率。`}</p>}
        <SourceDisclosure data={data} />
      </div>
    </aside>
  );
}
