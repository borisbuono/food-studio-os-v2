import { supabaseServer } from "@/lib/supabaseServer";
import { INVITE_ROLES, INVITE_ROLE_AREA } from "@/lib/onboarding";
import { sendInviteEmail } from "@/lib/email/invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/team/invite
//
// Body: { entity_id: uuid, email: string, role: InviteRole,
//         name?, phone?, language?: 'es'|'en', person_id?: uuid }
//
// person_id (S3, 2026-10-02): the roster row this invite is FOR. The seeded
// roster carries placeholder addresses (name+bm@ibzfoodstudio.com) that no real
// Gmail will ever match, so inviting an existing teammate by their real address
// used to create a second person. With person_id, accept_pending_invite() binds
// the real login to THAT row (no duplicate on Team or the clock kiosk).
//
// Effects:
//   1. Verify the invoking user has an active membership on `entity_id`
//      (any role — you can only invite into a house you belong to).
//   2. Insert a pending_invites row with a signed token (+ name / phone /
//      language / area so the person arrives with a name and a language).
//   3. Best-effort: a team_members roster row (status 'invited', WITH
//      operator_entity_id so RLS accepts it) so the Team tab shows the person
//      before they sign in. accept_pending_invite() CLAIMS this row on
//      acceptance (by email) instead of creating a second person.
//   4. Best-effort: transactional email with the accept link. accept_url is
//      always returned so the caller can forward it by WhatsApp / mail.
//
// Response: { ok, invite: { id, token, expires_at }, emailed, accept_url, roster }
//
// Callers: /onboard/step-4 (server action), Team › Invite tab and the
// "+ Add to team" card via lib/team/inviteClient.ts (2026-10-02). One flow.

type Body = {
  entity_id?: string;
  email?: string;
  role?: string;
  name?: string;
  phone?: string | null;
  language?: string;
  person_id?: string | null;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const entity_id = String(body.entity_id || "").trim();
  const email     = String(body.email || "").trim().toLowerCase();
  const role      = String(body.role || "manager").trim();
  const name      = String(body.name || "").trim().slice(0, 120);
  const phone     = String(body.phone || "").trim().slice(0, 40) || null;
  const language  = body.language === "es" || body.language === "en" ? body.language : null;
  const area      = (INVITE_ROLE_AREA as Record<string, string>)[role] || "admin";
  const person_id = String(body.person_id || "").trim() || null;

  if (!entity_id) return Response.json({ ok: false, error: "entity_id required" }, { status: 400 });
  if (!email || !/@/.test(email)) return Response.json({ ok: false, error: "valid email required" }, { status: 400 });
  if (!(INVITE_ROLES as string[]).includes(role)) return Response.json({ ok: false, error: "unknown role" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  // Who may invite (2026-10-02): a manager/owner of this house
  // (fn_is_entity_manager — the same gate the rota and rates use), or the
  // person who onboarded the entity (the wizard runs before any roster row
  // exists). A cook cannot invite.
  const { data: mgr } = await sb.rpc("fn_is_entity_manager", { uid, ent: entity_id });
  if (mgr !== true) {
    const { data: ent } = await sb
      .from("entities")
      .select("onboarded_by")
      .eq("id", entity_id)
      .maybeSingle();
    if (!ent || (ent as any).onboarded_by !== uid) {
      return Response.json({ ok: false, error: "forbidden — managers of this house only" }, { status: 403 });
    }
  }

  // The invite is FOR an existing roster row: it must be on this house (or on
  // its roster through a membership) and not already somebody else's login.
  // RLS scopes the read to people the inviter may see.
  let forPerson: { id: string; name: string | null } | null = null;
  if (person_id) {
    const { data: tm } = await sb
      .from("team_members")
      .select("id, name, status, auth_user_id, operator_entity_id")
      .eq("id", person_id)
      .maybeSingle();
    const t: any = tm;
    if (!t || t.status === "removed") return Response.json({ ok: false, error: "person not found on this roster" }, { status: 404 });
    if (t.operator_entity_id && t.operator_entity_id !== entity_id) {
      const { data: m } = await sb.from("memberships").select("id").eq("person_id", person_id).eq("entity_id", entity_id).limit(1);
      if (!m || !m.length) return Response.json({ ok: false, error: "person is not on this house" }, { status: 400 });
    }
    if (t.auth_user_id) return Response.json({ ok: false, error: "this person already has a login — re-send the accept link instead" }, { status: 409 });
    forPerson = { id: t.id, name: t.name || null };
  }

  const token = randomToken();
  const { data: inserted, error } = await sb
    .from("pending_invites")
    .insert({
      entity_id,
      email,
      role,
      token,
      invited_by: uid,
      name: name || forPerson?.name || null,
      phone,
      language,
      area,
      person_id: forPerson?.id ?? null,
    })
    .select("id, token, expires_at")
    .single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  // Roster row (best-effort). team_members.default_role is check-constrained
  // to worker|chef|maitre|manager|owner — cook/foh → worker, waiter → maitre,
  // office → manager. Skipped when a row with this email already exists on
  // this house (re-invite) — the RPC will claim it on acceptance.
  let roster = false;
  if (forPerson) {
    roster = true; // the row exists; accept binds the login to it
  } else try {
    const { data: existing } = await sb
      .from("team_members")
      .select("id")
      .eq("operator_entity_id", entity_id)
      .ilike("email", email)
      .limit(1);
    if (existing && existing.length) {
      roster = true;
    } else {
      const defaultRole = role === "cook" || role === "foh" ? "worker" : role === "waiter" ? "maitre" : role === "office" ? "manager" : role;
      const { data: rest } = await sb.from("restaurants").select("id").eq("entity_id", entity_id).limit(1).maybeSingle();
      const { error: tmErr } = await sb.from("team_members").insert({
        operator_entity_id: entity_id,
        name: name || email,
        email,
        phone,
        default_role: defaultRole,
        default_area: area,
        default_restaurant_id: (rest as any)?.id ?? null,
        language: language || "es",
        status: "invited",
        invited_at: new Date().toISOString(),
        invited_by: uid,
      });
      roster = !tmErr;
    }
  } catch { /* the membership comes from accept_pending_invite regardless */ }

  // Transactional email (2026-09-21). The old signInWithOtp ran on the
  // inviter's session (PKCE verifier in the wrong browser) and pointed at
  // /team/join, which reads team_invitations — not pending_invites. Soft-fail:
  // accept_url is returned so the caller can share it by hand.
  let emailed = false;
  let accept_url = new URL(`/invite/accept?token=${token}`, req.url).toString();
  try {
    const { data: ent } = await sb.from("entities").select("name").eq("id", entity_id).maybeSingle();
    const meta: any = u.user?.user_metadata || {};
    const r = await sendInviteEmail({
      email, role, token,
      houseName: (ent as any)?.name || "your house",
      inviterName: meta.full_name || meta.name || null,
      origin: new URL(req.url).origin,
    });
    emailed = r.emailed;
    accept_url = r.acceptUrl;
  } catch { /* soft-fail */ }

  return Response.json({ ok: true, invite: inserted, emailed, accept_url, roster });
}

function randomToken(): string {
  const arr = new Uint8Array(24);
  if (typeof crypto !== "undefined" && (crypto as any).getRandomValues) {
    (crypto as any).getRandomValues(arr);
  } else {
    for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}
