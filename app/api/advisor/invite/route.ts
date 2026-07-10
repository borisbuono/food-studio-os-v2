import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/advisor/invite
// Body: { advisory_client_id, email, role }
//
// Creates a seat row in advisory_seats and sends a magic-link scoped to the
// advisory client + role. Idempotent per (client, email) — a repeat invite
// resurrects a revoked seat and rotates the token.
//
// The magic-link path is the shortcut: Supabase auth signInWithOtp adds the
// email to auth.users if new, then emails a login link. On first sign-in the
// /auth/callback route calls advisory_accept_invite to bind the auth user to
// the seat by matching email.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;
  if (!uid) return Response.json({ ok: false, error: "auth" }, { status: 401 });

  const clientId = String(body?.advisory_client_id || "").trim();
  const email    = String(body?.email || "").trim().toLowerCase();
  const role     = String(body?.role  || "staff");

  if (!clientId) return Response.json({ ok: false, error: "advisory_client_id required" }, { status: 400 });
  if (!email || !email.includes("@")) return Response.json({ ok: false, error: "valid email required" }, { status: 400 });
  if (!["owner","manager","staff","advisor_readonly"].includes(role)) {
    return Response.json({ ok: false, error: "unknown role" }, { status: 400 });
  }

  // 1. RLS enforces that only the primary advisor can write here — a stray
  //    request from a seat-holder is silently refused by the policy.
  const { data: client, error: clientErr } = await sb
    .from("advisory_clients")
    .select("id,name,entity_code,primary_advisor_user_id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr) return Response.json({ ok: false, error: clientErr.message }, { status: 500 });
  if (!client)  return Response.json({ ok: false, error: "advisory client not found" }, { status: 404 });
  if (client.primary_advisor_user_id && client.primary_advisor_user_id !== uid) {
    return Response.json({ ok: false, error: "only the primary advisor can invite" }, { status: 403 });
  }

  // 2. Generate a magic-link token — a random string that binds to the seat.
  //    The /auth/callback route redeems it on first sign-in.
  const token = ("adv_" + crypto.randomUUID().replace(/-/g, "")).slice(0, 48);

  // 3. Upsert the seat. If a row exists we resurrect it: clear revoked_at,
  //    rotate the token, refresh invited_at.
  const nowIso = new Date().toISOString();
  const { data: seat, error: seatErr } = await sb
    .from("advisory_seats")
    .upsert({
      advisory_client_id: clientId,
      email,
      role,
      invite_token: token,
      invited_at: nowIso,
      invited_by: uid,
      revoked_at: null,
    }, { onConflict: "advisory_client_id,email" })
    .select("*")
    .maybeSingle();
  if (seatErr) return Response.json({ ok: false, error: seatErr.message }, { status: 500 });

  // 4. Fire the Supabase magic-link. In non-configured envs this returns an
  //    error we swallow — the seat still stands, and the advisor can share
  //    the invite link out-of-band.
  //    The redirect URL carries the invite_token so the callback binds the
  //    auth user to the seat.
  const base = (process.env.NEXT_PUBLIC_APP_URL || "https://foodstudio.ai").replace(/\/$/, "");
  const redirect = base + "/auth/callback?advisory_invite=" + encodeURIComponent(token);
  let emailSent = false;
  try {
    const otp = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
    emailSent = !otp.error;
  } catch { emailSent = false; }

  return Response.json({
    ok: true,
    seat_id: seat?.id || null,
    email_sent: emailSent,
    invite_token: token,
    // The advisor can copy this out-of-band if we couldn't email.
    invite_url: redirect,
  });
}
