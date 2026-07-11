import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { invitationStatus, ROLE_LABEL, STEP_LABEL, PipelineStatus, OnboardingRole, StepKey } from "@/lib/team/onboarding";

export const dynamic = "force-dynamic";

// The manager pipeline view — every invited / onboarding / active new hire
// in one editorial column. Reads team_invitations + onboarding_steps and
// buckets by invitation lifecycle.

const BUCKET_LABEL: Record<PipelineStatus, string> = {
  invited: "Waiting for them",
  onboarding: "Getting settled",
  active: "On the team",
  expired: "Expired",
  revoked: "Revoked",
};
const BUCKET_ORDER: PipelineStatus[] = ["invited", "onboarding", "active", "expired", "revoked"];

function fmtDate(s: string | null | undefined) {
  if (!s) return "";
  const d = new Date(s.length > 10 ? s : s + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default async function OnboardingPipeline() {
  const sb = supabaseServer();
  const { data: invitations } = await sb
    .from("team_invitations")
    .select("id,invited_name,invited_email,role,restaurant_id,starting_date,accepted_at,revoked_at,expires_at,created_at,magic_link_token")
    .order("created_at", { ascending: false });

  const invs = (invitations || []) as any[];
  const invEmails = invs.map((i) => (i.invited_email || "").toLowerCase()).filter(Boolean);

  // Map each invitation to its onboarding_steps row count. Use email → profile
  // lookup because auth.uid() isn't known at invitation time.
  const emailToProfile = new Map<string, string>();
  if (invEmails.length) {
    const { data: profs } = await sb.from("profiles").select("id,email").in("email", invEmails);
    (profs || []).forEach((p: any) => { if (p.email) emailToProfile.set(p.email.toLowerCase(), p.id); });
  }
  const profileIds = Array.from(emailToProfile.values());
  const stepCountByUser = new Map<string, number>();
  if (profileIds.length) {
    const { data: steps } = await sb.from("onboarding_steps").select("user_id").in("user_id", profileIds).not("done_at", "is", null);
    (steps || []).forEach((s: any) => stepCountByUser.set(s.user_id, (stepCountByUser.get(s.user_id) || 0) + 1));
  }

  const { data: venues } = await sb.from("restaurants").select("id,name");
  const vname = new Map((venues || []).map((v: any) => [v.id, v.name]));

  // Bucket
  const buckets: Record<PipelineStatus, any[]> = {
    invited: [], onboarding: [], active: [], expired: [], revoked: [],
  };
  for (const inv of invs) {
    const pid = emailToProfile.get((inv.invited_email || "").toLowerCase());
    const sc = pid ? (stepCountByUser.get(pid) || 0) : 0;
    const status = invitationStatus(inv, sc);
    buckets[status].push({ ...inv, _pid: pid, _stepCount: sc, _venueName: vname.get(inv.restaurant_id) });
  }

  const total = invs.length;

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate/team" className="font-sans text-sm text-ink-soft">back to team</Link>
      <p className="mt-6 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Onboarding pipeline</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">New hires — the pipeline</h1>
      <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">Every invitation sent, where they are in the flow, whose day-1 you still need to plan.</p>

      <div className="mt-6 flex gap-3">
        <Link href="/administrate/team/onboard/new" className="rounded-xl px-5 py-3 font-sans text-[14px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>+ Invite a new hire</Link>
        <Link href="/administrate/team" className="rounded-xl border border-black/15 px-5 py-3 font-sans text-[14px] text-ink-soft">Existing team</Link>
      </div>

      {!total ? (
        <div className="mt-10 border-t border-line pt-8">
          <p className="font-serif italic text-[16px] text-ink-soft">No invitations yet. When you invite someone, they land here so you can watch them come through — profile signed, documents acknowledged, first shift booked.</p>
        </div>
      ) : (
        <div className="mt-10 space-y-10">
          {BUCKET_ORDER.map((k) => {
            const rows = buckets[k];
            if (!rows.length) return null;
            return (
              <section key={k}>
                <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{BUCKET_LABEL[k]} · {rows.length}</p>
                <ul className="mt-3 divide-y divide-line border-y border-line">
                  {rows.map((r) => {
                    const role = ROLE_LABEL[(r.role as OnboardingRole) || "other"];
                    const meta = [role, r._venueName, r.starting_date ? "start " + fmtDate(r.starting_date) : null].filter(Boolean).join(" · ");
                    const inner = (
                      <>
                        <div>
                          <p className="font-serif text-[19px] text-ink">{r.invited_name || r.invited_email}</p>
                          <p className="font-mono text-[11px] uppercase tracking-wide text-clay">{meta}</p>
                          {r._stepCount > 0 ? <p className="mt-1 font-sans text-[12px] text-ink-soft">{r._stepCount} of 12 steps done</p> : null}
                        </div>
                        <span className="font-mono text-[11px] text-clay">{k === "invited" ? fmtDate(r.created_at) : k === "active" ? "active" : k}</span>
                      </>
                    );
                    return (
                      <li key={r.id} className="py-3">
                        {r._pid ? (
                          <Link href={"/administrate/team/" + r._pid + "/first-week"} className="flex items-baseline justify-between gap-4 transition hover:text-ink-soft">{inner}</Link>
                        ) : (
                          <div className="flex items-baseline justify-between gap-4">{inner}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-10 font-mono text-[10px] uppercase tracking-wide text-clay">Magic-link invitations expire after 30 days — resend from the wizard.</p>
    </main>
  );
}
