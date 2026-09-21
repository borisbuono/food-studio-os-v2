"use server";

import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabaseServer";
import { getMyMembershipContext } from "@/lib/memberships";

// Task #51 — reactivate a dormant entity from the /studio footer.
// Owner-only, scoped to entities this user can actually see (ctx.entities),
// and only dormant → active (never resurrects 'ended').
export async function reactivateEntity(formData: FormData): Promise<void> {
  const id = String(formData.get("entity_id") || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return;
  const ctx = await getMyMembershipContext();
  if (!ctx.isOwner) return;
  if (!ctx.entities.some((e) => e.id === id)) return;
  const sb = supabaseServer();
  await sb.from("entities").update({ status: "active" }).eq("id", id).eq("status", "dormant");
  revalidatePath("/studio");
}
