import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "霁光 PRO · 风光摄影天气地图",
  description: "在地图上放置观测点，融合专业气象与天文数据规划霞光、雾景、云雨、彩虹、星空、日月升落及食象摄影。",
  keywords: ["风光摄影", "天气地图", "朝霞", "晚霞", "雾景", "云层", "降雨", "彩虹", "星空", "日出", "月食", "日食", "ECMWF", "CMA"],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4efe8",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
