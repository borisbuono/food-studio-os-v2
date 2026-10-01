// lib/cleaning/auth.ts — who is asking, and are they a manager of this house.
// Mirrors fn_is_entity_manager in the DB (owner · manager · gm · admin ·
// director · operator) so the button and the RPC agree.

import { supabaseServer } from "@/lib/supabaseServer";
import { getMyMembershipContext } from "@/lib/memberships";

export const MANAGER_ROLES = new Set(["owner", "manager", "gm", "admin", "director", "operator"]);

export async function cleaningCaller(entityId: string): Promise<{ ok: true; uid: string; isManager: boolean } | { ok: false; status: number; error: string }> {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return { ok: false, status: 401, error: "not authenticated" };
  const mem = await getMyMembershipContext();
  const mine = (mem.memberships || []).filter((m) => m.entity_id === entityId);
  if (!mine.length) return { ok: false, status: 403, error: "not a member of this house" };
  const isManager = mine.some((m) => MANAGER_ROLES.has(String(m.role || "").toLowerCase()));
  return { ok: true, uid, isManager };
}
