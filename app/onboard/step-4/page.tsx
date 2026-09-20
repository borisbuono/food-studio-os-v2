// /onboard/step-4 — invite the team.
//
// Optional step: the operator can add one, several, or skip entirely.
// Each invite writes a pending_invites row and (for now) surfaces the
// magic-link URL so the operator can share it directly if they'd rather
// not wait on email. The email send-out itself is a separate concern
// (Supabase Auth's invite email or a project SMTP transport).

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { readOnboardingState, INVITE_ROLES, INVITE_ROLE_LABEL } from "@/lib/onboarding";
import { OnboardShell, inputCls, labelCls, primaryBtn, secondaryBtn } from "@/components/OnboardShell";
import { inviteTeammateAction } from "../actions";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function OnboardStep4({ searchParams }: { searchParams?: { e?: string; ok?: string } }) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) redirect("/onboard/step-1");
  const state = await readOnboardingState();
  if (!state.entity_id) redirect("/onboard/step-3");

  // Show any invites this operator has already issued for this entity.
  const { data: invites } = await sb
    .from("pending_invites")
    .select("id, email, role, token, accepted_at, created_at")
    .eq("entity_id", state.entity_id)
    .order("created_at", { ascending: false });

  const err = searchParams?.e || null;
  const ok  = searchParams?.ok === "1";

  return (
    <OnboardShell
      step={4}
      eyebrow={state.house?.trading_name || "Your house"}
      title="Bring the team in."
      sub="Send a link. They click, sign in, and land in the right room. You can skip and add them later."
    >
      <form action={inviteTeammateAction} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_180px]">
          <label className="block">
            <span className={labelCls}>Email</span>
            <input name="email" type="email" required className={inputCls} placeholder="them@yourhouse.com" />
          </label>
          <label className="block">
            <span className={labelCls}>Role</span>
            <select name="role" defaultValue="manager" className={inputCls}>
              {INVITE_ROLES.map((r) => (
                <option key={r} value={r}>{INVITE_ROLE_LABEL[r]}</option>
              ))}
            </select>
          </label>
        </div>

        {err ? <p className="font-mono text-[11px] text-tomato">{err === "email" ? "Please enter a valid email." : err}</p> : null}
        {ok ? <p className="font-mono text-[11px]" style={{ color: "var(--accent)" }}>Invite added.</p> : null}

        <button className={primaryBtn}>Send invite</button>
      </form>

      {invites && invites.length > 0 ? (
        <div className="mt-10 border-t border-black/10 pt-6">
          <p className={labelCls}>Sent so far</p>
          <ul className="mt-3 divide-y divide-black/10">
            {invites.map((inv: any) => (
              <li key={inv.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-serif text-[15px] text-ink">{inv.email}</p>
                  <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
                    {(INVITE_ROLE_LABEL as Record<string, string>)[inv.role] || inv.role} · {inv.accepted_at ? "accepted" : "pending"}
                  </p>
                </div>
                <span className="font-mono text-[10px] text-clay">{inv.token.slice(0, 8)}…</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-10 flex items-center gap-3">
        <Link href="/onboard/step-3" className={secondaryBtn}>Back</Link>
        <Link href="/onboard/step-5" className={primaryBtn + " flex-1 text-center"}>
          {invites && invites.length ? "Continue →" : "Skip for now →"}
        </Link>
      </div>
    </OnboardShell>
  );
}
