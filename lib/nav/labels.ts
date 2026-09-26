// labels.ts — the word a person sees for a nav verb, in their language.
//
// Kept apart from lib/nav.ts so that module stays pure (scripts/verify_nav.mjs
// compiles it with plain tsc and runs it under node, no "@/" alias). Boris's
// nouns, 2026-09-26: Service · Menu · Supplies · Money · Team · Comms —
// Servicio · Carta · Compras · Caja · Equipo · Comunicación. Rows live in
// lib/i18nDict.ts under nav.verb.<key>.

import { HOUSE_VERBS, type NavVerb } from "@/lib/nav";
import { resolve, FALLBACK_LANG, type Lang } from "@/lib/i18nDict";

export function verbLabel(v: Pick<NavVerb, "key" | "label">, lang: Lang = FALLBACK_LANG): string {
  const key = "nav.verb." + v.key;
  const word = resolve(key, lang);
  return word === key ? v.label : word;
}

// The noun for a house verb by key, for page eyebrows ("Menu" → "Carta").
// Falls back to the EN label in lib/nav.ts, then to the key itself.
export function verbWord(key: string, lang: Lang = FALLBACK_LANG): string {
  const v = HOUSE_VERBS.find((x) => x.key === key);
  return v ? verbLabel(v, lang) : key;
}
