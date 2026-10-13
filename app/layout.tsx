import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

const GOOGLE_ANALYTICS_ID = "G-6W7F2188X6";

export const metadata: Metadata = {
  title: "霁光 Glow PRO · 风光摄影天气地图",
  description: "在地图上放置观测点，融合专业气象与天文数据规划风光摄影。Plan landscape photography with professional weather and astronomy data.",
  keywords: ["风光摄影", "天气地图", "landscape photography", "weather map", "朝霞", "晚霞", "雾景", "彩虹", "星空", "日食", "ECMWF", "CMA"],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f4efe8",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        {children}
        <Script src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_ID}`} strategy="afterInteractive" />
        <Script id="google-analytics" strategy="afterInteractive">
          {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GOOGLE_ANALYTICS_ID}');`}
        </Script>
      </body>
    </html>
  );
}
