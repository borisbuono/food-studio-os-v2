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

  // 1 + 2. Resolve the invitation and mark it accepted, in one definer RPC.
  //
  // team_invitations is manager-only under RLS since the Phase 3.5 rollout, and
  // the person finishing onboarding is not a manager, so a direct table read here
  // returns nothing. accept_invitation_by_token() re-checks live / not-revoked /
  // not-expired and that the caller's email matches before it writes.
  const { data: accepted, error: invErr } = await sb.rpc("accept_invitation_by_token", { p_token: token });
  const inv = Array.isArray(accepted) ? accepted[0] : accepted;
  if (invErr || !inv) {
    const msg = invErr?.message || "invitation not found";
    const status = /email mismatch/i.test(msg) ? 403 : /not signed in/i.test(msg) ? 401 : /not found|no longer live/i.test(msg) ? 410 : 400;
    return Response.json({ ok: false, error: msg }, { status });
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
