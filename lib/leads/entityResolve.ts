// lib/leads/entityResolve.ts
//
// Slug ↔ entities.id resolution for lead capture. The website form submits
// an entity_slug (short, human-typable, stable) and we map it to the row
// UUID in public.entities. Kept out of lib/entities.ts because that file
// is about the internal EntityKey vocab and we don't want to reroute those
// call sites yet.
//
// The lookup accepts a few common aliases per venue so the same slug in a
// hand-written HTML form, a Wix embed, or an Instagram bio-link all land
// on the same entity. Unknown slug → null (the capture endpoint drops the
// submission silently to avoid enumeration).

import type { SupabaseClient } from "@supabase/supabase-js";

export type EntitySlug =
  | "bm" | "bistro-mondo" | "bistrot-mondo"
  | "taller" | "taller-sa-penya" | "ibiza-food-lab"
  | "studio" | "food-studio" | "food-studios" | "bbh" | "holdings";

// Normalise → the canonical short slug used to key content/funnel/config.ts.
export function normaliseEntitySlug(input: string): "bm" | "taller" | "studio" | null {
  const s = String(input || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "bm" || s === "bistro-mondo" || s === "bistrot-mondo" || s === "bistro_mondo") return "bm";
  if (s === "taller" || s === "taller-sa-penya" || s === "ibiza-food-lab" || s === "ifl") return "taller";
  if (s === "studio" || s === "food-studio" || s === "food-studios" || s === "bbh" || s === "holdings" || s === "ifs") return "studio";
  return null;
}

// Entity name candidates by canonical slug — matched case-insensitively
// against public.entities.name. Kept intentionally permissive so a renamed
// entity (e.g. "Ibiza Food Studio S.L." vs "Boris Buono Holdings SL") still
// resolves. First match wins.
const NAME_CANDIDATES: Record<"bm" | "taller" | "studio", string[]> = {
  bm:     ["Bistro Mondo", "Bistrot Mondo"],
  taller: ["Taller Sa Penya", "Ibiza Food Lab"],
  studio: ["BBH", "Boris Buono Holdings SL", "Boris Buono Holdings", "Ibiza Food Studio S.L.", "Ibiza Food Studio", "Food Studio"],
};

// Resolve a submitted slug to an entity_id. Returns null if the slug is
// unknown or no matching entity exists in the DB (both are treated as
// "silently drop" by the capture endpoint).
export async function resolveEntityIdForSlug(
  sb: SupabaseClient,
  rawSlug: string,
): Promise<{ entityId: string; canonicalSlug: "bm" | "taller" | "studio" } | null> {
  const canonical = normaliseEntitySlug(rawSlug);
  if (!canonical) return null;

  const candidates = NAME_CANDIDATES[canonical];
  const { data, error } = await sb
    .from("entities")
    .select("id, name")
    .eq("is_active", true);
  if (error || !Array.isArray(data)) return null;

  const lc = (s: string) => String(s || "").trim().toLowerCase();
  const wanted = new Set(candidates.map(lc));
  const hit = data.find((r: any) => wanted.has(lc(r.name)));
  if (!hit) return null;
  return { entityId: String(hit.id), canonicalSlug: canonical };
}

// Inverse: given an entity_id, return the canonical short slug. Used by
// the admin board to route between the entity_id we hold in leads.entity_id
// and the venue chip label. Falls back to null when unknown.
export async function slugForEntityId(
  sb: SupabaseClient,
  entityId: string,
): Promise<"bm" | "taller" | "studio" | null> {
  if (!entityId) return null;
  const { data } = await sb.from("entities").select("id, name").eq("id", entityId).maybeSingle();
  const name = String((data as any)?.name || "").trim().toLowerCase();
  if (!name) return null;
  for (const canonical of ["bm", "taller", "studio"] as const) {
    if (NAME_CANDIDATES[canonical].some((c) => c.toLowerCase() === name)) return canonical;
  }
  return null;
}
