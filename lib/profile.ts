"use client";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { EntityKey, RESTAURANT_TO_ENTITY } from "@/lib/entities";
import { mapDbRole, World } from "@/lib/roles";

export type MyProfile = {
  id: string;
  name: string;
  email: string | null;
  dbRole: string;
  world: World;
  isAdmin: boolean;
  restaurantId: string | null;
  entity: EntityKey | null;
  color: string | null;
};

// Two-path profile read:
//   1) Try client-side supabaseBrowser.auth.getSession() + profile table read.
//      This is the fast path — no network round-trip, uses whatever cookies
//      the browser client can see.
//   2) If (1) returns null (e.g. @supabase/ssr storage-adapter can't parse
//      the session cookie the way our server wrote it), fall back to
//      /api/me which reads the SAME cookie via next/headers server-side
//      and returns the profile as JSON. This is the "trust the server"
//      escape hatch — proven to work when the client-side reader silently
//      misses a valid session (Boris hit this repeatedly after 4+ auth
//      patches).
export async function getMyProfile(): Promise<MyProfile | null> {
  // --- Path 1: client-side ---
  try {
    const { data: s } = await supabaseBrowser.auth.getSession();
    const uid = s.session?.user?.id;
    if (uid) {
      const email = s.session?.user?.email ?? null;
      try { await supabaseBrowser.rpc("sync_my_profile_from_invite"); } catch {}
      const { data } = await supabaseBrowser
        .from("profiles")
        .select("id,name,role,restaurant_id,color")
        .eq("id", uid)
        .maybeSingle();
      if (data) {
        const { world, isAdmin } = mapDbRole(data.role);
        const entity = data.restaurant_id ? (RESTAURANT_TO_ENTITY[data.restaurant_id] ?? null) : null;
        return {
          id: data.id, name: data.name, email, dbRole: data.role,
          world, isAdmin,
          restaurantId: data.restaurant_id, entity, color: data.color,
        };
      }
    }
  } catch {}

  // --- Path 2: server-side fallback via /api/me ---
  try {
    const r = await fetch("/api/me", { credentials: "include", cache: "no-store" });
    if (!r.ok) return null;
    const j = await r.json();
    return j.profile ?? null;
  } catch {
    return null;
  }
}
