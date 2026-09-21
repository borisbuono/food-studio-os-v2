import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /invite/accept?token=<pending_invites.token>
//
// The landing for team-invite emails (2026-09-21, onboarding blocker #4).
// Auth-walled by middleware: an anon visitor is bounced to /login?next=…
// and comes back here signed in. Then:
//   1. accept_pending_invite(token) — a SECURITY DEFINER function that checks
//      the invite against the caller's JWT email, ensures a team_members row,
//      upserts the membership with the invited role/area and stamps
//      accepted_at/by. In the function because after the Phase 3.5 RLS
//      rollout an invitee has no write rights on memberships yet.
//   2. Set fs_entity to the new house and land on /h/<slug>.

function page(title: string, body: string, status = 400) {
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:Georgia,serif;background:#EFEEEB;margin:0;padding:48px 16px;">
<div style="max-width:520px;margin:0 auto;background:#FBF7EF;padding:32px;border-radius:6px;">
<h1 style="font-weight:300;font-size:26px;color:#171511;margin:0 0 16px;">${title}</h1>
<p style="font-size:16px;line-height:1.5;color:#3A352D;margin:0 0 24px;">${body}</p>
<a href="/" style="font-family:Inter,sans-serif;font-size:13px;color:#4E6332;">Go to Food Studios →</a>
</div></body></html>`;
  return new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") || "").trim();
  if (!token) return page("Invite link incomplete", "This link is missing its token. Ask whoever invited you to send it again.");

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const user = u.user;
  if (!user) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("next", `/invite/accept?token=${encodeURIComponent(token)}`);
    return NextResponse.redirect(login);
  }
  const myEmail = (user.email || "").toLowerCase();

  const { data: rows, error: rpcErr } = await sb.rpc("accept_pending_invite", { p_token: token });
  const r: any = Array.isArray(rows) ? rows[0] : rows;
  const status = rpcErr ? "error" : String(r?.status || "error");

  if (status === "not_found") {
    return page("Invite not found", `You're signed in as <strong>${esc(myEmail)}</strong>. This invite either doesn't exist or was sent to a different address — sign out and sign in with the invited email.`, 404);
  }
  if (status === "wrong_account") {
    return page("Wrong account", `You're signed in as <strong>${esc(myEmail)}</strong>, which isn't the address this invite was sent to. Sign out and sign in with the invited email.`, 403);
  }
  if (status === "used")    return page("Invite already used", "Someone already accepted this invite. Ask for a new one.", 409);
  if (status === "expired") return page("Invite expired", "This invite is older than 30 days. Ask whoever invited you to send a fresh one.", 410);
  if (status !== "ok")      return page("Couldn't join", "We couldn't add you to the house. Try again, or ask the owner to re-send the invite.", 500);

  const dest = r?.slug ? `/h/${r.slug}` : "/";
  const res = NextResponse.redirect(new URL(dest, url.origin));
  if (r?.entity_id) {
    res.cookies.set({ name: "fs_entity", value: String(r.entity_id), path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  return res;
}
