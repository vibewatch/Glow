"use client";

import dynamic from "next/dynamic";
import { AlertTriangle, CalendarDays, Check, CloudSun, Crosshair, Database, LocateFixed, MapPin, RefreshCw, Search, Sparkles, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { EventsCatalog, EventsDock, EventsPanel, buildRareEvents, type RareEvent } from "@/components/events-workspace";
import { OpportunityCatalog, OpportunityDock, OpportunityPanel } from "@/components/opportunity-workspace";
import { WeatherCatalog, WeatherDock, WeatherPanel } from "@/components/weather-workspace";
import { closestHour, compass, forecastInstant, localTime } from "@/components/workspace-common";
import { CITIES } from "@/lib/cities";
import { coordinateCity, forecastForLocation, spaceWeatherForecast } from "@/lib/browser-data";
import { buildDailyOpportunities } from "@/lib/opportunities";
import type { City, DailyOpportunity, ForecastResponse, HourlyWeatherPoint, MapAnnotation, OpportunityKind, SpaceWeatherResponse, WeatherView, WorkspaceMode } from "@/lib/types";

const WeatherMap = dynamic(() => import("@/components/weather-map"), {
  ssr: false,
  loading: () => <div className="map-module-loading"><span /><p>地图引擎启动中</p></div>,
});

type LoadingState = "loading" | "updating" | "ready" | "error";

interface WorkspaceDefinition {
  id: WorkspaceMode;
  label: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
}

const WORKSPACES: WorkspaceDefinition[] = [
  { id: "opportunities", label: "每日拍摄机会", shortLabel: "每日机会", description: "同一天的霞光、雾、日月、星空、彩虹与极光", icon: Sparkles },
  { id: "weather", label: "专业天气", shortLabel: "天气", description: "逐小时云层、降雨与风况", icon: CloudSun },
  { id: "events", label: "罕见天象", shortLabel: "天象", description: "日食、月食与流星雨日历", icon: CalendarDays },
];

function LocationSearch({ current, onSelect, onLocate }: { current: City; onSelect: (city: City) => void; onLocate: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return CITIES.slice(0, 9);
    return CITIES.filter((city) => `${city.name}${city.province}${city.region}${city.id}`.toLowerCase().includes(keyword)).slice(0, 10);
  }, [query]);

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    window.addEventListener("pointerdown", dismiss);
    return () => window.removeEventListener("pointerdown", dismiss);
  }, []);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const selectCity = (city: City) => {
    onSelect(city);
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (!filtered.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((currentIndex) => (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length);
      return;
    }
    if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      selectCity(filtered[activeIndex]);
    }
  };

  return (
    <div className="workspace-location" ref={rootRef}>
      <div className="workspace-search">
        <Search size={15} />
        <input
          ref={inputRef}
          role="combobox"
          aria-label="搜索中国城市"
          aria-autocomplete="list"
          aria-controls="city-search-results"
          aria-expanded={open}
          aria-activedescendant={activeIndex >= 0 ? `city-option-${filtered[activeIndex]?.id}` : undefined}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(-1); }}
          onKeyDown={handleKeyDown}
          placeholder={`${current.name} · 搜索城市或在地图落点`}
        />
        {query ? <button type="button" aria-label="清空搜索" onClick={() => { setQuery(""); setActiveIndex(-1); inputRef.current?.focus(); }}><X size={14} /></button> : <span className="search-shortcut">⌘/Ctrl K</span>}
      </div>
      {open && (
        <div className="workspace-results">
          <div className="results-caption"><span>常用观测地</span><small>{filtered.length} 个结果</small></div>
          <div id="city-search-results" className="results-listbox" role="listbox" aria-label="城市搜索结果">
            {filtered.map((city, index) => (
              <button
                key={city.id}
                id={`city-option-${city.id}`}
                type="button"
                role="option"
                aria-selected={current.id === city.id}
                data-active={activeIndex === index ? "true" : undefined}
                onPointerEnter={() => setActiveIndex(index)}
                onClick={() => selectCity(city)}
              >
                <MapPin size={14} />
                <span><strong>{city.name}</strong><small>{city.province} · {city.latitude.toFixed(2)}°N</small></span>
                {current.id === city.id && <Check size={14} />}
              </button>
            ))}
          </div>
          {!filtered.length && <p className="results-empty">未找到城市，可直接在地图上点击任意中国天气区域内的位置。</p>}
          <button className="result-locate" type="button" onClick={() => { onLocate(); setOpen(false); setActiveIndex(-1); }}><LocateFixed size={15} /> 使用当前定位</button>
        </div>
      )}
    </div>
  );
}

function WorkspaceNavigation({ active, onChange }: { active: WorkspaceMode; onChange: (mode: WorkspaceMode) => void }) {
  return (
    <nav className="workspace-navigation" aria-label="工作区">
      {WORKSPACES.map((workspace) => {
        const Icon = workspace.icon;
        return (
          <button
            type="button"
            key={workspace.id}
            aria-label={workspace.label}
            aria-current={active === workspace.id ? "page" : undefined}
            onClick={() => onChange(workspace.id)}
            title={workspace.label}
          >
            <Icon size={16} /><strong>{workspace.shortLabel}</strong>
            <span className="mode-tooltip" aria-hidden="true"><b>{workspace.label}</b><small>{workspace.description}</small></span>
          </button>
        );
      })}
    </nav>
  );
}

function SourceHealth({ sources, generatedAt }: { sources?: ForecastResponse["sources"]; generatedAt?: string }) {
  const available = sources?.filter((source) => source.status === "available").length ?? 0;
  const updated = generatedAt ? localTime(generatedAt) : null;
  const label = sources ? `${available}/${sources.length} 个天气数据源在线${updated ? `，${updated} 更新` : ""}` : "天气数据加载中";
  return (
    <span className="header-health" role="status" title={label} data-state={!sources ? "loading" : available === sources.length ? "healthy" : "degraded"}>
      <Database size={13} /><i aria-hidden="true" />{sources ? `${available}/${sources.length}${updated ? ` · ${updated}` : ""}` : "连接中"}
    </span>
  );
}

function bestOpportunity(items: DailyOpportunity[], notBefore?: number) {
  const scored = items.filter((item) => item.score !== null);
  const upcoming = notBefore === undefined ? scored : scored.filter((item) => forecastInstant(item.end) >= notBefore);
  const candidates = upcoming.length ? upcoming : scored;
  return candidates.reduce<DailyOpportunity | null>((current, item) => !current || (item.score ?? 0) > (current.score ?? 0) ? item : current, null) ?? items[0];
}

function hoursForDay(data: ForecastResponse, date: string) {
  return data.hourly.filter((point) => point.time.startsWith(date));
}

function initialWeatherPoint(data: ForecastResponse, dayIndex: number) {
  const hours = hoursForDay(data, data.days[dayIndex].date);
  if (!hours.length) return null;
  if (dayIndex > 0) return hours.find((point) => point.time.endsWith("12:00")) ?? hours[0];
  const now = Date.now();
  return hours.reduce((current, point) => Math.abs(forecastInstant(point.time) - now) < Math.abs(forecastInstant(current.time) - now) ? point : current, hours[0]);
}

function mapScore(workspace: WorkspaceMode, opportunity: DailyOpportunity | undefined, weather: HourlyWeatherPoint | null, weatherView: WeatherView, event: RareEvent | undefined) {
  if (workspace === "opportunities") return opportunity?.score ?? 45;
  if (workspace === "weather" && weather) {
    if (weatherView === "cloud") return Math.round(weather.totalCloud ?? 0);
    if (weatherView === "rain") return Math.round(weather.precipitationProbability ?? Math.min(100, (weather.precipitation ?? 0) * 30));
    return Math.round(Math.min(100, (weather.windGusts ?? weather.windSpeed ?? 0) * 2));
  }
  if (event?.eclipse) return Math.round(event.eclipse.obscuration * 100);
  if (event?.shower) return Math.min(100, event.shower.zenithalHourlyRate);
  return 45;
}

export function GlowDashboard() {
  const [data, setData] = useState<ForecastResponse | null>(null);
  const [spaceWeather, setSpaceWeather] = useState<SpaceWeatherResponse | null>(null);
  const [status, setStatus] = useState<LoadingState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceMode>("opportunities");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<OpportunityKind>("dusk-glow");
  const [selectedInstant, setSelectedInstant] = useState(0);
  const [weatherTime, setWeatherTime] = useState("");
  const [weatherView, setWeatherView] = useState<WeatherView>("cloud");
  const [selectedEventId, setSelectedEventId] = useState("");
  const requestRef = useRef(0);
  const forecastAbortRef = useRef<AbortController | null>(null);
  const currentCityRef = useRef(CITIES[0]);
  const spaceAbortRef = useRef<AbortController | null>(null);

  const loadSpaceWeather = useCallback(async (force = false) => {
    spaceAbortRef.current?.abort();
    const controller = new AbortController();
    spaceAbortRef.current = controller;
    try {
      const forecast = await spaceWeatherForecast({ force, signal: controller.signal });
      if (!controller.signal.aborted) setSpaceWeather(forecast);
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error("Space weather update failed", error);
      }
    }
  }, []);

  const loadForecast = useCallback(async (city: City, force = false) => {
    const request = ++requestRef.current;
    forecastAbortRef.current?.abort();
    const controller = new AbortController();
    forecastAbortRef.current = controller;
    setStatus((current) => current === "loading" ? "loading" : "updating");
    setError(null);
    try {
      const payload = await forecastForLocation(city, { force, signal: controller.signal });
      if (request !== requestRef.current) return true;
      if (controller.signal.aborted) return false;
      const dayIndex = Math.max(0, Math.min(payload.days.length - 1, payload.recommendedIndex));
      const agenda = buildDailyOpportunities(payload.days[dayIndex], payload.location, null);
      const best = bestOpportunity(agenda, forecastInstant(payload.generatedAt));
      const weather = initialWeatherPoint(payload, dayIndex);
      const events = buildRareEvents(payload);
      setData(payload);
      currentCityRef.current = city;
      setSelectedIndex(dayIndex);
      setSelectedOpportunityId(best.id);
      setSelectedInstant(forecastInstant(best.peak));
      setWeatherTime(weather?.time ?? "");
      setSelectedEventId(events[0]?.id ?? "");
      setStatus("ready");
      forecastAbortRef.current = null;
      return true;
    } catch (reason) {
      if (request !== requestRef.current) return true;
      if (controller.signal.aborted) return false;
      setError(reason instanceof Error ? reason.message : "天气数据加载失败");
      setStatus((current) => current === "updating" ? "ready" : "error");
      return false;
    }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => {
      void loadSpaceWeather();
      void loadForecast(CITIES[0]);
    }, 0);
    return () => {
      window.clearTimeout(task);
      forecastAbortRef.current?.abort();
      spaceAbortRef.current?.abort();
    };
  }, [loadForecast, loadSpaceWeather]);

  const current = data?.location ?? CITIES[0];
  const day = data?.days[selectedIndex] ?? null;
  const opportunities = useMemo(() => data && day ? buildDailyOpportunities(day, data.location, spaceWeather) : [], [data, day, spaceWeather]);
  const selectedOpportunity = opportunities.find((item) => item.id === selectedOpportunityId) ?? opportunities[0];
  const dayHours = useMemo(() => data && day ? hoursForDay(data, day.date) : [], [data, day]);
  const selectedWeather = dayHours.find((point) => point.time === weatherTime) ?? dayHours[0] ?? null;
  const events = useMemo(() => data ? buildRareEvents(data) : [], [data]);
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? events[0];

  const selectDay = (index: number) => {
    if (!data) return;
    setSelectedIndex(index);
    const nextAgenda = buildDailyOpportunities(data.days[index], data.location, spaceWeather);
    const nextBest = bestOpportunity(nextAgenda, Date.now());
    const weather = initialWeatherPoint(data, index);
    setSelectedOpportunityId(nextBest.id);
    setSelectedInstant(forecastInstant(nextBest.peak));
    setWeatherTime(weather?.time ?? "");
  };

  const selectOpportunity = (item: DailyOpportunity) => {
    setSelectedOpportunityId(item.id);
    setSelectedInstant(forecastInstant(item.peak));
  };

  const selectEvent = (event: RareEvent) => setSelectedEventId(event.id);
  const pickCoordinate = useCallback(async (latitude: number, longitude: number) => {
    let city: City;
    try {
      city = coordinateCity(latitude, longitude);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "坐标格式无效");
      return false;
    }
    return loadForecast(city);
  }, [loadForecast]);
  const locate = () => {
    if (!navigator.geolocation) { setError("当前浏览器不支持定位"); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => { void pickCoordinate(coords.latitude, coords.longitude); },
      () => setError("无法获取位置，请检查浏览器定位权限"),
      { maximumAge: 600000, timeout: 8000 },
    );
  };

  const annotations = useMemo<MapAnnotation[]>(() => {
    if (workspace === "opportunities" && selectedOpportunity?.direction) {
      const colors: Partial<Record<OpportunityKind, string>> = { "dawn-glow": "#e9a84b", sunrise: "#e9a84b", sunset: "#d96948", "dusk-glow": "#d96948", moon: "#7466a6", rainbow: "#8a5f9e", aurora: "#3d8f72" };
      return [{ id: selectedOpportunity.id, label: `${selectedOpportunity.direction.label} ${Math.round(selectedOpportunity.direction.azimuth)}°`, azimuth: selectedOpportunity.direction.azimuth, color: colors[selectedOpportunity.id] ?? "#b45135", dashed: true }];
    }
    if (workspace === "weather" && selectedWeather?.windDirection !== null && selectedWeather?.windDirection !== undefined) {
      return [{ id: "wind", label: `来风 ${compass(selectedWeather.windDirection)}`, azimuth: selectedWeather.windDirection, color: "#4b7185" }];
    }
    if (workspace === "events" && selectedEvent?.azimuth !== null && selectedEvent?.azimuth !== undefined) {
      return [{ id: "event", label: `${selectedEvent.kind === "meteor-shower" ? "辐射点" : selectedEvent.kind === "solar-eclipse" ? "太阳方位" : "月亮方位"} ${Math.round(selectedEvent.azimuth)}°`, azimuth: selectedEvent.azimuth, color: selectedEvent.kind === "solar-eclipse" ? "#d97735" : "#675c93", dashed: true }];
    }
    return [];
  }, [selectedEvent, selectedOpportunity, selectedWeather, workspace]);

  const mapFieldPoint = workspace === "weather" ? selectedWeather
    : workspace === "opportunities" && data ? closestHour(data.hourly, new Date(selectedInstant).toISOString())
      : workspace === "events" && data && selectedEvent ? closestHour(data.hourly, selectedEvent.peak) : null;
  const score = mapScore(workspace, selectedOpportunity, selectedWeather, weatherView, selectedEvent);
  const ready = Boolean(data && day && selectedOpportunity && selectedWeather && selectedEvent);

  return (
    <main className="photo-workspace" data-workspace={workspace}>
      <a className="skip-link" href="#workspace">跳到摄影工作区</a>

      <header className="workspace-header">
        <div className="workspace-brand"><BrandMark /><span className="product-edition">PRO</span></div>
        <WorkspaceNavigation active={workspace} onChange={setWorkspace} />
        <LocationSearch current={current} onSelect={(city) => { void loadForecast(city); }} onLocate={locate} />
        <div className="header-status">
          <span className="sr-only" role="status" aria-live="polite">{status === "loading" ? "正在加载天气数据" : status === "updating" ? "正在刷新当前预测" : status === "error" ? "天气数据加载失败" : "预测已更新"}</span>
          <SourceHealth sources={data?.sources} generatedAt={data?.generatedAt} />
          <button
            type="button"
            className={`refresh-forecast ${status === "updating" ? "syncing" : ""}`}
            onClick={() => { void loadForecast(currentCityRef.current, true); void loadSpaceWeather(true); }}
            disabled={status === "loading" || status === "updating"}
            aria-label="刷新当前预测"
          ><RefreshCw size={14} /><span>{status === "updating" ? "刷新中" : "刷新预测"}</span></button>
          <button type="button" className="icon-button" onClick={locate} aria-label="定位我的位置"><Crosshair size={16} /></button>
        </div>
      </header>

      <div className="workspace-body" id="workspace" tabIndex={-1}>
        {ready && data && day && selectedOpportunity && selectedWeather && selectedEvent ? (
          workspace === "opportunities" ? <OpportunityCatalog opportunities={opportunities} selectedId={selectedOpportunity.id} onSelect={selectOpportunity} />
            : workspace === "weather" ? <WeatherCatalog day={day} hours={dayHours} selectedTime={selectedWeather.time} onHour={(point) => setWeatherTime(point.time)} />
              : <EventsCatalog data={data} events={events} selectedId={selectedEvent.id} onSelect={selectEvent} />
        ) : (
          <section className="catalog-rail catalog-loading" aria-label="工作区加载中">
            <div className="loading-heading"><span /><div><i /><b /></div></div>
            <div className="loading-block" /><div className="loading-block short" />
          </section>
        )}

        <section className="map-stage">
          <WeatherMap location={current} mode={workspace} score={score} annotations={annotations} onPick={pickCoordinate} />
          <div className="coordinate-hud">
            <span><i />{current.name}</span>
            <strong>{current.latitude.toFixed(4)}°N</strong>
            <strong>{current.longitude.toFixed(4)}°E</strong>
            <small>WGS 84 · 点击地图或拖动标记改变观测点</small>
          </div>
          {annotations.length > 0 && (
            <div className="map-direction-legend">
              <span style={{ "--legend-color": annotations[0].color } as React.CSSProperties}>{annotations[0].label}</span>
              <small>辅助线只表示方位，长度不表示距离</small>
            </div>
          )}
          {mapFieldPoint && (
            <div className="map-scale-readout" aria-hidden="true">
              <b>{localTime(mapFieldPoint.time)}</b>
              <span>{mapFieldPoint.temperature?.toFixed(0) ?? "—"}°</span>
              <span>云 {mapFieldPoint.totalCloud === null ? "—" : `${Math.round(mapFieldPoint.totalCloud)}%`}</span>
              <span>{mapFieldPoint.windSpeed?.toFixed(0) ?? "—"} km/h</span>
            </div>
          )}
          {status === "updating" && <div className="map-recalculating"><RefreshCw />正在为新落点重算 168 小时数据</div>}
        </section>

        {ready && data && day && selectedOpportunity && selectedWeather && selectedEvent ? (
          workspace === "opportunities" ? <OpportunityPanel data={data} day={day} opportunities={opportunities} selectedId={selectedOpportunity.id} selectedInstant={selectedInstant} spaceWeatherStatus={spaceWeather?.status} onSelect={selectOpportunity} />
            : workspace === "weather" ? <WeatherPanel data={data} point={selectedWeather} hours={dayHours} view={weatherView} onView={setWeatherView} />
              : <EventsPanel data={data} events={events} selectedId={selectedEvent.id} onSelect={selectEvent} />
        ) : (
          <aside className="inspector inspector-loading" aria-label="详情加载中">
            <div className="loading-heading"><span /><div><i /><b /></div></div>
            <div className="loading-score" /><div className="loading-block" /><div className="loading-block short" />
            {status === "error" && <div className="workspace-error"><AlertTriangle /><h1>数据暂时不可用</h1><p>{error}</p><button type="button" onClick={() => { void loadForecast(currentCityRef.current, true); }}>重新连接</button></div>}
          </aside>
        )}
      </div>

      {ready && data && day && selectedOpportunity && selectedWeather && selectedEvent ? (
        workspace === "opportunities" ? <OpportunityDock data={data} day={day} dayIndex={selectedIndex} opportunities={opportunities} selectedId={selectedOpportunity.id} selectedInstant={selectedInstant} onDay={selectDay} onOpportunity={selectOpportunity} onInstant={setSelectedInstant} />
          : workspace === "weather" ? <WeatherDock data={data} day={day} dayIndex={selectedIndex} hours={dayHours} selectedTime={selectedWeather.time} onDay={selectDay} />
            : <EventsDock data={data} events={events} selectedId={selectedEvent.id} onSelect={selectEvent} />
      ) : (
        <div className="planner-timeline dock-loading" aria-hidden="true"><span /><span /></div>
      )}

      <span className="sr-only" role="status" aria-live="polite">当前工作区 {WORKSPACES.find((item) => item.id === workspace)?.label}，地点 {current.name}</span>
      {error && data && <div className="workspace-toast" role="alert"><AlertTriangle size={16} /><span>{error}</span><button type="button" aria-label="关闭错误提示" onClick={() => setError(null)}><X size={14} /></button></div>}
    </main>
  );
}
