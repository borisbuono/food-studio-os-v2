// houses.server.ts — DB-driven house resolvers.
//
// P0 fix 2026-09-20 (Amsterdam rehearsal punchlist): these used to live in
// lib/houses.ts and got pulled into the client bundle via DesktopSidebar /
// RoomSwitcher, breaking `next build` with a "next/headers in a Client
// Component" error. Splitting them out keeps client components importing
// from lib/houses.ts (types + sync helpers, no server-only deps) and
// server pages importing from HERE for the DB lookup.
//
// Every function here uses supabaseServer() (which pulls next/headers) and
// can only run on the server. The .server.ts naming is the convention we
// enforce by review — no client component may import from here.

import { cache } from "react";
import { supabaseServer } from "@/lib/supabaseServer";
import { ENTITY_TO_RESTAURANT, type EntityKey } from "@/lib/entities";
import { houseNameForSlug, type House } from "@/lib/houses";

// Per-request cached DB lookup. React `cache()` memoises per render pass,
// so a page that calls this in the body AND in generateMetadata shares one
// query, and there is no need to plumb the House object through props.
export const getHouseBySlug = cache(async (slug: string): Promise<House | null> => {
  if (!slug) return null;
  const s = slug.toLowerCase();
  const sb = supabaseServer();

  const { data: e } = await sb
    .from("entities")
    .select("id, slug, name, legal_name, city, timezone, country_code, currency_code, accent_color, entity_type, status")
    .eq("slug", s)
    .in("entity_type", ["operating_venue", "operating"])
    .eq("status", "active")
    .maybeSingle();
  if (!e) return null;
  const row: any = e;

  // Restaurant row (0..1 per entity). Missing is fine — some entities are
  // POS-less at first (e.g. Amsterdam Demo before they choose a till).
  let restaurant_id: string | null = null;
  try {
    const { data: r } = await sb
      .from("restaurants")
      .select("id, is_active")
      .eq("entity_id", row.id)
      .limit(1)
      .maybeSingle();
    const rr: any = r;
    if (rr && rr.is_active !== false) restaurant_id = rr.id as string;
  } catch {
    /* is_active may not exist on very old envs — non-fatal */
  }
  if (!restaurant_id) {
    // Fall back to the pinned constant for BM/Taller — same value the DB
    // has, just avoids a second query on the hot path.
    restaurant_id = ENTITY_TO_RESTAURANT[row.id as EntityKey] ?? null;
  }

  return {
    id: row.id as string,
    slug: (row.slug as string) || s,
    name: (row.name as string) || (row.legal_name as string) || houseNameForSlug(s),
    legal_name: (row.legal_name as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    timezone: (row.timezone as string) || "Europe/Madrid",
    country_code: (row.country_code as string) || "ES",
    currency_code: (row.currency_code as string) || "EUR",
    accent_color: (row.accent_color as string | null) ?? null,
    entity_type: (row.entity_type as string) || "operating_venue",
    restaurant_id,
  };
});

// Async thin wrapper — returns entities.id for callers that only need the
// UUID (most /h/<slug>/** pages do — they pass it straight into a supabase
// query as `entity_id`).
export async function entityForHouseSlug(slug: string): Promise<string | null> {
  return (await getHouseBySlug(slug))?.id ?? null;
}

// Async — every house the given auth user is an active member of, sorted by
// slug. Used by the Studio house-switcher on the way in. Two-step query
// because memberships.person_id → team_members.auth_user_id is a two-hop.
export const getMyHouses = cache(async (user_id: string): Promise<House[]> => {
  if (!user_id) return [];
  const sb = supabaseServer();
  const { data: person } = await sb
    .from("team_members")
    .select("id")
    .eq("auth_user_id", user_id)
    .maybeSingle();
  const person_id = (person as any)?.id as string | undefined;
  if (!person_id) return [];
  const { data: m } = await sb
    .from("memberships")
    .select("entity_id")
    .eq("person_id", person_id)
    .eq("status", "active");
  const ids = Array.from(new Set((m || []).map((r: any) => r.entity_id as string)));
  if (!ids.length) return [];
  const { data: es } = await sb
    .from("entities")
    .select("id, slug, name, legal_name, city, timezone, country_code, currency_code, accent_color, entity_type, status")
    .in("id", ids)
    .in("entity_type", ["operating_venue", "operating"])
    .eq("status", "active");
  const houses: House[] = (es || []).map((e: any) => ({
    id: e.id as string,
    slug: (e.slug as string) || "",
    name: (e.name as string) || (e.legal_name as string) || houseNameForSlug(e.slug || ""),
    legal_name: (e.legal_name as string | null) ?? null,
    city: (e.city as string | null) ?? null,
    timezone: (e.timezone as string) || "Europe/Madrid",
    country_code: (e.country_code as string) || "ES",
    currency_code: (e.currency_code as string) || "EUR",
    accent_color: (e.accent_color as string | null) ?? null,
    entity_type: (e.entity_type as string) || "operating_venue",
    restaurant_id: ENTITY_TO_RESTAURANT[e.id as EntityKey] ?? null,
  }));
  return houses.sort((a, b) => a.slug.localeCompare(b.slug));
});
