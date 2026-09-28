export type EventKind = "dawn" | "dusk";

export interface City {
  id: string;
  name: string;
  province: string;
  latitude: number;
  longitude: number;
  timezone: string;
  region: "华北" | "东北" | "华东" | "华中" | "华南" | "西南" | "西北";
}

export interface LightPathSample {
  distanceKm: number;
  lowCloud: number | null;
  midCloud: number | null;
  highCloud: number | null;
}

/** A contiguous interval where the opportunity index stays close to its peak. */
export interface ForecastWindow {
  start: string;
  end: string;
}

export interface SkyMetrics {
  lowCloud: number | null;
  midCloud: number | null;
  highCloud: number | null;
  humidity: number | null;
  visibility: number | null;
  precipitationProbability: number | null;
  precipitation: number | null;
  aerosolOpticalDepth: number | null;
  pm25: number | null;
}

export type PhotographyMode = "glow" | "fog" | "sun" | "moon" | "stars" | "lunar-eclipse" | "solar-eclipse";
export type WeatherAnalysisMode = "cloud" | "rain" | "rainbow";
export type WorkspaceMode = "opportunities" | "weather" | "events";
export type WeatherView = "cloud" | "rain" | "wind";
export type OpportunityKind = "dawn-glow" | "sunrise" | "fog" | "rainbow" | "sunset" | "dusk-glow" | "moon" | "stars" | "aurora";

export interface MapAnnotation {
  id: string;
  label: string;
  azimuth: number;
  color: string;
  dashed?: boolean;
}

export interface DailyOpportunity {
  id: OpportunityKind;
  kind: OpportunityKind;
  title: string;
  shortTitle: string;
  start: string;
  peak: string;
  end: string;
  score: number | null;
  scoreType: "opportunity-index" | "geometry-only";
  confidence: number | null;
  status: "excellent" | "watch" | "poor" | "unavailable";
  summary: string;
  limitation: string;
  direction: { azimuth: number; label: string } | null;
  details: { label: string; value: string }[];
  /** Signed score contributions, largest first; empty for geometry-only items. */
  factors: ScoreResult["contributions"];
  /** Per-model index before averaging; their spread is the uncertainty signal. */
  models: { model: string; score: number | null }[];
}

export interface HourlyWeatherPoint {
  time: string;
  temperature: number | null;
  dewPoint: number | null;
  humidity: number | null;
  totalCloud: number | null;
  lowCloud: number | null;
  midCloud: number | null;
  highCloud: number | null;
  visibility: number | null;
  precipitationProbability: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  windGusts: number | null;
  windDirection: number | null;
  pressure: number | null;
  aerosolOpticalDepth: number | null;
  rain: number | null;
  showers: number | null;
  weatherCode: number | null;
  directRadiation: number | null;
  solarAltitude: number;
  solarAzimuth: number;
}

export interface WeatherAnalysisMetrics {
  totalCloud: number | null;
  lowCloud: number | null;
  midCloud: number | null;
  highCloud: number | null;
  precipitationProbability: number | null;
  precipitation: number | null;
  rain: number | null;
  showers: number | null;
  directRadiation: number | null;
  solarAltitude: number;
  solarAzimuth: number;
  weatherCode: number | null;
}

export interface WeatherAnalysisForecast {
  time: string;
  score: number | null;
  confidence: number;
  level: string;
  summary: string;
  metrics: WeatherAnalysisMetrics;
  modelScores: { model: string; score: number | null }[];
  viewingAzimuth: number | null;
}

export interface WeatherAnalysisSet {
  cloud: WeatherAnalysisForecast;
  rain: WeatherAnalysisForecast;
  rainbow: WeatherAnalysisForecast;
}

export interface FogMetrics {
  temperature: number | null;
  dewPoint: number | null;
  humidity: number | null;
  lowCloud: number | null;
  visibility: number | null;
  windSpeed: number | null;
  precipitation: number | null;
}

export interface FogForecast {
  time: string;
  window: ForecastWindow;
  probability: number;
  confidence: number;
  level: "很高" | "较高" | "一般" | "较低";
  summary: string;
  metrics: FogMetrics;
  contributions: ScoreResult["contributions"];
  modelScores: { model: string; probability: number }[];
}

export interface SolarWindow {
  /** Upper-limb sunrise/sunset from Astronomy Engine, to the second (ISO instant). */
  sunriseAt: string | null;
  sunsetAt: string | null;
  morningBlueStart: string | null;
  sunriseAzimuth: number | null;
  morningGoldenEnd: string | null;
  eveningGoldenStart: string | null;
  sunsetAzimuth: number | null;
  eveningBlueEnd: string | null;
  eveningAstronomicalStart: string | null;
  morningAstronomicalEnd: string | null;
  astronomicalDarknessMinutes: number;
  daylightMinutes: number;
}

export interface EclipseForecast {
  kind: "penumbral" | "partial" | "annular" | "total";
  peak: string;
  begin: string;
  end: string;
  obscuration: number;
  altitude: number;
  azimuth: number;
  visible: boolean;
}

export interface MeteorShowerForecast {
  id: string;
  name: string;
  peak: string;
  activeStart: string;
  activeEnd: string;
  peakPrecision: "night-range";
  /** Solar longitude (J2000) of the IMO maximum used to derive `peak`. */
  solarLongitude: number;
  /** Darkest hour near the peak with the radiant highest; radiant and moon values refer to this instant. */
  bestViewing: string;
  zenithalHourlyRate: number;
  radiant: string;
  radiantAltitude: number;
  radiantAzimuth: number;
  viewingAdvice: string;
  moonIllumination: number;
  source: string;
}

export interface MoonGeometry {
  calculatedAt: string;
  phaseAngle: number;
  phaseName: string;
  illumination: number;
  altitude: number;
  azimuth: number;
  rise: string | null;
  set: string | null;
}

export interface AstronomySummary {
  nextLunarEclipse: EclipseForecast;
  nextSolarEclipse: EclipseForecast;
  meteorShowers: MeteorShowerForecast[];
}

export interface SpaceWeatherKpPoint {
  time: string;
  kp: number;
  status: "observed" | "estimated" | "predicted";
  scale: string | null;
}

export interface SpaceWeatherResponse {
  status: "available" | "unavailable";
  generatedAt: string;
  validUntil: string | null;
  source: {
    name: "NOAA SWPC";
    url: string;
  };
  points: SpaceWeatherKpPoint[];
  message: string;
}

export interface NightWeatherMetrics {
  temperature: number | null;
  dewPoint: number | null;
  humidity: number | null;
  lowCloud: number | null;
  midCloud: number | null;
  highCloud: number | null;
  visibility: number | null;
  precipitationProbability: number | null;
  precipitation: number | null;
  windSpeed: number | null;
  windGusts: number | null;
  windDirection: number | null;
}

export interface MoonForecast extends MoonGeometry {
  time: string;
  window: ForecastWindow;
  probability: number;
  confidence: number;
  level: "极佳" | "值得期待" | "可以等等" | "机会较低";
  summary: string;
  weather: NightWeatherMetrics;
  contributions: ScoreResult["contributions"];
  modelScores: { model: string; probability: number }[];
}

export interface NightForecast {
  time: string;
  window: ForecastWindow;
  astronomicalDusk: string | null;
  astronomicalDawn: string | null;
  darknessMinutes: number;
  sunAltitude: number;
  probability: number;
  confidence: number;
  level: "极佳" | "值得期待" | "可以等等" | "机会较低";
  summary: string;
  moon: MoonGeometry;
  weather: NightWeatherMetrics;
  contributions: ScoreResult["contributions"];
  modelScores: { model: string; probability: number }[];
}

export interface ScoreResult {
  probability: number;
  rawScore: number;
  completeness: number;
  contributions: {
    name: string;
    value: number;
    direction: "positive" | "negative" | "neutral";
    detail: string;
  }[];
}

export interface GlowTimelinePoint {
  time: string;
  probability: number;
  solarAltitude: number;
}

export interface EventForecast {
  kind: EventKind;
  time: string;
  window: ForecastWindow;
  /** Geometric solar altitude at the peak (degrees). */
  solarAltitude: number;
  /** Opportunity index scanned every two minutes across the twilight, averaged over available models. */
  timeline: GlowTimelinePoint[];
  lightPath: {
    status: "available" | "unavailable";
    azimuth: number;
    samples: LightPathSample[];
  };
  probability: number;
  confidence: number;
  level: "极佳" | "值得期待" | "可以等等" | "机会较低";
  summary: string;
  metrics: SkyMetrics;
  contributions: ScoreResult["contributions"];
  modelScores: { model: string; probability: number }[];
}

export interface DayForecast {
  date: string;
  weekday: string;
  shortDate: string;
  sunrise: string;
  sunset: string;
  dawn: EventForecast;
  dusk: EventForecast;
  fog: FogForecast;
  solar: SolarWindow;
  moon: MoonForecast;
  night: NightForecast;
  weather: WeatherAnalysisSet;
}

export interface ForecastResponse {
  location: City & { elevation: number | null };
  generatedAt: string;
  recommendedIndex: number;
  days: DayForecast[];
  hourly: HourlyWeatherPoint[];
  astronomy: AstronomySummary;
  sources: {
    id: string;
    name: string;
    role: string;
    status: "available" | "unavailable";
  }[];
  provenance: {
    delivery: "Open-Meteo";
    access: "open-access" | "customer";
    license: "CC BY 4.0";
    modelGuidance: true;
    warningAuthority: false;
  };
  disclaimer: string;
}
