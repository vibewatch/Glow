"use client";

import * as maplibregl from "maplibre-gl";
import type { ExpressionSpecification, GeoJSONSource, Map as MapLibreMap, MapMouseEvent, Marker, StyleSpecification } from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/locale-context";
import type { City, MapAnnotation, WorkspaceMode } from "@/lib/types";

interface WeatherMapProps {
  location: City;
  mode: WorkspaceMode;
  score: number;
  annotations: MapAnnotation[];
  onPick: (latitude: number, longitude: number) => Promise<boolean>;
}

/** OpenFreeMap serves OpenMapTiles vector tiles without an API key; labels follow the selected language. */
const DEFAULT_MAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
const CUSTOM_MAP_STYLE = process.env.NEXT_PUBLIC_MAP_STYLE_URL;
const MAP_STYLE = CUSTOM_MAP_STYLE || DEFAULT_MAP_STYLE;
/** Copied from node_modules by scripts/copy-maplibre-worker.mjs; the bundled module cannot locate its own worker. */
const WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";

/** Localize place names and drop street-level clutter that competes with forecast overlays. */
function localizeStyle(map: MapLibreMap, locale: "zh" | "en") {
  const label: ExpressionSpecification = locale === "en"
    ? ["coalesce", ["get", "name:en"], ["get", "name"]]
    : ["coalesce", ["get", "name:zh"], ["get", "name"]];
  const style: StyleSpecification = map.getStyle();
  for (const layer of style.layers) {
    if (layer.type !== "symbol") continue;
    if (/poi|housenumber|highway-shield|road_shield/.test(layer.id)) {
      map.setLayoutProperty(layer.id, "visibility", "none");
      continue;
    }
    if (layer.layout?.["text-field"]) map.setLayoutProperty(layer.id, "text-field", label);
  }
}

function destination(longitude: number, latitude: number, bearing: number, distanceKm = 240) {
  const radius = 6371;
  const angular = distanceKm / radius;
  const startLat = latitude * Math.PI / 180;
  const startLon = longitude * Math.PI / 180;
  const angle = bearing * Math.PI / 180;
  const endLat = Math.asin(Math.sin(startLat) * Math.cos(angular) + Math.cos(startLat) * Math.sin(angular) * Math.cos(angle));
  const endLon = startLon + Math.atan2(Math.sin(angle) * Math.sin(angular) * Math.cos(startLat), Math.cos(angular) - Math.sin(startLat) * Math.sin(endLat));
  return [endLon * 180 / Math.PI, endLat * 180 / Math.PI];
}

function pointData(location: City, score: number, mode: WorkspaceMode) {
  return {
    type: "FeatureCollection" as const,
    features: [{
      type: "Feature" as const,
      properties: { score, mode },
      geometry: { type: "Point" as const, coordinates: [location.longitude, location.latitude] },
    }],
  };
}

export default function WeatherMap({ location, mode, score, annotations, onPick }: WeatherMapProps) {
  const { locale, t } = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  const directionOverlayRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const dragOriginRef = useRef<{ lng: number; lat: number } | null>(null);
  const pickRef = useRef(onPick);
  const initialRef = useRef({ location, mode, score });
  const directionRef = useRef({ location, annotations });
  const localeRef = useRef(locale);
  const [ready, setReady] = useState(false);
  const [warning, setWarning] = useState(false);

  useEffect(() => { pickRef.current = onPick; }, [onPick]);

  const positionDirectionOverlay = useCallback((map: MapLibreMap) => {
    const overlay = directionOverlayRef.current;
    if (!overlay) return;
    const current = directionRef.current;
    const origin = map.project([current.location.longitude, current.location.latitude]);
    current.annotations.forEach((annotation) => {
      const line = overlay.querySelector<HTMLElement>(`i[data-annotation="${annotation.id}"]`);
      const label = overlay.querySelector<HTMLElement>(`span[data-annotation="${annotation.id}"]`);
      if (!line || !label) return;
      const target = destination(current.location.longitude, current.location.latitude, annotation.azimuth);
      const end = map.project(target as [number, number]);
      const dx = end.x - origin.x;
      const dy = end.y - origin.y;
      line.style.left = `${origin.x}px`;
      line.style.top = `${origin.y}px`;
      line.style.width = `${Math.hypot(dx, dy)}px`;
      line.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      line.style.borderColor = annotation.color;
      label.style.left = `${origin.x + dx * .78}px`;
      label.style.top = `${origin.y + dy * .78}px`;
      label.style.borderColor = annotation.color;
    });
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const initial = initialRef.current;
    maplibregl.setWorkerUrl(new URL(WORKER_URL, window.location.origin).href);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [initial.location.longitude, initial.location.latitude],
      zoom: 4.35,
      minZoom: 2.8,
      maxZoom: 15,
      maxBounds: [[69, 12], [140, 57]],
      attributionControl: false,
      pitchWithRotate: false,
      dragRotate: false,
      touchPitch: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false, visualizePitch: false }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({
      compact: true,
      // The style's own sources already carry the OpenStreetMap / OpenMapTiles credits.
      customAttribution: "天气 / Weather · Open-Meteo",
    }), "bottom-left");

    const markerNode = document.createElement("div");
    markerNode.className = "map-pin-marker";
    const ring = document.createElement("span");
    const dot = document.createElement("i");
    const label = document.createElement("b");
    label.textContent = localeRef.current === "en" ? "Drag to relocate" : "拖动定位";
    markerNode.append(ring, dot, label);
    const marker = new maplibregl.Marker({ element: markerNode, draggable: true, anchor: "center" })
      .setLngLat([initial.location.longitude, initial.location.latitude])
      .addTo(map);
    markerRef.current = marker;
    marker.on("dragstart", () => {
      const origin = marker.getLngLat();
      dragOriginRef.current = { lng: origin.lng, lat: origin.lat };
      containerRef.current?.classList.add("map-moving");
    });
    marker.on("dragend", () => {
      containerRef.current?.classList.remove("map-moving");
      const point = marker.getLngLat();
      const origin = dragOriginRef.current;
      void pickRef.current(point.lat, point.lng).then((accepted) => {
        if (!accepted && origin) marker.setLngLat(origin);
        dragOriginRef.current = null;
      });
    });
    map.on("click", (event: MapMouseEvent) => {
      const origin = marker.getLngLat();
      marker.setLngLat(event.lngLat);
      void pickRef.current(event.lngLat.lat, event.lngLat.lng).then((accepted) => {
        if (!accepted) marker.setLngLat(origin);
      });
    });
    map.on("move", () => positionDirectionOverlay(map));
    map.on("error", () => setWarning(true));
    map.once("style.load", () => {
      if (!CUSTOM_MAP_STYLE) localizeStyle(map, localeRef.current);
      map.addSource("forecast-point", { type: "geojson", data: pointData(initial.location, initial.score, initial.mode) });
      map.addLayer({
        id: "forecast-halo",
        type: "circle",
        source: "forecast-point",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 25, 9, 65],
          "circle-color": ["interpolate", ["linear"], ["get", "score"], 0, "#607080", 50, "#ef9a62", 100, "#ed5b47"],
          "circle-opacity": .2,
          "circle-blur": .55,
        },
      });
      setReady(true);
      // Compact attribution opens expanded; on a phone-sized map it covers the basemap, so start collapsed.
      if (map.getContainer().clientWidth < 640) map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
      window.requestAnimationFrame(() => positionDirectionOverlay(map));
    });
    return () => {
      marker.remove();
      map.remove();
      markerRef.current = null;
      mapRef.current = null;
    };
  }, [positionDirectionOverlay]);

  useEffect(() => {
    localeRef.current = locale;
    const label = markerRef.current?.getElement().querySelector("b");
    if (label) label.textContent = t("拖动定位");
    const map = mapRef.current;
    if (map?.isStyleLoaded() && !CUSTOM_MAP_STYLE) localizeStyle(map, locale);
  }, [locale, t]);

  useEffect(() => {
    directionRef.current = { location, annotations };
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    marker.setLngLat([location.longitude, location.latitude]);
    const current = map.getCenter();
    if (Math.abs(current.lng - location.longitude) > 2.5 || Math.abs(current.lat - location.latitude) > 2.5) {
      containerRef.current?.classList.add("map-moving");
      map.easeTo({ center: [location.longitude, location.latitude], duration: 650, zoom: Math.max(map.getZoom(), 5) });
      map.once("moveend", () => containerRef.current?.classList.remove("map-moving"));
    }
    (map.getSource("forecast-point") as GeoJSONSource | undefined)?.setData(pointData(location, score, mode));
    marker.getElement().style.setProperty("--pin-score", `${score}%`);
    marker.getElement().dataset.mode = mode;
    window.requestAnimationFrame(() => positionDirectionOverlay(map));
  }, [annotations, location, mode, positionDirectionOverlay, score]);

  return (
    <div className="weather-map" ref={containerRef} data-map-ready={ready ? "true" : "false"} role="region" aria-label={t("可点击和拖动定位点的中国天气地图")}>
      <div className="map-direction-overlay" ref={directionOverlayRef} aria-hidden="true">
        {annotations.map((annotation) => (
          <span className="map-bearing" key={annotation.id}>
            <i data-annotation={annotation.id} data-dashed={annotation.dashed ? "true" : undefined} />
            <span data-annotation={annotation.id}>{annotation.label}</span>
          </span>
        ))}
      </div>
      {!ready && <div className="map-loading"><span /><p>{t("正在绘制地理底图")}</p></div>}
      {warning && <div className="map-warning">{t("部分底图瓦片暂不可用，定位与预测仍可使用")}</div>}
    </div>
  );
}
