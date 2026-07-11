import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";
import { ROLE_LABEL, OnboardingRole } from "@/lib/team/onboarding";
import FirstShiftObservations from "@/components/FirstShiftObservations";

export const dynamic = "force-dynamic";

// The guided first-shift flow. Three phases:
//   Pre-shift  — MEP walk / uniform / lockers / clock-in / cook-mode intro
//   Mid-shift  — hourly buddy check-ins (nudged by the Assistant FAB)
//   Post-shift — 5-min debrief prompt (how did it go / friction / questions)
//
// All rows write into onboarding_steps as (user, step_key). The post-shift
// debrief is stored as notes on the first_solo_shift row + used to build the
// day-1 report the manager sees back on /administrate/team/[id]/first-week.

const PRE_SHIFT = [
  { key: "system_walked",         label: "MEP walkthrough",                          blurb: "The section, the stations, where things live." },
  { key: "clock_in_configured",   label: "Uniform and lockers",                      blurb: "Where the change happens." },
  { key: "buddy_assigned",        label: "Clock-in on their phone",                  blurb: "Show them personal-phone clock-in. Fence check." },
  { key: "first_meal_briefed",    label: "Cook Mode intro",                          blurb: "The recipe surface they will lean on all night." },
] as const;

const MID_SHIFT = [
  { hour: 1, label: "First hour check-in",  blurb: "How are they landing? Anything stuck?" },
  { hour: 2, label: "Mid-service check-in", blurb: "One good thing, one thing to correct." },
  { hour: 3, label: "Pre-close check-in",   blurb: "Are they still with us? Anything to slow down for?" },
];

export default async function FirstShift({ params }: { params: { user_id: string } }) {
  const sb = supabaseServer();
  const { data: p } = await sb.from("profiles").select("id,name,role,restaurant_id,email").eq("id", params.user_id).maybeSingle();
  if (!p) redirect("/administrate/team");
  const { data: venue } = await sb.from("restaurants").select("name").eq("id", p.restaurant_id).maybeSingle();

  const rlow = (p.role || "other").toLowerCase();
  const role: OnboardingRole = (["owner","manager","chef","foh","pastry","porter","host"] as OnboardingRole[]).includes(rlow as OnboardingRole)
    ? (rlow as OnboardingRole) : (rlow.includes("worker") ? "foh" : "other");

  const { data: inv } = await sb.from("team_invitations").select("entity_code,starting_date").eq("invited_email", (p.email || "").toLowerCase()).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const entityCode = inv?.entity_code || "IFL";

  const { data: steps } = await sb.from("onboarding_steps").select("step_key,done_at,notes").eq("user_id", p.id);
  const doneMap = new Map<string, { done_at: string | null; notes: string | null }>();
  (steps || []).forEach((s: any) => doneMap.set(s.step_key, { done_at: s.done_at, notes: s.notes }));
  const soloShift = doneMap.get("first_solo_shift");

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href={"/administrate/team/" + p.id + "/first-week"} className="font-sans text-sm text-ink-soft">back to first week</Link>
      <p className="mt-6 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>First shift · {ROLE_LABEL[role]}</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{noEmoji(p.name || p.email || "New hire")}</h1>
      <p className="mt-2 font-mono text-[11px] uppercase tracking-wide text-clay">{[venue?.name, "guided run"].filter(Boolean).join(" · ")}</p>

      <section className="mt-10">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Pre-shift</p>
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {PRE_SHIFT.map((s) => {
            const done = doneMap.get(s.key)?.done_at;
            return (
              <li key={s.key} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <p className={"font-serif text-[17px] " + (done ? "text-ink-soft line-through" : "text-ink")}>{s.label}</p>
                    <p className="mt-0.5 font-sans text-[13px] text-ink-soft">{s.blurb}</p>
                  </div>
                  <span className="font-mono text-[11px]" style={{ color: done ? "var(--accent)" : "" }}>{done ? "done" : "open"}</span>
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 font-sans text-[12px] text-ink-soft">Check these off from the first-week list — they are the same rows.</p>
      </section>

      <section className="mt-10">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">During shift · buddy check-ins</p>
        <p className="mt-2 font-sans text-[13px] text-ink-soft">The Assistant Layer nudges the manager at each hour mark. Tap through if you handled it in person.</p>
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {MID_SHIFT.map((m) => (
            <li key={m.hour} className="py-3">
              <p className="font-serif text-[17px] text-ink">Hour {m.hour} — {m.label}</p>
              <p className="mt-0.5 font-sans text-[13px] text-ink-soft">{m.blurb}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Post-shift · 5-minute debrief</p>
        <FirstShiftObservations userId={p.id} entityCode={entityCode} initialNotes={soloShift?.notes || ""} initialDone={!!soloShift?.done_at} />
      </section>

      <section className="mt-10 rounded-2xl border border-line bg-card p-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Day-1 report</p>
        <p className="mt-1 font-serif text-[15px] text-ink-soft">
          {soloShift?.done_at
            ? "Completed " + new Date(soloShift.done_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + "."
            : "Report generates once the debrief is saved."}
        </p>
        {soloShift?.notes ? (
          <p className="mt-2 font-serif text-[15px] leading-relaxed text-ink whitespace-pre-wrap">{soloShift.notes}</p>
        ) : null}
      </section>

      <p className="mt-10 font-mono text-[10px] uppercase tracking-wide text-clay">All observations write to onboarding_steps — pipeline and Home strip stay in sync.</p>
    </main>
  );
}
