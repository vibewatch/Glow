"use client";

import { useLocale } from "@/components/locale-context";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const { locale, t } = useLocale();
  return (
    <span className="brand" aria-label={t("霁光")}>
      <span className="brand-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {!compact && (
        <span className="brand-name">
          <strong>{locale === "en" ? "GLOW" : "霁光"}</strong>
          <small>JIGUANG</small>
        </span>
      )}
    </span>
  );
}
