// labels.ts — the word a person sees for a nav verb, in their language.
//
// Kept apart from lib/nav.ts so that module stays pure (scripts/verify_nav.mjs
// compiles it with plain tsc and runs it under node, no "@/" alias). Boris's
// nouns, 2026-09-26: Service · Menu · Supplies · Money · Team · Comms —
// Servicio · Carta · Compras · Caja · Equipo · Comunicación. Rows live in
// lib/i18nDict.ts under nav.verb.<key>.

import type { NavVerb } from "@/lib/nav";
import { resolve, FALLBACK_LANG, type Lang } from "@/lib/i18nDict";

export function verbLabel(v: Pick<NavVerb, "key" | "label">, lang: Lang = FALLBACK_LANG): string {
  const key = "nav.verb." + v.key;
  const word = resolve(key, lang);
  return word === key ? v.label : word;
}
