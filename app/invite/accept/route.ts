import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { INVITE_ROLE_AREA, type InviteRole } from "@/lib/onboarding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /invite/accept?token=<pending_invites.token>
//
// The landing for team-invite emails (2026-09-21, onboarding blocker #4).
// Auth-walled by middleware: an anon visitor is bounced to /login?next=…
// and comes back here signed in. Then:
//   1. Look the invite up by token (RLS: only the invited email or the
//      inviter can read it).
//   2. Refuse if the signed-in email doesn't match, the invite expired, or
//      someone else already accepted it.
//   3. Ensure a team_members row, upsert the membership with the invited
//      role/area, stamp accepted_at/by.
//   4. Set fs_entity to the new house and land on /h/<slug>.

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
// invite role → team_members.default_role vocabulary
// (worker | chef | maitre | manager | owner).
const TM_ROLE: Record<string, string> = {
  owner: "owner", manager: "manager", chef: "chef", waiter: "maitre", office: "manager",
};

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

  const { data: inv } = await sb
    .from("pending_invites")
    .select("id, entity_id, email, role, expires_at, accepted_at, accepted_by")
    .eq("token", token)
    .maybeSingle();
  if (!inv) {
    return page("Invite not found", `You're signed in as <strong>${esc(myEmail)}</strong>. This invite either doesn't exist or was sent to a different address — sign out and sign in with the invited email.`, 404);
  }
  const invEmail = String(inv.email || "").toLowerCase();
  if (invEmail !== myEmail) {
    return page("Wrong account", `This invite is for <strong>${esc(invEmail)}</strong>, but you're signed in as <strong>${esc(myEmail)}</strong>. Sign out and sign in with the invited email.`, 403);
  }
  if (inv.accepted_at && inv.accepted_by && inv.accepted_by !== user.id) {
    return page("Invite already used", "Someone already accepted this invite. Ask for a new one.", 409);
  }
  if (!inv.accepted_at && inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
    return page("Invite expired", "This invite is older than 30 days. Ask whoever invited you to send a fresh one.", 410);
  }

  const role = String(inv.role || "manager") as InviteRole;

  // team_members — a user can already have several rows; reuse the first.
  const { data: tms } = await sb.from("team_members").select("id").eq("auth_user_id", user.id).limit(1);
  let personId: string | null = (tms || [])[0]?.id ?? null;
  if (!personId) {
    const meta: any = user.user_metadata || {};
    const { data: tm, error: tmErr } = await sb
      .from("team_members")
      .insert({
        auth_user_id: user.id,
        name: meta.full_name || meta.name || myEmail,
        email: myEmail,
        status: "active",
        default_role: TM_ROLE[role] || "worker",   // NOT NULL column
      })
      .select("id")
      .single();
    if (tmErr || !tm) return page("Couldn't join", "We couldn't create your team profile. Try again, or ask the house owner to check the invite.", 500);
    personId = tm.id as string;
  }

  const { data: others } = await sb
    .from("memberships").select("id").eq("person_id", personId).eq("status", "active").neq("entity_id", inv.entity_id).limit(1);
  const { error: memErr } = await sb.from("memberships").upsert(
    {
      person_id: personId,
      entity_id: inv.entity_id,
      role,
      area: INVITE_ROLE_AREA[role] || "foh",
      status: "active",
      is_default: !(others && others.length),
    },
    { onConflict: "person_id,entity_id" },
  );
  if (memErr) return page("Couldn't join", "We couldn't add you to the house. Try again, or ask the owner to re-send the invite.", 500);

  if (!inv.accepted_at) {
    await sb.from("pending_invites").update({ accepted_at: new Date().toISOString(), accepted_by: user.id }).eq("id", inv.id);
  }

  const { data: ent } = await sb.from("entities").select("slug").eq("id", inv.entity_id).maybeSingle();
  const dest = ent?.slug ? `/h/${ent.slug}` : "/";
  const res = NextResponse.redirect(new URL(dest, url.origin));
  res.cookies.set({ name: "fs_entity", value: inv.entity_id as string, path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return res;
}
