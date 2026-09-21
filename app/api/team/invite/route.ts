import { supabaseServer } from "@/lib/supabaseServer";
import { INVITE_ROLES } from "@/lib/onboarding";
import { sendInviteEmail } from "@/lib/email/invite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/team/invite
//
// Body: { entity_id: uuid, email: string, role: 'owner'|'manager'|'chef'|'waiter'|'office' }
//
// Effects:
//   1. Verify the invoking user has an active membership on `entity_id`
//      (any role — you can only invite into a house you belong to).
//   2. Insert a pending_invites row with a signed token.
//   3. Best-effort: trigger a Supabase magic-link so the recipient gets an
//      email they can click. Their auth callback carries them to
//      /team/join?token=... which finalises the invite → membership row.
//
// Response: { ok, invite: { id, token, expires_at } }
//
// This is the same code path the /onboard/step-4 server action uses; a
// later "invite from settings" surface will POST here too.

type Body = {
  entity_id?: string;
  email?: string;
  role?: string;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const entity_id = String(body.entity_id || "").trim();
  const email     = String(body.email || "").trim().toLowerCase();
  const role      = String(body.role || "manager").trim();

  if (!entity_id) return Response.json({ ok: false, error: "entity_id required" }, { status: 400 });
  if (!email || !/@/.test(email)) return Response.json({ ok: false, error: "valid email required" }, { status: 400 });
  if (!(INVITE_ROLES as string[]).includes(role)) return Response.json({ ok: false, error: "unknown role" }, { status: 400 });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  // Membership check: the inviter must sit inside this entity. We look up
  // team_members.id from auth_user_id, then any active membership row on
  // the target entity.
  const { data: tms } = await sb
    .from("team_members")
    .select("id")
    .eq("auth_user_id", uid);
  const personIds = (tms || []).map((t: any) => t.id as string);
  if (personIds.length) {
    const { data: mems } = await sb
      .from("memberships")
      .select("id")
      .in("person_id", personIds)
      .eq("entity_id", entity_id)
      .eq("status", "active")
      .limit(1);
    if (!mems || !mems.length) return Response.json({ ok: false, error: "forbidden — not a member of this house" }, { status: 403 });
  } else {
    // No team_members row → we accept the invite if this user is the entity
    // owner (onboarded_by). Onboarding just created it, so the wizard-driven
    // path still works even before the operator has a team_members row.
    const { data: ent } = await sb
      .from("entities")
      .select("onboarded_by")
      .eq("id", entity_id)
      .maybeSingle();
    if (!ent || ent.onboarded_by !== uid) {
      return Response.json({ ok: false, error: "forbidden — no membership" }, { status: 403 });
    }
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
    })
    .select("id, token, expires_at")
    .single();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

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

  return Response.json({ ok: true, invite: inserted, emailed, accept_url });
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
