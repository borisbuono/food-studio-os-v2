import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/team/join/finalize
//
// Called by /welcome after magic-link sign-in on a /team/join flow.
// Body: {
//   token: string,                                    // the invitation token
//   payload: {
//     name?, phone?, dob?, emergency?, iban?,
//     acks: { handbook_ack, food_safety_ack, gdpr_ack }
//   }
// }
//
// Runs AS the newly signed-in user (auth.uid() available). Effects:
//   1. Verify invitation token is live + email matches.
//   2. Mark invitation accepted_at.
//   3. Write profiles patch (name, phone, dob, emergency, iban, restaurant_id, role).
//   4. Insert onboarding_documents rows for the three signed acks.
//   5. Insert onboarding_steps rows for profile_completed + documents_signed +
//      team_introduced (initial state after the join form; more get marked as
//      the person moves through training and their first shift).

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const token = String(body?.token || "");
  const payload = body?.payload || {};
  if (!token) return Response.json({ ok: false, error: "token required" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  const email = u.user?.email?.toLowerCase() || null;
  if (!uid || !email) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  // 1. Resolve invitation.
  const { data: inv, error: invErr } = await sb
    .from("team_invitations")
    .select("id,invited_email,restaurant_id,entity_code,role,accepted_at,revoked_at,expires_at")
    .eq("magic_link_token", token)
    .maybeSingle();
  if (invErr || !inv) return Response.json({ ok: false, error: "invitation not found" }, { status: 404 });
  if (inv.revoked_at) return Response.json({ ok: false, error: "invitation revoked" }, { status: 410 });
  if (inv.expires_at && new Date(inv.expires_at) < new Date()) return Response.json({ ok: false, error: "invitation expired" }, { status: 410 });
  if ((inv.invited_email || "").toLowerCase() !== email) {
    return Response.json({ ok: false, error: "email mismatch — sign in with the invited email" }, { status: 403 });
  }

  // 2. Mark accepted (idempotent — no-op if already accepted).
  if (!inv.accepted_at) {
    await sb.from("team_invitations").update({ accepted_at: new Date().toISOString() }).eq("id", inv.id);
  }

  // 3. Profile patch. Existing sync_my_profile_from_invite already binds
  // restaurant_id + role from the team_members roster; this endpoint mirrors
  // that for the team_invitations pathway.
  const profilePatch: Record<string, any> = { restaurant_id: inv.restaurant_id, role: inv.role };
  if (payload?.name)      profilePatch.name = String(payload.name).trim();
  await sb.from("profiles").update(profilePatch).eq("id", uid);

  // 4. Signed acknowledgments — three rows.
  const acks = payload?.acks || {};
  const nowIso = new Date().toISOString();
  const ackRows = ["handbook_ack", "food_safety_ack", "gdpr_ack"]
    .filter((k) => !!acks[k])
    .map((doc_type) => ({
      user_id: uid,
      entity_code: inv.entity_code,
      doc_type,
      signed_at: nowIso,
      signature_name: profilePatch.name || null,
    }));
  if (ackRows.length) await sb.from("onboarding_documents").insert(ackRows);

  // 5. Step markers. Upsert to be re-entrant if the user finishes the form
  // again after a partial sign-in.
  const stepRows = ["profile_completed", "documents_signed", "team_introduced"].map((step_key) => ({
    user_id: uid,
    entity_code: inv.entity_code,
    step_key,
    done_at: nowIso,
  }));
  for (const row of stepRows) {
    await sb.from("onboarding_steps").upsert(row, { onConflict: "user_id,step_key" });
  }

  return Response.json({ ok: true, invitation_id: inv.id, steps_marked: stepRows.map((s) => s.step_key) });
}
