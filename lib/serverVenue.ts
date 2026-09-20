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
