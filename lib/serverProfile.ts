import { RESTAURANT_TO_ENTITY, EntityKey } from "./entities";
import { mapDbRole, World } from "./roles";
import { supabaseServer } from "./supabaseServer";

// Server-side counterpart of `getMyProfile()` (lib/profile.ts). Called from
// SSR components — app/layout.tsx threads the result into AppChrome so
// DesktopSidebar / TopBar / SlimTopBar can seed their state on first paint
// with the user's real profile, not "Guest".
//
// Why this exists (2026-09-10):
// The previous shell resolved the profile client-side ONLY, so every SSR
// paint rendered the "Guest" fallback and the client flipped to Boris on
// hydration. Regression of the SSR guest flicker Boris saw on day 10
// (#418/#423). This is the SSR half — same shape as lib/profile.ts::MyProfile
// so callers can accept either.
export type ServerProfile = {
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

export async function serverProfile(): Promise<ServerProfile | null> {
  try {
    const sb = supabaseServer();
    const { data: userRes } = await sb.auth.getUser();
    const user = userRes?.user;
    if (!user) return null;
    // Best-effort: sync invite → profile (mirrors client behaviour).
    try { await sb.rpc("sync_my_profile_from_invite"); } catch {}
    const { data: prof } = await sb
      .from("profiles")
      .select("id,name,role,restaurant_id,color")
      .eq("id", user.id)
      .maybeSingle();
    if (!prof) return null;
    const { world, isAdmin } = mapDbRole(prof.role);
    const entity = prof.restaurant_id ? (RESTAURANT_TO_ENTITY[prof.restaurant_id] ?? null) : null;
    return {
      id: prof.id,
      name: prof.name,
      email: user.email ?? null,
      dbRole: prof.role,
      world,
      isAdmin,
      restaurantId: prof.restaurant_id ?? null,
      entity,
      color: prof.color ?? null,
    };
  } catch {
    return null;
  }
}
