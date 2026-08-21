import { cookies } from "next/headers";
import { EntityKey, ENTITY_TO_RESTAURANT, RESTAURANT_TO_ENTITY } from "./entities";
import { supabaseServer } from "./supabaseServer";

const KEYS: EntityKey[] = ["holdings", "bistro_mondo", "taller"];

// The venue the current view is scoped to. Priority:
//  1. fs_entity cookie (explicit user choice, set by the switcher)
//  2. signed-in user's profiles.restaurant_id (first-visit default)
//  3. "bistro_mondo" (safe fallback — Utopia trial is archived,
//     see 2026-08-22 Phase 1 entity migration.)
export function serverEntity(): EntityKey {
  const c = cookies().get("fs_entity")?.value as EntityKey | undefined;
  if (c && KEYS.includes(c)) return c;
  return "bistro_mondo";
}

// Async variant that consults the profile when the cookie is missing.
// Server components can call this at the top of the render to bind to the
// user's actual venue instead of the shell default.
export async function serverEntityFromProfile(): Promise<EntityKey> {
  const c = cookies().get("fs_entity")?.value as EntityKey | undefined;
  if (c && KEYS.includes(c)) return c;
  try {
    const sb = supabaseServer();
    const { data: u } = await sb.auth.getUser();
    if (u?.user) {
      const { data: prof } = await sb
        .from("profiles").select("restaurant_id").eq("id", u.user.id).maybeSingle();
      const key = prof?.restaurant_id ? RESTAURANT_TO_ENTITY[prof.restaurant_id] : null;
      if (key && KEYS.includes(key)) return key;
    }
  } catch {}
  return "bistro_mondo";
}

export function serverRestaurantId(): string {
  return ENTITY_TO_RESTAURANT[serverEntity()] || ENTITY_TO_RESTAURANT.bistro_mondo!;
}
