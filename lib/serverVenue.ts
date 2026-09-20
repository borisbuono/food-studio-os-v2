import { cookies } from "next/headers";
import {
  E_HOLDINGS,
  ENTITY_TO_RESTAURANT,
  RESTAURANT_TO_ENTITY,
  isPrimaryEntity,
  type EntityKey,
} from "./entities";
import { supabaseServer } from "./supabaseServer";

// The venue the current view is scoped to. Priority:
//  1. fs_entity cookie (explicit user choice, set by the switcher)
//  2. signed-in user's profiles.restaurant_id (first-visit default,
//     via `serverEntityFromProfile()` below)
//  3. E_HOLDINGS (neutral studio scope). Boris walk 2026-09-20 flipped
//     this from BM to holdings so a fresh operator's first paint isn't
//     Bistro-Mondo-branded before their cookie lands.
//
// Refactor 2026-09-20 (branch refactor/entity-uuid): the cookie now stores
// an entities.id UUID. Old cookie values ("holdings", "bistro_mondo",
// "taller") fail isPrimaryEntity() and fall through to the default —
// users get a one-time re-pick on next visit. Auth stays.
export function serverEntity(): EntityKey {
  const c = cookies().get("fs_entity")?.value;
  if (isPrimaryEntity(c)) return c;
  return E_HOLDINGS;
}

// Async variant that consults the profile when the cookie is missing.
// Server components can call this at the top of the render to bind to the
// user's actual venue instead of the shell default.
export async function serverEntityFromProfile(): Promise<EntityKey> {
  const c = cookies().get("fs_entity")?.value;
  if (isPrimaryEntity(c)) return c;
  try {
    const sb = supabaseServer();
    const { data: u } = await sb.auth.getUser();
    if (u?.user) {
      const { data: prof } = await sb
        .from("profiles").select("restaurant_id").eq("id", u.user.id).maybeSingle();
      const key = prof?.restaurant_id ? RESTAURANT_TO_ENTITY[prof.restaurant_id] : null;
      if (key && isPrimaryEntity(key)) return key;
    }
  } catch {}
  return E_HOLDINGS;
}

export function serverRestaurantId(): string {
  return ENTITY_TO_RESTAURANT[serverEntity()] || ENTITY_TO_RESTAURANT[E_HOLDINGS] || "fb4d008f-2d2a-4e0d-a525-6e0e36af0259";
}

// The row shape the Chef context builder + system prompt need for any entity —
// the three pinned houses and every future tenant. Kept minimal on purpose: no
// secrets, no relationships, just the fields the prompt uses to speak in the
// right language and scope reads to the right rows. Non-pinned entities read
// this from the entities table at request time; the pinned three fall through
// the same code path but hit the DB row that mirrors the constants in
// lib/entities.ts.
export type EntityRow = {
  id: string;
  name: string;
  entity_type: string;
  city: string | null;
  country_code: string;   // ISO2, defaults ES in DB seed
  currency_code: string;  // ISO3, defaults EUR
  timezone: string;
  vat_regime: string | null;
  legal_name: string | null;
  slug: string | null;
};

// Fetch a single entity row by UUID for the Chef context builder. Returns null
// when the entity is unknown or inactive. The caller is expected to refuse the
// turn in that case — we don't want to fall through to a Boris-shaped default.
import type { SupabaseClient } from "@supabase/supabase-js";
export async function getEntityById(sb: SupabaseClient, entity_id: string): Promise<EntityRow | null> {
  if (!entity_id) return null;
  const { data } = await sb
    .from("entities")
    .select("id, name, entity_type, city, country_code, currency_code, timezone, vat_regime, legal_name, slug")
    .eq("id", entity_id)
    .maybeSingle();
  if (!data) return null;
  const r = data as any;
  return {
    id: String(r.id),
    name: String(r.name || ""),
    entity_type: String(r.entity_type || "unknown"),
    city: r.city || null,
    country_code: (r.country_code || "ES").toUpperCase(),
    currency_code: (r.currency_code || "EUR").toUpperCase(),
    timezone: r.timezone || "Europe/Madrid",
    vat_regime: r.vat_regime || null,
    legal_name: r.legal_name || null,
    slug: r.slug || null,
  };
}
