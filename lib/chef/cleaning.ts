// lib/chef/cleaning.ts — Chef readers for the cleaning module (cleaning S4, 2026-10-02).
//
// Three intents: "qué falta de limpieza" (cleaning_today → one card, open count
// per list), "marca la campana limpia" (cleaning_tick → fuzzy label on TODAY's
// open lines, read-back first, then the tick goes through cleaning_tick() as
// the caller), "firma el cierre" (cleaning_sign → managers, read-back, tap).
// Reads use the caller's session; RLS decides. Nothing here touches
// observations — staff names are the record, not log material.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChefAction, ChefCard, ChefLang } from "@/lib/chef/types";
import type { CleaningRun, CleaningRunItem } from "@/lib/cleaning/types";
import { loadToday } from "@/lib/cleaning/server";

export type CleaningReadScope = { entity_id: string; entity_name: string; house: string | null; tz: string };

function tzDate(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
export function cleaningHref(house: string | null) { return house ? `/h/${house}/service/cleaning` : "/"; }

const STOP = new Set(["la", "el", "los", "las", "de", "del", "y", "the", "a", "an", "of", "and", "clean", "limpia", "limpio", "limpiar", "hecho", "hecha", "done", "listo", "lista", "está", "esta", "is", "mark", "marca", "tick"]);
export function norm(s: string): string {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ\s]+/g, " ").replace(/\s+/g, " ").trim();
}
function tokens(s: string): string[] { return norm(s).split(" ").filter((w) => w && !STOP.has(w)); }
// Spanish/English synonyms the team uses for the same equipment.
const SYN: Record<string, string[]> = {
  campana: ["campana", "campanas", "extraction", "hood", "extractor"], nevera: ["nevera", "neveras", "fridge", "fridges", "refri", "refrigerador", "refrigeradores", "camara"],
  congelador: ["congelador", "congeladores", "freezer", "freezers"], horno: ["horno", "hornos", "oven"], freidora: ["freidora", "fryer"], suelo: ["suelo", "suelos", "piso", "floor"],
  basura: ["basura", "garbage", "cubos", "bins", "contenedores"], mesa: ["mesa", "mesas", "mesadas", "tables", "table"], bano: ["bano", "banos", "bathroom", "bathrooms", "wc", "sanitary"],
  pica: ["pica", "bacha", "dishwash", "dishwashing", "lavavajillas", "glasswasher", "dishwasher"], cafe: ["cafe", "coffee", "cafetera"], plancha: ["plancha", "inducciones", "induction"],
};
function expand(ws: string[]): Set<string> {
  const out = new Set<string>();
  for (const w of ws) {
    out.add(w);
    for (const g of Object.values(SYN)) if (g.includes(w)) g.forEach((x) => out.add(x));
  }
  return out;
}
export function scoreLabel(query: string, label: string): number {
  const q = tokens(query); if (!q.length) return 0;
  const qx = expand(q);
  const l = new Set(tokens(label).concat(norm(label).split(" ")));
  let hit = 0;
  for (const w of qx) { if (l.has(w)) hit += 1; else { for (const lw of l) if (lw.length > 3 && (lw.startsWith(w) || w.startsWith(lw))) { hit += 0.6; break; } } }
  const score = hit / Math.max(1, q.length);
  return norm(label).includes(norm(query)) ? Math.max(score, 1.2) : score;
}

export async function readCleaningToday(sb: SupabaseClient, s: CleaningReadScope, lang: ChefLang): Promise<{ card: ChefCard; say: string; open: number; runs: CleaningRun[] }> {
  const es = lang === "es";
  const href = cleaningHref(s.house);
  const runs = await loadToday(sb, s.entity_id, tzDate(s.tz));
  const open = runs.reduce((n, r) => n + r.items.filter((i) => !i.done).length, 0);
  const total = runs.reduce((n, r) => n + r.items.length, 0);
  const unsigned = runs.filter((r) => r.status !== "signed");
  if (!runs.length) {
    const t = es ? "Hoy no hay listas de limpieza" : "No cleaning lists today";
    return { open: 0, runs, say: t, card: { title: t, lines: [], kind: "read", entity_label: s.entity_name, href, primary: { label: es ? "Abrir limpieza" : "Open cleaning", kind: "navigate", href } } };
  }
  const title = open === 0
    ? (es ? `Limpieza al día · ${unsigned.length} sin firmar` : `Cleaning all done · ${unsigned.length} unsigned`)
    : (es ? `${open} de ${total} tareas de limpieza pendientes` : `${open} of ${total} cleaning items open`);
  const lines = runs.filter((r) => r.items.some((i) => !i.done) || r.status !== "signed").slice(0, 4)
    .map((r) => `${r.template_name} · ${r.items.filter((i) => i.done).length}/${r.items.length}${r.status === "signed" ? (es ? " · firmado" : " · signed") : ""}`);
  const say = open === 0 ? title : (es ? `${open} tareas de limpieza pendientes` : `${open} cleaning items open`);
  return { open, runs, say, card: { title, lines, kind: "read", entity_label: s.entity_name, href, primary: { label: es ? "Abrir limpieza" : "Open cleaning", kind: "navigate", href } } };
}

// Fuzzy pick of ONE open line on today's lists. Exact → single good match →
// otherwise the candidates (the router asks).
export async function findCleaningItem(sb: SupabaseClient, s: CleaningReadScope, label: string): Promise<{ pick: (CleaningRunItem & { run: CleaningRun }) | null; candidates: (CleaningRunItem & { run: CleaningRun })[] }> {
  const runs = await loadToday(sb, s.entity_id, tzDate(s.tz));
  const all = runs.filter((r) => r.status !== "signed").flatMap((r) => r.items.filter((i) => !i.done && i.kind === "task").map((i) => ({ ...i, run: r })));
  const scored = all.map((i) => ({ i, sc: scoreLabel(label, i.label) })).filter((x) => x.sc >= 0.5).sort((a, b) => b.sc - a.sc);
  if (!scored.length) return { pick: null, candidates: [] };
  const best = scored[0];
  const second = scored[1];
  if (best.sc >= 1 && (!second || second.sc < best.sc - 0.3)) return { pick: best.i, candidates: scored.slice(0, 3).map((x) => x.i) };
  if (scored.length === 1 && best.sc >= 0.6) return { pick: best.i, candidates: [best.i] };
  return { pick: null, candidates: scored.slice(0, 3).map((x) => x.i) };
}

export function tickAction(entityId: string, it: CleaningRunItem & { run: CleaningRun }): ChefAction {
  return { type: "cleaning_tick", entity_id: entityId, id: it.id, label: it.label, list: it.run.template_name };
}

// Which run to sign: a named list, else the single open one, else ask.
export async function findRunToSign(sb: SupabaseClient, s: CleaningReadScope, hint: string | null): Promise<{ pick: CleaningRun | null; candidates: CleaningRun[] }> {
  const runs = (await loadToday(sb, s.entity_id, tzDate(s.tz))).filter((r) => r.status !== "signed");
  if (!runs.length) return { pick: null, candidates: [] };
  const h = norm(hint || "");
  if (h) {
    const scored = runs.map((r) => ({ r, sc: scoreLabel(h, r.template_name + " " + (r.area || "") + " " + r.shift + " " + (r.shift === "closing" ? "cierre closing" : r.shift === "opening" ? "apertura opening" : "")) })).sort((a, b) => b.sc - a.sc);
    if (scored[0].sc >= 0.5 && (!scored[1] || scored[1].sc < scored[0].sc - 0.3)) return { pick: scored[0].r, candidates: scored.slice(0, 3).map((x) => x.r) };
    return { pick: null, candidates: scored.filter((x) => x.sc > 0).slice(0, 3).map((x) => x.r).concat(scored.every((x) => x.sc <= 0) ? runs.slice(0, 3) : []) };
  }
  if (runs.length === 1) return { pick: runs[0], candidates: runs };
  return { pick: null, candidates: runs.slice(0, 4) };
}
