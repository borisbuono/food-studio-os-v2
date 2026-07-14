import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";
import { FIRST_WEEK, STEP_LABEL, ROLE_LABEL, OnboardingRole } from "@/lib/team/onboarding";
import FirstWeekCheckbox from "@/components/FirstWeekCheckbox";

export const dynamic = "force-dynamic";

// Manager's first-week checklist for a specific new hire.
// Reads live from onboarding_steps + team_invitations, no derived cache.

export default async function FirstWeek({ params }: { params: { id: string } }) {
  const sb = supabaseServer();
  const { data: p } = await sb.from("profiles").select("id,name,role,restaurant_id,email").eq("id", params.id).maybeSingle();
  if (!p) redirect("/administrate/team");
  const { data: venue } = await sb.from("restaurants").select("name").eq("id", p.restaurant_id).maybeSingle();

  const rlow = (p.role || "other").toLowerCase();
  const role: OnboardingRole = (["owner","manager","chef","foh","pastry","porter","host"] as OnboardingRole[]).includes(rlow as OnboardingRole)
    ? (rlow as OnboardingRole) : (rlow.includes("worker") ? "foh" : "other");

  const { data: inv } = await sb
    .from("team_invitations")
    .select("starting_date,accepted_at,entity_code")
    .eq("invited_email", (p.email || "").toLowerCase())
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const entityCode = inv?.entity_code || "IFL";

  const { data: steps } = await sb.from("onboarding_steps").select("step_key,done_at,notes").eq("user_id", p.id);
  const doneMap = new Map<string, { done_at: string | null; notes: string | null }>();
  (steps || []).forEach((s: any) => doneMap.set(s.step_key, { done_at: s.done_at, notes: s.notes }));

  const startDate = inv?.starting_date ? new Date(inv.starting_date + "T00:00:00") : (inv?.accepted_at ? new Date(inv.accepted_at) : new Date());
  const startLabel = startDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  const totalSteps = FIRST_WEEK.reduce((sum, d) => sum + d.steps.length, 0);
  const doneSteps = FIRST_WEEK.reduce((sum, d) => sum + d.steps.filter((k) => doneMap.get(k)?.done_at).length, 0);
  const pct = totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0;

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/administrate/team/onboarding" className="font-sans text-sm text-ink-soft">back to pipeline</Link>
      <p className="mt-6 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>First week · {ROLE_LABEL[role]}</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{noEmoji(p.name || p.email || "New hire")}</h1>
      <p className="mt-2 font-mono text-[11px] uppercase tracking-wide text-clay">{[venue?.name, "starts " + startLabel].filter(Boolean).join(" · ")}</p>

      <div className="mt-8 border-y border-line py-4">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Manager checkpoints</p>
          <p className="font-mono text-[11px] text-ink-soft">{doneSteps} of {totalSteps} done</p>
        </div>
        <div className="mt-2 h-1.5 w-full rounded-full bg-black/10">
          <div className="h-full rounded-full transition-all" style={{ width: pct + "%", background: "var(--accent)" }} />
        </div>
      </div>

      <div className="mt-8 space-y-10">
        {FIRST_WEEK.map((bucket) => (
          <section key={bucket.day}>
            <p className="font-mono text-[11px] uppercase tracking-wide text-clay">{bucket.day} · {bucket.label}</p>
            <ul className="mt-3 divide-y divide-line border-y border-line">
              {bucket.steps.map((key) => {
                const done = doneMap.get(key);
                return (
                  <li key={key} className="py-3">
                    <FirstWeekCheckbox userId={p.id} stepKey={key} entityCode={entityCode} initialDone={!!done?.done_at} initialNotes={done?.notes || ""} label={STEP_LABEL[key]} />
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link href={"/administrate/team/" + p.id + "/first-shift"} className="rounded-xl px-5 py-2.5 font-sans text-[13px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>Guided first shift →</Link>
        <Link href={"/administrate/team/" + p.id + "/training"} className="rounded-xl border border-black/15 px-4 py-2.5 font-sans text-[13px] text-ink-soft">Training progress</Link>
      </div>

      <p className="mt-10 font-mono text-[10px] uppercase tracking-wide text-clay">Each check writes to onboarding_steps — the trainee sees the same live state on their side.</p>
    </main>
  );
}
