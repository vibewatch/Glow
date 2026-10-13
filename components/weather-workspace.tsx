"use client";

import { Cloud, CloudRain, CloudSun, Droplets, Navigation, Wind } from "lucide-react";
import { useLocale, type Locale } from "@/components/locale-context";
import type { DayForecast, ForecastResponse, HourlyWeatherPoint, WeatherView } from "@/lib/types";
import { CatalogHead, DateTabs, DockAstro, SourceDisclosure, compass, localTime, shortDate } from "@/components/workspace-common";
import { InsightSection } from "@/components/insight-graphics";

export function wmoLabel(code: number | null, locale: Locale = "zh") {
  const labels = locale === "en"
    ? ["Weather condition pending", "Clear", "Cloudy", "Fog or haze", "Drizzle", "Rain", "Snow", "Showers", "Snow showers", "Thunderstorms"]
    : ["天气现象待更新", "晴朗", "多云", "雾或霾", "毛毛雨", "降雨", "降雪", "阵雨", "阵雪", "雷暴天气"];
  if (code === null) return labels[0];
  if (code === 0) return labels[1];
  if (code <= 3) return labels[2];
  if (code <= 48) return labels[3];
  if (code <= 57) return labels[4];
  if (code <= 67) return labels[5];
  if (code <= 77) return labels[6];
  if (code <= 82) return labels[7];
  if (code <= 86) return labels[8];
  return labels[9];
}

function value(value: number | null, unit: string, digits = 0) {
  return value === null ? "—" : `${value.toFixed(digits)}${unit}`;
}

function WeatherIcon({ point }: { point: HourlyWeatherPoint }) {
  if ((point.precipitation ?? 0) > 0.1 || (point.precipitationProbability ?? 0) >= 45) return <CloudRain />;
  if ((point.totalCloud ?? 0) >= 70) return <Cloud />;
  return <CloudSun />;
}

/** Left rail: the full 24 hour ladder as scannable rows instead of a cramped horizontal strip. */
export function WeatherCatalog({ day, hours, selectedTime, onHour }: {
  day: DayForecast;
  hours: HourlyWeatherPoint[];
  selectedTime: string;
  onHour: (point: HourlyWeatherPoint) => void;
}) {
  const { locale, t } = useLocale();
  const temperatures = hours.flatMap((item) => item.temperature === null ? [] : [item.temperature]);
  const high = temperatures.length ? Math.max(...temperatures) : null;
  const low = temperatures.length ? Math.min(...temperatures) : null;
  const rainHours = hours.filter((item) => (item.precipitationProbability ?? 0) >= 40).length;
  const selectedIndex = Math.max(0, hours.findIndex((item) => item.time === selectedTime));
  const move = (index: number, key: string) => {
    const next = key === "ArrowDown" || key === "ArrowRight" ? Math.min(hours.length - 1, index + 1)
      : key === "ArrowUp" || key === "ArrowLeft" ? Math.max(0, index - 1)
        : key === "Home" ? 0
          : key === "End" ? hours.length - 1
            : index;
    if (next !== index) {
      onHour(hours[next]);
      window.requestAnimationFrame(() => document.getElementById(`weather-hour-${next}`)?.focus());
    }
  };
  return (
    <section className="catalog-rail" aria-label={t("逐小时天气列表")}>
      <CatalogHead icon={CloudSun} eyebrow="POINT WEATHER" title={t("天气工作台")} badge={locale === "en" ? `${hours.length} hours` : `${hours.length} 小时`} />
      <div className="catalog-scroll">
        <p className="catalog-summary">
          <strong>{locale === "en" ? `${shortDate(day.date, locale)} high ${value(high, "°")} · low ${value(low, "°")}` : `${day.shortDate} 最高 ${value(high, "°")} · 最低 ${value(low, "°")}`}</strong>
          <span>{rainHours ? locale === "en" ? `${rainHours} hours with precipitation chance ≥ 40%` : `${rainHours} 个小时降水概率 ≥ 40%` : t("全天没有高降水概率时段")}。{t("逐小时为所选点位的单点预报。")}</span>
        </p>
        <div className="hour-list" role="listbox" aria-label={locale === "en" ? `${shortDate(day.date, locale)} hourly weather` : `${day.shortDate}逐小时天气`}>
          {hours.map((point, index) => (
            <button
              id={`weather-hour-${index}`}
              key={point.time}
              type="button"
              role="option"
              tabIndex={index === selectedIndex ? 0 : -1}
              aria-selected={index === selectedIndex}
              onKeyDown={(event) => {
                if (["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  move(index, event.key);
                }
              }}
              onClick={() => onHour(point)}
            >
              <span className="hour-time">{localTime(point.time)}</span>
              <span className="hour-icon"><WeatherIcon point={point} /></span>
              <strong>{point.temperature === null ? "—" : `${Math.round(point.temperature)}°`}</strong>
              <span className="hour-cloud" title={`${t("总云量")} ${value(point.totalCloud, "%")}`}><i style={{ width: `${point.totalCloud ?? 0}%` }} /></span>
              <small>{point.precipitationProbability === null ? "—" : `${Math.round(point.precipitationProbability)}%`}</small>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Full width meteogram: cloud shading, rain bars and the temperature curve of the selected day. */
function DockMeteogram({ hours, selectedTime }: { hours: HourlyWeatherPoint[]; selectedTime: string }) {
  const { locale, t } = useLocale();
  if (hours.length < 2) return <div className="dock-meteogram-empty">{t("该日期暂无逐小时数据")}</div>;
  const width = hours.length * 10;
  const temperatures = hours.map((point) => point.temperature ?? 0);
  const low = Math.min(...temperatures);
  const span = Math.max(1, Math.max(...temperatures) - low);
  const rainPeak = Math.max(1, ...hours.map((point) => point.precipitation ?? 0));
  const line = hours.map((point, index) => `${index * 10 + 5},${32 - ((point.temperature ?? low) - low) / span * 24}`).join(" ");
  const selectedIndex = Math.max(0, hours.findIndex((point) => point.time === selectedTime));
  return (
    <div className="dock-meteogram">
      <svg viewBox={`0 0 ${width} 40`} preserveAspectRatio="none" role="img" aria-label={locale === "en" ? `Hourly cloud, precipitation and temperature trend; selected ${localTime(selectedTime)}` : `逐小时云量、降水与气温趋势，当前选中 ${localTime(selectedTime)}`}>
        {hours.map((point, index) => <rect key={`cloud-${point.time}`} className="meteo-cloud" x={index * 10} y="0" width="10" height="40" opacity={(point.totalCloud ?? 0) / 100 * 0.5} />)}
        {hours.map((point, index) => <rect key={`rain-${point.time}`} className="meteo-rain" x={index * 10 + 3} width="4" y={40 - (point.precipitation ?? 0) / rainPeak * 22} height={(point.precipitation ?? 0) / rainPeak * 22} />)}
        <polyline className="meteo-temp" points={line} vectorEffect="non-scaling-stroke" />
        <line className="meteo-cursor" x1={selectedIndex * 10 + 5} x2={selectedIndex * 10 + 5} y1="0" y2="40" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="meteo-axis" aria-hidden="true">
        {hours.filter((_, index) => index % 3 === 0).map((point) => <span key={point.time}>{localTime(point.time).slice(0, 2)}</span>)}
      </div>
    </div>
  );
}

export function WeatherDock({ data, day, dayIndex, hours, selectedTime, onDay }: {
  data: ForecastResponse;
  day: DayForecast;
  dayIndex: number;
  hours: HourlyWeatherPoint[];
  selectedTime: string;
  onDay: (index: number) => void;
}) {
  const { locale, t } = useLocale();
  const point = hours.find((item) => item.time === selectedTime) ?? hours[0];
  return (
    <div className="planner-timeline weather-dock" aria-label={t("日期与逐小时天气趋势")}>
      <div className="dock-lead">
        <span className="dock-eyebrow"><CloudSun size={12} /> {wmoLabel(point?.weatherCode ?? null, locale)}</span>
        <strong>{localTime(selectedTime)}</strong>
        <small>{shortDate(day.date, locale)} · {point?.temperature === null || point === undefined ? "—" : `${Math.round(point.temperature)}°`} · {t("云")} {value(point?.totalCloud ?? null, "%")}</small>
      </div>
      <div className="dock-main">
        <DateTabs data={data} selected={dayIndex} onSelect={onDay} label="七天天气日期" />
        <DockMeteogram hours={hours} selectedTime={selectedTime} />
      </div>
      <DockAstro day={day} />
    </div>
  );
}

function CloudDetail({ point, hours }: { point: HourlyWeatherPoint; hours: HourlyWeatherPoint[] }) {
  const { locale, t } = useLocale();
  const layers = [
    { label: t("高云"), value: point.highCloud, className: "high" },
    { label: t("中云"), value: point.midCloud, className: "mid" },
    { label: t("低云"), value: point.lowCloud, className: "low" },
  ];
  return (
    <section className="weather-detail" aria-label={t("云层详情")}>
      <header><span><Cloud /> {t("云层垂直结构")}</span><strong>{t("总云量")} {value(point.totalCloud, "%")}</strong></header>
      <div className="layer-profile">
        {layers.map((layer) => <span key={layer.label}><small>{layer.label}</small><i className={layer.className}><b style={{ width: `${layer.value ?? 0}%` }} /></i><strong>{value(layer.value, "%")}</strong></span>)}
      </div>
      <div className="hour-bars cloud-bars" aria-label={t("24小时总云量趋势")}>
        {hours.map((hour) => <i key={hour.time} style={{ height: `${Math.max(3, (hour.totalCloud ?? 0) * .52)}px` }} title={locale === "en" ? `${localTime(hour.time)} cloud ${value(hour.totalCloud, "%")}` : `${localTime(hour.time)} 云量 ${value(hour.totalCloud, "%")}`}><span>{localTime(hour.time).slice(0, 2)}</span></i>)}
      </div>
      <p>{t("低云更容易遮住地平线，高云有时能提供霞光纹理；总云量本身不代表摄影质量。")}</p>
    </section>
  );
}

function RainDetail({ point, hours }: { point: HourlyWeatherPoint; hours: HourlyWeatherPoint[] }) {
  const { locale, t } = useLocale();
  const max = Math.max(1, ...hours.map((hour) => hour.precipitation ?? 0));
  return (
    <section className="weather-detail" aria-label={t("降雨详情")}>
      <header><span><CloudRain /> {t("降水时段与量级")}</span><strong>{wmoLabel(point.weatherCode, locale)}</strong></header>
      <div className="detail-metrics">
        <span><small>{t("降水概率")}</small><strong>{value(point.precipitationProbability, "%")}</strong></span>
        <span><small>{t("小时降水")}</small><strong>{value(point.precipitation, " mm", 1)}</strong></span>
        <span><small>{t("连续性雨")}</small><strong>{value(point.rain, " mm", 1)}</strong></span>
        <span><small>{t("阵雨")}</small><strong>{value(point.showers, " mm", 1)}</strong></span>
      </div>
      <div className="hour-bars rain-bars" aria-label={t("24小时降水量趋势")}>
        {hours.map((hour) => <i key={hour.time} style={{ height: `${Math.max(3, (hour.precipitation ?? 0) / max * 52)}px` }} title={locale === "en" ? `${localTime(hour.time)} precipitation ${value(hour.precipitation, " mm", 1)}` : `${localTime(hour.time)} 降水 ${value(hour.precipitation, " mm", 1)}`}><span>{localTime(hour.time).slice(0, 2)}</span></i>)}
      </div>
      <p>{t("概率与实际量级分开显示；CMA 缺少概率字段时保持为空，不把综合信号冒充概率。")}</p>
    </section>
  );
}

function WindDetail({ point, hours }: { point: HourlyWeatherPoint; hours: HourlyWeatherPoint[] }) {
  const { locale, t } = useLocale();
  const max = Math.max(1, ...hours.map((hour) => hour.windGusts ?? hour.windSpeed ?? 0));
  return (
    <section className="weather-detail" aria-label={t("风况详情")}>
      <header><span><Wind /> {t("风速、阵风与来向")}</span><strong>{compass(point.windDirection, locale)}</strong></header>
      <div className="wind-current">
        <span className="wind-compass"><Navigation style={{ transform: `rotate(${(point.windDirection ?? 0) + 180}deg)` }} /><small>{t("箭头指向风吹去的方向")}</small></span>
        <div><small>{t("持续风")}</small><strong>{value(point.windSpeed, " km/h")}</strong><small>{t("阵风")}</small><strong>{value(point.windGusts, " km/h")}</strong></div>
      </div>
      <div className="hour-bars wind-bars" aria-label={t("24小时阵风趋势")}>
        {hours.map((hour) => <i key={hour.time} style={{ height: `${Math.max(3, (hour.windGusts ?? hour.windSpeed ?? 0) / max * 52)}px` }} title={`${localTime(hour.time)} ${t("阵风")} ${value(hour.windGusts, " km/h")}`}><span>{localTime(hour.time).slice(0, 2)}</span></i>)}
      </div>
      <p>{t("来风方向表示风从哪里吹来。阵风超过约 30 km/h 时，长焦、脚架与水面倒影的稳定性会明显下降。")}</p>
    </section>
  );
}

export function WeatherPanel({ data, point, hours, view, onView }: {
  data: ForecastResponse;
  point: HourlyWeatherPoint;
  hours: HourlyWeatherPoint[];
  view: WeatherView;
  onView: (view: WeatherView) => void;
}) {
  const { locale, t } = useLocale();
  const dewGap = point.temperature !== null && point.dewPoint !== null ? point.temperature - point.dewPoint : null;
  return (
    <aside className="inspector weather-inspector" aria-label={t("所选时刻天气详情")}>
      <header className="inspector-head">
        <div><small>SELECTED HOUR</small><strong>{t(data.location.name)} · {localTime(point.time)}</strong></div>
      </header>
      <div className="inspector-scroll" id="workspace-detail" role="tabpanel">
        <section className="weather-hero">
          <span className="weather-hero-icon"><WeatherIcon point={point} /></span>
          <div><h2>{wmoLabel(point.weatherCode, locale)}</h2><p>{t("露点")} {value(point.dewPoint, "°")} · {t("气压")} {value(point.pressure, " hPa")}</p></div>
          <strong>{point.temperature === null ? "—" : `${Math.round(point.temperature)}°`}</strong>
        </section>
        <div className="weather-overview" aria-label={t("云雨风概览")}>
          <button type="button" aria-pressed={view === "cloud"} onClick={() => onView("cloud")}><Cloud /><span><small>{t("总云量")}</small><strong>{value(point.totalCloud, "%")}</strong></span></button>
          <button type="button" aria-pressed={view === "rain"} onClick={() => onView("rain")}><Droplets /><span><small>{t("降水概率")}</small><strong>{value(point.precipitationProbability, "%")}</strong></span></button>
          <button type="button" aria-pressed={view === "wind"} onClick={() => onView("wind")}><Wind /><span><small>{t("风 / 阵风")}</small><strong>{value(point.windSpeed, "")} / {value(point.windGusts, "")}</strong></span></button>
        </div>
        <div className="weather-view-tabs" role="tablist" aria-label={t("天气详情分类")}>
          {(["cloud", "rain", "wind"] as WeatherView[]).map((item) => (
            <button key={item} type="button" role="tab" aria-selected={view === item} onClick={() => onView(item)}>{t(item === "cloud" ? "云层" : item === "rain" ? "降雨" : "风况")}</button>
          ))}
        </div>
        {view === "cloud" && <CloudDetail point={point} hours={hours} />}
        {view === "rain" && <RainDetail point={point} hours={hours} />}
        {view === "wind" && <WindDetail point={point} hours={hours} />}
        <InsightSection title={t("现场细节")} meta={t("点位预报")}>
          <dl className="reading-grid">
            <div><dt>{t("露点差")}</dt><dd>{value(dewGap, "°", 1)}</dd></div>
            <div><dt>{t("能见度")}</dt><dd>{point.visibility === null ? "—" : `${Math.round(point.visibility / 1000)} km`}</dd></div>
            <div><dt>{t("来风方向")}</dt><dd>{compass(point.windDirection, locale)}</dd></div>
            <div><dt>{t("地面气压")}</dt><dd>{value(point.pressure, " hPa")}</dd></div>
            <div><dt>{t("直射辐射")}</dt><dd>{value(point.directRadiation, " W/m²")}</dd></div>
            <div><dt>{t("太阳高度")}</dt><dd>{point.solarAltitude.toFixed(1)}°</dd></div>
          </dl>
        </InsightSection>
        <p className="weather-map-boundary">{t("当前为所选位置的单点 168 小时预报。没有接入授权的雷达/网格瓦片前，地图不会伪造全国云图、雨图或风场。")}</p>
        <SourceDisclosure data={data} />
      </div>
    </aside>
  );
}
