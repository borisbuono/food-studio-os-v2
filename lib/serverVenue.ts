import { cookies } from "next/headers";
import {
  E_HOLDINGS,
  ENTITY_TO_RESTAURANT,
  RESTAURANT_TO_ENTITY,
  isPrimaryEntity,
  type EntityKey,
} from "./entities";
import { cache } from "react";
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
  // A non-pinned tenant's UUID cookie must NOT fall through to Bistro Mondo's
  // restaurant id (stress test 2026-09-21). Return a UUID that matches no
  // row so restaurant-scoped reads come back empty on surfaces that haven't
  // moved to resolveVenueScope() yet.
  const c = cookies().get("fs_entity")?.value || "";
  if (c && !isPrimaryEntity(c) && /^[0-9a-f-]{36}$/i.test(c)) return "00000000-0000-0000-0000-000000000000";
  return ENTITY_TO_RESTAURANT[serverEntity()] || ENTITY_TO_RESTAURANT[E_HOLDINGS] || "fb4d008f-2d2a-4e0d-a525-6e0e36af0259";
}

// ---- Dynamic venue scope (onboarding stress test 2026-09-21, blocker #2) ---
//
// serverEntity()/serverRestaurantId() only know the pinned UUIDs; any other
// tenant's cookie fell through to E_HOLDINGS + Bistro Mondo's restaurant id,
// so an Amsterdam operator tapping "Kitchen" saw Ibiza data. The legacy
// /boh /foh /office pillars now call resolveVenueScope() instead:
//   1. fs_entity cookie = pinned UUID → pinned constants (unchanged path).
//   2. fs_entity cookie = other UUID  → honoured ONLY if the signed-in user
//      holds an active membership on it; restaurant looked up by entity_id.
//   3. no / invalid cookie → the user's default (else first) active
//      membership; only a user with zero memberships gets the legacy
//      E_HOLDINGS default.
// A non-pinned tenant without a restaurants row gets NO_MATCH_ID, so
// restaurant-scoped queries return nothing instead of someone else's rows.
export const NO_MATCH_ID = "00000000-0000-0000-0000-000000000000";

// Legacy text code used by invoice_inbox / bank_movements / academy_lessons
// (.entity_id / .entity_code columns predate the UUID refactor).
const PINNED_LEGACY_CODE: Record<string, string> = {
  "d1ee19b6-5fb4-460c-8326-685dc86e47df": "BBH",
  "387f1045-0340-4029-a1e4-28b15c372680": "BM",
  "daec58d9-44a2-4c24-9183-2a87219093fb": "IFL",
  "f365f49d-4cd1-43d1-955f-03c21816ad22": "UTOPIA",
};

export type VenueScope = {
  entity: string;          // entities.id UUID
  restaurantId: string;    // restaurants.id, or NO_MATCH_ID
  legacyCode: string;      // BBH/BM/IFL/UTOPIA for pinned; the UUID otherwise
  slug: string | null;     // house slug for /h/<slug>/… links
  timezone: string;
  pinned: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pinnedScope(k: EntityKey): VenueScope {
  const slugs: Record<string, string> = {
    "387f1045-0340-4029-a1e4-28b15c372680": "bm",
    "daec58d9-44a2-4c24-9183-2a87219093fb": "taller",
    "f365f49d-4cd1-43d1-955f-03c21816ad22": "utopia",
  };
  return {
    entity: k,
    restaurantId: ENTITY_TO_RESTAURANT[k] || ENTITY_TO_RESTAURANT[E_HOLDINGS] || "fb4d008f-2d2a-4e0d-a525-6e0e36af0259",
    legacyCode: PINNED_LEGACY_CODE[k] || "BBH",
    slug: slugs[k] ?? null,
    timezone: "Europe/Madrid",
    pinned: true,
  };
}

export const resolveVenueScope = cache(async (): Promise<VenueScope> => {
  const c = cookies().get("fs_entity")?.value || "";
  if (isPrimaryEntity(c)) return pinnedScope(c);

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return pinnedScope(E_HOLDINGS);

  // A user can own several team_members rows (Boris has two) — never
  // .maybeSingle() here.
  const { data: tms } = await sb.from("team_members").select("id").eq("auth_user_id", uid);
  const personIds = (tms || []).map((t: any) => t.id as string);
  const { data: mems } = personIds.length
    ? await sb.from("memberships").select("entity_id,is_default").in("person_id", personIds).eq("status", "active")
    : { data: [] as any[] };
  const memberOf = (mems || []) as Array<{ entity_id: string; is_default: boolean | null }>;

  let target: string | null = null;
  if (UUID_RE.test(c) && memberOf.some((m) => m.entity_id === c)) target = c;
  if (!target) target = (memberOf.find((m) => m.is_default) || memberOf[0])?.entity_id ?? null;
  if (!target) return pinnedScope(E_HOLDINGS); // zero memberships — legacy default
  if (isPrimaryEntity(target)) return pinnedScope(target);

  const [{ data: ent }, { data: rest }] = await Promise.all([
    sb.from("entities").select("id,slug,timezone").eq("id", target).maybeSingle(),
    sb.from("restaurants").select("id").eq("entity_id", target).limit(1),
  ]);
  return {
    entity: target,
    restaurantId: ((rest || [])[0] as any)?.id || NO_MATCH_ID,
    legacyCode: target,
    slug: (ent as any)?.slug ?? null,
    timezone: (ent as any)?.timezone || "Europe/Madrid",
    pinned: false,
  };
});

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
