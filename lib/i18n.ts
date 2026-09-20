"use client";
// Three-language client scaffold. Dictionary + resolver live in lib/i18nDict.ts
// so server components can import t() without crossing the "use client" boundary.
// Boris locked 2026-06-09: each profile picks a language.
// 2026-09-20 runway d2: added Dutch (NL) for the Amsterdam launch (30-Sep).
//
// Cookie: fs_lang (en | es | nl). Persists a year, per device.
// NL strings marked "[NL:REVIEW]" are best-guess hospitality Dutch pending
// review with the Amsterdam owner — Boris's rule: mark, don't invent.

import { resolve, LANGS, LANG_LABEL, FALLBACK_LANG, langForCountry } from "@/lib/i18nDict";
import type { Lang } from "@/lib/i18nDict";

export type { Lang };
export { LANGS, LANG_LABEL, langForCountry };

function normaliseLang(v: string | null | undefined): Lang | null {
  if (v === "en" || v === "es" || v === "nl") return v;
  return null;
}

export function getLang(): Lang {
  if (typeof document === "undefined") return FALLBACK_LANG;
  const m = document.cookie.match(/(?:^|;\s*)fs_lang=([a-z]{2})/);
  return (m && normaliseLang(m[1])) || FALLBACK_LANG;
}

export function setLang(l: Lang) {
  if (typeof document === "undefined") return;
  document.cookie = "fs_lang=" + l + "; path=/; max-age=" + 60 * 60 * 24 * 365;
  // Reload so server components also pick it up
  if (typeof window !== "undefined") window.location.reload();
}

export function t(key: string, lang?: Lang): string {
  return resolve(key, lang || getLang());
}
