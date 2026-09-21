"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { getMyMembershipContext } from "@/lib/memberships";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ReviewAction = "approve" | "approve_private" | "discard" | "unpublish";

// Owner-only. The RPC is SECURITY INVOKER, so RLS and the DB publish guard
// (owner of the canonical's entity) still decide what actually changes.
export async function decideRecipes(ids: string[], action: ReviewAction): Promise<{ ok: boolean; n?: number; error?: string }> {
  if (!["approve", "approve_private", "discard", "unpublish"].includes(action)) return { ok: false, error: "bad action" };
  const clean = Array.from(new Set((ids || []).filter((x) => UUID.test(x)))).slice(0, 200);
  if (!clean.length) return { ok: false, error: "nothing selected" };
  const ctx = await getMyMembershipContext();
  if (!ctx.isOwner) return { ok: false, error: "owner only" };
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("recipe_review_decide", { p_ids: clean, p_action: action });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/studio/recipes/review");
  return { ok: true, n: Number(data) || 0 };
}
