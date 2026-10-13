"use client";

import { AlertTriangle, CloudFog, MoonStar, Rainbow, Sparkles, Star, Sun, Sunrise, Sunset, Telescope } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLocale, type Locale } from "@/components/locale-context";
import type { DailyOpportunity, DayForecast, ForecastResponse, OpportunityKind, SpaceWeatherResponse } from "@/lib/types";
import { CatalogHead, DateTabs, DockAstro, FieldBriefing, SourceDisclosure, closestHour, compass, forecastInstant, localTime, minuteOfDay, shortDate, weekday } from "@/components/workspace-common";
import { FactorBars, GlowProfile, InsightSection, ModelAgreement, SkyDome, WindowRibbon } from "@/components/insight-graphics";

const OPPORTUNITY_ICONS: Record<OpportunityKind, LucideIcon> = {
  "dawn-glow": Sunrise,
  sunrise: Sun,
  fog: CloudFog,
  rainbow: Rainbow,
  sunset: Sunset,
  "dusk-glow": Sparkles,
  moon: MoonStar,
  stars: Star,
  aurora: Telescope,
};

const STATUS_LABEL: Record<DailyOpportunity["status"], string> = {
  excellent: "值得出发",
  watch: "可以关注",
  poor: "条件不利",
  unavailable: "暂无可靠预测",
};

function scoreLabel(item: DailyOpportunity, locale: Locale) {
  if (item.scoreType === "geometry-only") return locale === "en" ? "geometric timing" : "几何时刻";
  return item.score === null ? locale === "en" ? "unavailable" : "暂无" : `${item.score}/100`;
}

/** Left rail: every window of the selected day, always visible without scrolling the detail panel. */
export function OpportunityCatalog({ opportunities, selectedId, onSelect }: {
  opportunities: DailyOpportunity[];
  selectedId: OpportunityKind;
  onSelect: (item: DailyOpportunity) => void;
}) {
  const { locale, t } = useLocale();
  const scored = opportunities.filter((item) => item.score !== null);
  const best = scored.reduce<DailyOpportunity | null>((current, item) => !current || (item.score ?? -1) > (current.score ?? -1) ? item : current, null);
  const worthwhile = scored.filter((item) => (item.score ?? 0) >= 42).length;
  return (
    <section className="catalog-rail" aria-label={t("每日拍摄机会列表")}>
      <CatalogHead icon={Sparkles} eyebrow="DAILY AGENDA" title={t("每日拍摄机会")} badge={locale === "en" ? `${worthwhile} worth watching` : `${worthwhile} 个可关注`} />
      <div className="catalog-scroll">
        <p className="catalog-summary">
          <strong>{best ? locale === "en" ? <>Best: {t(best.title)} <b>{best.score}</b> · peak {localTime(best.peak)}</> : <>最佳 {best.title} <b>{best.score}</b> · 峰值 {localTime(best.peak)}</> : t("正在等待可靠预测")}</strong>
          <span>{locale === "en"
            ? `${opportunities.length} windows total. Low scores remain visible; “Unavailable” means missing or out-of-range data, not zero.`
            : `共 ${opportunities.length} 个窗口，低分机会不会被隐藏；“暂无”表示数据缺失或超出有效期，不等于 0 分。`}</span>
        </p>
        <div className="opportunity-list" aria-label={t("按时间排序的拍摄机会")}>
          {opportunities.map((item) => {
            const ItemIcon = OPPORTUNITY_ICONS[item.id];
            return (
              <button type="button" key={item.id} aria-pressed={selectedId === item.id} data-status={item.status} onClick={() => onSelect(item)}>
                <span className="opportunity-time">{localTime(item.peak)}</span>
                <span className="opportunity-icon"><ItemIcon /></span>
                <span className="opportunity-copy"><strong>{t(item.title)}</strong><small>{localTime(item.start)}–{localTime(item.end)} · {t(STATUS_LABEL[item.status])}</small></span>
                <span className="opportunity-score">
                  <strong>{item.scoreType === "geometry-only" ? t("几何") : item.score === null ? t("暂无") : item.score}</strong>
                  <i aria-hidden="true"><b style={{ width: `${item.score ?? 0}%` }} /></i>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Bottom dock: seven days plus a full-width 24 hour clock carrying every window of the day. */
export function OpportunityDock({ data, day, dayIndex, opportunities, selectedId, selectedInstant, onDay, onOpportunity, onInstant }: {
  data: ForecastResponse;
  day: DayForecast;
  dayIndex: number;
  opportunities: DailyOpportunity[];
  selectedId: OpportunityKind;
  selectedInstant: number;
  onDay: (index: number) => void;
  onOpportunity: (item: DailyOpportunity) => void;
  onInstant: (instant: number) => void;
}) {
  const { locale, t } = useLocale();
  const currentMinutes = minuteOfDay(new Date(selectedInstant).toISOString());
  const sunrise = minuteOfDay(day.sunrise);
  const sunset = minuteOfDay(day.sunset);
  const selected = opportunities.find((item) => item.id === selectedId) ?? opportunities[0];
  const start = minuteOfDay(selected.start);
  const end = minuteOfDay(selected.end);
  const windowWidth = end >= start ? (end - start) / 14.4 : (1440 - start) / 14.4;
  const SelectedIcon = OPPORTUNITY_ICONS[selected.id];
  return (
    <div className="planner-timeline opportunity-dock" aria-label={t("日期与每日机会时间轴")}>
      <div className="dock-lead">
        <span className="dock-eyebrow"><SelectedIcon size={12} /> {t(selected.shortTitle)}</span>
        <strong>{localTime(new Date(selectedInstant).toISOString())}</strong>
        <small>{shortDate(day.date, locale)} · {t("窗口")} {localTime(selected.start)}–{localTime(selected.end)}</small>
      </div>
      <div className="dock-main">
        <DateTabs data={data} selected={dayIndex} onSelect={onDay} label="七天机会日期" />
        <div className="clock-track">
          <span className="daylight-band" style={{ left: `${sunrise / 14.4}%`, width: `${Math.max(0, sunset - sunrise) / 14.4}%` }} />
          <span className="selected-window" style={{ left: `${start / 14.4}%`, width: `${windowWidth}%` }} />
          <span className="clock-cursor" aria-hidden="true" style={{ left: `${currentMinutes / 14.4}%` }} />
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((hour) => <i key={hour} style={{ left: `${hour / 24 * 100}%` }}><small>{String(hour).padStart(2, "0")}</small></i>)}
          {opportunities.map((item, index) => {
            const Icon = OPPORTUNITY_ICONS[item.id];
            return (
              <button
                type="button"
                key={item.id}
                className="opportunity-node"
                data-row={index % 2}
                data-status={item.status}
                aria-pressed={selectedId === item.id}
                aria-label={locale === "en" ? `${t(item.title)}, peak ${localTime(item.peak)}, ${scoreLabel(item, locale)}` : `${item.title}，峰值 ${localTime(item.peak)}，${scoreLabel(item, locale)}`}
                title={`${t(item.title)} · ${localTime(item.peak)}`}
                style={{ left: `${minuteOfDay(item.peak) / 14.4}%` }}
                onClick={() => onOpportunity(item)}
              ><Icon /></button>
            );
          })}
          <input
            type="range"
            min="0"
            max="1439"
            step="15"
            value={currentMinutes}
            aria-label={t("选择当日查看时刻")}
            aria-valuetext={`${shortDate(day.date, locale)} ${localTime(new Date(selectedInstant).toISOString())}`}
            onChange={(event) => onInstant(forecastInstant(`${day.date}T00:00`) + Number(event.target.value) * 60_000)}
          />
        </div>
      </div>
      <DockAstro day={day} />
    </div>
  );
}

function SignatureFigure({ item, day, selectedInstant }: { item: DailyOpportunity; day: DayForecast; selectedInstant: number }) {
  const { t } = useLocale();
  if (item.kind === "dawn-glow") return <GlowProfile event={day.dawn} horizonAt={day.solar.sunriseAt ?? day.sunrise} selectedInstant={selectedInstant} />;
  if (item.kind === "dusk-glow") return <GlowProfile event={day.dusk} horizonAt={day.solar.sunsetAt ?? day.sunset} selectedInstant={selectedInstant} />;
  if (item.kind === "sunrise") return <WindowRibbon start={item.start} peak={item.peak} end={item.end} peakLabel={t("日出")} tone="sunrise" />;
  if (item.kind === "sunset") return <WindowRibbon start={item.start} peak={item.peak} end={item.end} peakLabel={t("日落")} tone="sunset" />;
  if (item.kind === "moon") {
    return (
      <div className="signature-split">
        <WindowRibbon start={item.start} peak={item.peak} end={item.end} peakLabel={t("最佳")} tone="night" />
        <SkyDome azimuth={day.moon.azimuth} altitude={day.moon.altitude} label={t("月面位置")} />
      </div>
    );
  }
  return <WindowRibbon start={item.start} peak={item.peak} end={item.end} peakLabel={t("峰值")} tone={item.kind === "stars" || item.kind === "aurora" ? "night" : "default"} />;
}

/** Right inspector: everything about the one window the photographer is committing to. */
export function OpportunityPanel({ data, day, opportunities, selectedId, selectedInstant, spaceWeatherStatus, onSelect }: {
  data: ForecastResponse;
  day: DayForecast;
  opportunities: DailyOpportunity[];
  selectedId: OpportunityKind;
  selectedInstant: number;
  spaceWeatherStatus?: SpaceWeatherResponse["status"];
  onSelect: (item: DailyOpportunity) => void;
}) {
  const { locale, t } = useLocale();
  const selected = opportunities.find((item) => item.id === selectedId) ?? opportunities[0];
  const Icon = OPPORTUNITY_ICONS[selected.id];
  const fieldPoint = closestHour(data.hourly, new Date(selectedInstant).toISOString());
  const index = opportunities.findIndex((item) => item.id === selected.id);
  const step = (delta: number) => onSelect(opportunities[(index + delta + opportunities.length) % opportunities.length]);
  const geometry = selected.scoreType === "geometry-only";
  return (
    <aside className="inspector agenda-inspector" aria-label={t("所选拍摄机会详情")}>
      <header className="inspector-head">
        <div><small>{shortDate(day.date, locale)} · {weekday(day.date, locale)}</small><strong>{t(data.location.name)}</strong></div>
        <span className="inspector-steppers">
          <span>{index + 1} / {opportunities.length}</span>
          <button type="button" aria-label={t("上一个拍摄机会")} onClick={() => step(-1)}>‹</button>
          <button type="button" aria-label={t("下一个拍摄机会")} onClick={() => step(1)}>›</button>
        </span>
      </header>
      <div className="inspector-scroll" id="workspace-detail" role="tabpanel">
        <section className="selected-opportunity" data-status={selected.status} aria-live="polite">
          <div className="opportunity-hero">
            <div>
              <span className="hero-eyebrow"><Icon size={14} /> {t(STATUS_LABEL[selected.status])}</span>
              <h2>{t(selected.title)}</h2>
            </div>
            <div className="hero-index" role="img" aria-label={`${t(selected.title)} ${scoreLabel(selected, locale)}, ${t(STATUS_LABEL[selected.status])}`}>
              <strong className={selected.score === null ? "is-text" : undefined}>{geometry ? t("几何") : selected.score === null ? t("暂无") : selected.score}</strong>
              <small>{t(geometry ? "确定性时刻" : "机会指数 / 100")}</small>
            </div>
          </div>
          <dl className="hero-facts">
            <div><dt>{geometry ? t(selected.shortTitle) : t("峰值")}</dt><dd>{localTime(selected.peak)}</dd></div>
            <div><dt>{t("窗口")}</dt><dd>{localTime(selected.start)}–{localTime(selected.end)}</dd></div>
            <div><dt>{t("预测参考度")}</dt><dd>{selected.confidence === null ? t("暂无") : geometry ? t("天文解算") : `${selected.confidence}/100`}</dd></div>
          </dl>
          <p>{t(selected.summary)}</p>
          <SignatureFigure item={selected} day={day} selectedInstant={selectedInstant} />
          <dl className="reading-grid">
            {selected.details.map((detail) => <div key={detail.label}><dt>{t(detail.label)}</dt><dd>{t(detail.value)}</dd></div>)}
            {selected.direction && <div><dt>{t("地图方向")}</dt><dd>{compass(selected.direction.azimuth, locale)}</dd></div>}
          </dl>
          <p className="method-inline"><AlertTriangle /> {t(selected.limitation)}</p>
        </section>
        {selected.factors.length > 0 && (
          <InsightSection title={t("为什么是这个分数")} meta={t("相对基准的加减")}>
            <FactorBars factors={selected.factors} />
          </InsightSection>
        )}
        {selected.models.length > 0 && (
          <InsightSection title={t("模式一致性")} meta={t("分歧即不确定性")}>
            <ModelAgreement models={selected.models} confidence={selected.confidence} />
          </InsightSection>
        )}
        <FieldBriefing point={fieldPoint} label={locale === "en" ? `${localTime(new Date(selectedInstant).toISOString())}` : `${localTime(new Date(selectedInstant).toISOString())} 时刻`} elevation={data.location.elevation} />
        <SourceDisclosure data={data} includeSpaceWeather spaceWeatherStatus={spaceWeatherStatus} />
        <p className="inspector-disclaimer">{t("机会指数用于摄影计划，不是统计概率，也不替代气象灾害预警与现场安全判断。")}{selected.direction ? ` ${t("地图方向线只表示方位角，长度不代表距离，也未计入山体与建筑遮挡。")}` : ""}</p>
      </div>
    </aside>
  );
}
