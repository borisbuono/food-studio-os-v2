import { cookies } from "next/headers";
import { resolve, FALLBACK_LANG } from "@/lib/i18nDict";
import type { Lang } from "@/lib/i18nDict";

export type { Lang };

export function serverLang(): Lang {
  const c = cookies().get("fs_lang")?.value;
  if (c === "es") return "es";
  if (c === "nl") return "nl";
  return FALLBACK_LANG;
}

// Server-side t(). Pass an explicit lang (usually from serverLang()) so it's
// deterministic — no cookie read per call and no client boundary crossed.
export function tServer(key: string, lang: Lang): string {
  return resolve(key, lang);
}
