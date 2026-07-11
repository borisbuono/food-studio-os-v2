"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile } from "@/lib/profile";
import { ROLE_LABEL, OnboardingRole } from "@/lib/team/onboarding";

// "New hires this week" — a small editorial strip on the Home compass for
// Office users. Shows up to 3 in-progress onboardings (accepted invitation
// within the last 14 days OR fewer than 8 onboarding_steps done).
//
// Zero-state renders NOTHING — the strip only appears when there is
// someone to hold in mind.

type Row = {
  user_id: string;
  name: string;
  email: string;
  role: OnboardingRole;
  accepted_at: string | null;
  starting_date: string | null;
  step_count: number;
};

export default function NewHiresStrip() {
  const [rows, setRows] = useState<Row[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const me = await getMyProfile();
      if (!me || !me.isAdmin) { setReady(true); return; }
      // Accepted in the last 14 days.
      const cutoff = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
      const { data: invs } = await supabaseBrowser
        .from("team_invitations")
        .select("invited_email,invited_name,role,accepted_at,starting_date")
        .not("accepted_at", "is", null)
        .is("revoked_at", null)
        .gte("accepted_at", cutoff)
        .order("accepted_at", { ascending: false });
      if (!invs?.length) { setReady(true); return; }

      const emails = invs.map((i: any) => (i.invited_email || "").toLowerCase()).filter(Boolean);
      const { data: profs } = await supabaseBrowser.from("profiles").select("id,email,name").in("email", emails);
      const byEmail = new Map<string, { id: string; name: string }>();
      (profs || []).forEach((p: any) => { if (p.email) byEmail.set(p.email.toLowerCase(), { id: p.id, name: p.name }); });

      const ids = Array.from(byEmail.values()).map((p) => p.id);
      const stepCount = new Map<string, number>();
      if (ids.length) {
        const { data: steps } = await supabaseBrowser
          .from("onboarding_steps").select("user_id").in("user_id", ids).not("done_at", "is", null);
        (steps || []).forEach((s: any) => stepCount.set(s.user_id, (stepCount.get(s.user_id) || 0) + 1));
      }

      const out: Row[] = [];
      for (const inv of invs as any[]) {
        const prof = byEmail.get((inv.invited_email || "").toLowerCase());
        if (!prof) continue;
        const sc = stepCount.get(prof.id) || 0;
        if (sc >= 8) continue;  // fully onboarded, off the strip
        out.push({
          user_id: prof.id,
          name: prof.name || inv.invited_name || inv.invited_email,
          email: inv.invited_email,
          role: (inv.role as OnboardingRole) || "other",
          accepted_at: inv.accepted_at,
          starting_date: inv.starting_date,
          step_count: sc,
        });
        if (out.length >= 3) break;
      }
      setRows(out);
      setReady(true);
    })();
  }, []);

  if (!ready || !rows.length) return null;

  return (
    <div className="mt-6 border-t border-black/10 pt-4">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">New hires this week</p>
        <Link href="/administrate/team/onboarding" className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>see all ›</Link>
      </div>
      <ul className="mt-2 divide-y divide-black/5">
        {rows.map((r) => {
          const startLabel = r.starting_date
            ? new Date(r.starting_date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })
            : (r.accepted_at ? new Date(r.accepted_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");
          return (
            <li key={r.user_id}>
              <Link href={"/administrate/team/" + r.user_id + "/first-week"} className="block py-2.5 transition hover:opacity-80">
                <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{ROLE_LABEL[r.role]} · {startLabel} · {r.step_count} of 12 steps</p>
                <p className="mt-0.5 font-sans text-[14px] text-ink">{r.name}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
