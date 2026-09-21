// lib/email/invite.ts — transactional email for pending_invites.
//
// Onboarding stress test 2026-09-21, blocker #4: pending_invites rows were
// written but nobody got an email (the old signInWithOtp call ran on the
// INVITER's session, so the PKCE verifier lived in the wrong browser and the
// link could never be exchanged by the invitee).
//
// Flow now:
//   1. Service-role admin.generateLink() mints a one-time token for the
//      invitee's email ('invite' for new users, 'magiclink' for existing).
//   2. The email carries OUR link: /auth/confirm?token_hash=…&type=…&next=
//      /invite/accept?token=<pending_invites.token>. verifyOtp() needs no
//      PKCE verifier, so it works in whatever browser the invitee opens.
//   3. /invite/accept turns the pending_invites row into a membership.
//
// Delivery via Resend (RESEND_API_KEY). Needs SUPABASE_SERVICE_ROLE_KEY for
// the one-click sign-in link. If either is missing we still return the plain
// accept link (/invite/accept?token=…) — it works after a normal Google
// sign-in with the invited address — so step 4 can show "copy link".
//
// Server-only. Never import from a Client Component.

import { createClient } from "@supabase/supabase-js";

export type InviteSendResult = {
  emailed: boolean;
  acceptUrl: string;      // plain link, always valid (sign-in required)
  error?: string;
};

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner", manager: "Manager", chef: "Chef", waiter: "Waiter", office: "Office",
};

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "fs-invite-admin" },
  });
}

export function appOrigin(fallback?: string | null): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/$/, "");
  if (fallback) return fallback.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return "https://" + process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (process.env.VERCEL_URL) return "https://" + process.env.VERCEL_URL;
  return "http://localhost:3000";
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export async function sendInviteEmail(args: {
  email: string;
  role: string;
  token: string;            // pending_invites.token
  houseName: string;
  inviterName?: string | null;
  origin?: string | null;   // request origin, used when no site URL env is set
}): Promise<InviteSendResult> {
  const origin = appOrigin(args.origin);
  const acceptPath = `/invite/accept?token=${encodeURIComponent(args.token)}`;
  const acceptUrl = origin + acceptPath;

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return { emailed: false, acceptUrl, error: "RESEND_API_KEY not set" };

  // One-click link when we can mint a token; plain accept link otherwise.
  let clickUrl = acceptUrl;
  const admin = adminClient();
  if (admin) {
    try {
      let type: "invite" | "magiclink" = "invite";
      let res = await admin.auth.admin.generateLink({ type: "invite", email: args.email });
      if (res.error) {
        type = "magiclink";
        res = await admin.auth.admin.generateLink({ type: "magiclink", email: args.email });
      }
      const hashed = (res.data as any)?.properties?.hashed_token as string | undefined;
      if (!res.error && hashed) {
        const u = new URL("/auth/confirm", origin);
        u.searchParams.set("token_hash", hashed);
        u.searchParams.set("type", type);
        u.searchParams.set("next", acceptPath);
        clickUrl = u.toString();
      }
    } catch { /* fall back to plain accept link */ }
  }

  const role = ROLE_LABEL[args.role] || args.role;
  const house = esc(args.houseName || "your house");
  const who = args.inviterName ? esc(args.inviterName) + " has" : "You've been";
  const html = `<!doctype html>
<html><body style="font-family: Georgia, serif; background:#EFEEEB; margin:0; padding:32px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px; margin:0 auto; background:#FBF7EF; padding:36px; border-radius:6px;">
    <tr><td>
      <p style="font-family: 'DM Mono', monospace; font-size:11px; letter-spacing:0.28em; text-transform:uppercase; color:#4E6332; margin:0 0 8px;">Team invite</p>
      <h1 style="font-family: Fraunces, Georgia, serif; font-weight:300; font-size:28px; color:#171511; margin:0 0 24px;">Join ${house}</h1>
      <p style="font-size:17px; line-height:1.5; color:#3A352D; margin:0 0 28px;">${who} invited ${args.inviterName ? "you " : ""}to ${house} as <strong>${esc(role)}</strong>. One click signs you in and takes you to your room.</p>
      <p style="margin:0 0 32px;"><a href="${clickUrl}" style="display:inline-block; background:#4E6332; color:#FBF7EF; text-decoration:none; padding:12px 22px; border-radius:999px; font-family: Inter, sans-serif; font-size:13px; letter-spacing:0.04em;">Accept invite</a></p>
      <p style="font-size:13px; line-height:1.5; color:#7A7A75; margin:0;">The link is personal to ${esc(args.email)} and expires in 30 days. If you weren't expecting this, ignore it.</p>
      <p style="font-family: 'DM Mono', monospace; font-size:10px; letter-spacing:0.2em; text-transform:uppercase; color:#7A7A75; margin:24px 0 0;">Food Studios</p>
    </td></tr>
  </table>
</body></html>`;

  const from = process.env.INVITE_EMAIL_FROM || process.env.GUEST_EMAIL_FROM || "Food Studios <no-reply@foodstudios.local>";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({ from, to: [args.email], subject: `You're invited to ${args.houseName || "Food Studios"}`, html }),
    });
    if (!r.ok) return { emailed: false, acceptUrl, error: `resend ${r.status}` };
    return { emailed: true, acceptUrl };
  } catch (e: any) {
    return { emailed: false, acceptUrl, error: e?.message || "email dispatch failed" };
  }
}
