import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";
import { ROLE_LABEL, OnboardingRole } from "@/lib/team/onboarding";

export const dynamic = "force-dynamic";

// Manager surface: same shape as the trainee's page but read-only from the
// manager's side, plus a "nudge" affordance (mailto for now). The shared
// data source means both views tell the same truth.

export default async function ManagerTraining({ params }: { params: { id: string } }) {
  const sb = supabaseServer();
  const { data: p } = await sb.from("profiles").select("id,name,role,restaurant_id,email").eq("id", params.id).maybeSingle();
  if (!p) redirect("/administrate/team");
  const { data: venue } = await sb.from("restaurants").select("name").eq("id", p.restaurant_id).maybeSingle();

  const rlow = (p.role || "other").toLowerCase();
  const role: OnboardingRole = (["owner","manager","chef","foh","pastry","porter","host"] as OnboardingRole[]).includes(rlow as OnboardingRole)
    ? (rlow as OnboardingRole)
    : (rlow.includes("worker") ? "foh" : "other");

  const { data: lessons } = await sb
    .from("academy_lessons")
    .select("id,title,estimated_minutes,order_index,assigned_roles,required_for_onboarding")
    .eq("required_for_onboarding", true)
    .order("order_index", { ascending: true });
  const filtered = ((lessons || []) as any[]).filter((l) => Array.isArray(l.assigned_roles) && l.assigned_roles.includes(role));

  const lessonIds = filtered.map((l: any) => l.id);
  const { data: progress } = lessonIds.length
    ? await sb.from("academy_lesson_progress").select("lesson_id,status,started_at,completed_at").eq("user_id", p.id).in("lesson_id", lessonIds)
    : { data: [] as any[] };
  const pmap = new Map<string, any>();
  (progress || []).forEach((r: any) => pmap.set(r.lesson_id, r));

  const done = filtered.filter((l) => pmap.get(l.id)?.status === "done").length;
  const total = filtered.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href={"/administrate/team/" + p.id} className="font-sans text-sm text-ink-soft">back to person</Link>
      <p className="mt-6 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Training · {ROLE_LABEL[role]}</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{noEmoji(p.name || p.email || "This person")}</h1>
      <p className="mt-2 font-mono text-[11px] uppercase tracking-wide text-clay">{[venue?.name, p.email].filter(Boolean).join(" · ")}</p>

      <div className="mt-8 border-y border-line py-4">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Required lessons</p>
          <p className="font-mono text-[11px] text-ink-soft">{done} of {total} done</p>
        </div>
        <div className="mt-2 h-1.5 w-full rounded-full bg-black/10">
          <div className="h-full rounded-full transition-all" style={{ width: pct + "%", background: "var(--accent)" }} />
        </div>
      </div>

      {!filtered.length ? (
        <p className="mt-8 font-serif italic text-[15px] text-ink-soft">No required lessons matched their role. Add lessons in Academy and set required_for_onboarding to include them here.</p>
      ) : (
        <ul className="mt-8 divide-y divide-line border-y border-line">
          {filtered.map((l: any) => {
            const pr = pmap.get(l.id);
            const status = pr?.status || "not_started";
            const label = status === "done" ? ("done " + new Date(pr.completed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })) : status === "in_progress" ? "in progress" : "not started";
            return (
              <li key={l.id} className="flex items-baseline justify-between gap-4 py-4">
                <div>
                  <p className="font-serif text-[19px] text-ink">{l.title}</p>
                  <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wide text-clay">{l.estimated_minutes} min</p>
                </div>
                <span className="font-mono text-[11px]" style={{ color: status === "done" ? "var(--accent)" : "" }}>{label}</span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href={"/administrate/team/" + p.id + "/first-week"} className="rounded-xl px-5 py-2.5 font-sans text-[13px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>First-week checklist →</Link>
        {p.email ? (
          <a href={"mailto:" + p.email + "?subject=" + encodeURIComponent("Your training path")} className="rounded-xl border border-black/15 px-5 py-2.5 font-sans text-[13px] text-ink-soft">Nudge</a>
        ) : null}
      </div>

      <p className="mt-10 font-mono text-[10px] uppercase tracking-wide text-clay">This mirrors their own /team/{p.id.slice(0,8)}…/training view. Both write the same table.</p>
    </main>
  );
}
