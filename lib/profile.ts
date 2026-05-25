"use client";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { EntityKey, RESTAURANT_TO_ENTITY } from "@/lib/entities";
import { mapDbRole, World } from "@/lib/roles";

export type MyProfile = {
  id: string;
  name: string;
  email: string | null;
  dbRole: string;
  world: World;          // office | foh | boh
  isAdmin: boolean;      // owner/manager → can switch venues + see Office
  restaurantId: string | null;
  entity: EntityKey | null;  // resolved from restaurantId; null = no venue bound
  color: string | null;
};

// Reads the signed-in user's profile (RLS: a user can only read their own row).
// Best-effort syncs from a team_members invite first, so an invited person who
// already had an account still gets bound to their venue + role.
export async function getMyProfile(): Promise<MyProfile | null> {
  const { data: s } = await supabaseBrowser.auth.getSession();
  const uid = s.session?.user?.id;
  if (!uid) return null;
  const email = s.session?.user?.email ?? null;
  try { await supabaseBrowser.rpc("sync_my_profile_from_invite"); } catch {}
  const { data } = await supabaseBrowser
    .from("profiles")
    .select("id,name,role,restaurant_id,color")
    .eq("id", uid)
    .maybeSingle();
  if (!data) return null;
  const { world, isAdmin } = mapDbRole(data.role);
  const entity = data.restaurant_id ? (RESTAURANT_TO_ENTITY[data.restaurant_id] ?? null) : null;
  return {
    id: data.id,
    name: data.name,
    email,
    dbRole: data.role,
    world,
    isAdmin,
    restaurantId: data.restaurant_id,
    entity,
    color: data.color,
  };
}
