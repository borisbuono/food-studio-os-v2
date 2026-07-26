"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile } from "@/lib/profile";
import { ROLE_LABEL, OnboardingRole } from "@/lib/team/onboarding";
import FabHidden from "@/components/FabHidden";

// The trainee's personal training path — the required lessons for their role,
// their status on each, and a mark-complete flow.
//
// Written from the person's own POV (not the manager's), so this is /team/…
// not /administrate/team/…. Managers get their own view at
// /administrate/team/[user_id]/training.

type Lesson = { id: string; title: string; body_md: string | null; estimated_minutes: number; order_index: number };
type Progress = { lesson_id: string; status: "not_started" | "in_progress" | "done"; started_at: string | null; completed_at: string | null };

export default function TraineeTraining({ params }: { params: { user_id: string } }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [progress, setProgress] = useState<Map<string, Progress>>(new Map());
  const [role, setRole] = useState<OnboardingRole>("other");
  const [entityCode, setEntityCode] = useState<string>("IFL");
  const [openId, setOpenId] = useState<string | null>(null);
  const [ownName, setOwnName] = useState<string>("");

  useEffect(() => {
    (async () => {
      const me = await getMyProfile();
      if (!me) { router.replace("/login"); return; }
      // Self-only for the trainee view — a manager who wants to see someone
      // else's path uses /administrate/team/[user_id]/training.
      if (me.id !== params.user_id) { router.replace("/administrate/team/" + params.user_id + "/training"); return; }
      setOwnName(me.name || "");
      const r = (me.dbRole || "other").toLowerCase();
      const mapped: OnboardingRole = (["owner","manager","chef","foh","pastry","porter","host"] as OnboardingRole[]).includes(r as OnboardingRole) ? (r as OnboardingRole) : (r.includes("worker") ? "foh" : "other");
      setRole(mapped);

      // Latest invitation (if any) to pin the entity code.
      const { data: inv } = await supabaseBrowser.from("team_invitations").select("entity_code").eq("invited_email", (me.email || "").toLowerCase()).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (inv?.entity_code) setEntityCode(inv.entity_code);

      // Required lessons that match this role. Cross-referenced via the
      // GIN-indexed assigned_roles array.
      const { data: ls } = await supabaseBrowser
        .from("academy_lessons")
        .select("id,title,body_md,estimated_minutes,order_index,assigned_roles,required_for_onboarding")
        .eq("required_for_onboarding", true)
        .order("order_index", { ascending: true });
      const filtered = (ls || []).filter((l: any) => Array.isArray(l.assigned_roles) && l.assigned_roles.includes(mapped));
      setLessons(filtered.map(({ assigned_roles, required_for_onboarding, ...rest }: any) => rest));

      // Progress for me.
      const { data: pr } = await supabaseBrowser.from("academy_lesson_progress").select("lesson_id,status,started_at,completed_at").eq("user_id", me.id);
      const m = new Map<string, Progress>();
      (pr || []).forEach((row: any) => m.set(row.lesson_id, row));
      setProgress(m);

      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.user_id]);

  const total = lessons.length;
  const done = lessons.filter((l) => progress.get(l.id)?.status === "done").length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  async function markComplete(lessonId: string) {
    const me = await getMyProfile();
    if (!me) return;
    const nowIso = new Date().toISOString();
    const existing = progress.get(lessonId);
    const row = {
      user_id: me.id,
      lesson_id: lessonId,
      status: "done" as const,
      started_at: existing?.started_at || nowIso,
      completed_at: nowIso,
    };
    await supabaseBrowser.from("academy_lesson_progress").upsert(row, { onConflict: "user_id,lesson_id" });
    const next = new Map(progress); next.set(lessonId, row); setProgress(next);
    // If the trainee just crossed the gates, write the onboarding_steps
    // that Home + first-week views hinge on. Idempotent upserts.
    const nowDone = lessons.filter((l) => (next.get(l.id)?.status === "done")).length;
    if (nowDone >= Math.min(total, 3)) {
      await supabaseBrowser.from("onboarding_steps").upsert({ user_id: me.id, entity_code: entityCode, step_key: "system_walked", done_at: nowIso }, { onConflict: "user_id,step_key" });
    }
    if (nowDone >= Math.min(total, 5)) {
      await supabaseBrowser.from("onboarding_steps").upsert({ user_id: me.id, entity_code: entityCode, step_key: "pos_trained", done_at: nowIso }, { onConflict: "user_id,step_key" });
    }
  }

  async function markStarted(lessonId: string) {
    const me = await getMyProfile();
    if (!me) return;
    const existing = progress.get(lessonId);
    if (existing?.status === "in_progress" || existing?.status === "done") return;
    const row = { user_id: me.id, lesson_id: lessonId, status: "in_progress" as const, started_at: new Date().toISOString(), completed_at: null };
    await supabaseBrowser.from("academy_lesson_progress").upsert(row, { onConflict: "user_id,lesson_id" });
    const next = new Map(progress); next.set(lessonId, row as any); setProgress(next);
  }

  if (!ready) return <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-16"><FabHidden /><p className="font-serif text-2xl text-ink">Loading your training...</p></main>;

  return (
    <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">back to home</Link>
      <p className="mt-6 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Training</p>
      <h1 className="mt-2 font-serif text-4xl leading-[1.05] text-ink">Your first lessons</h1>
      <p className="mt-3 font-serif text-[17px] leading-relaxed text-ink-soft">
        The path we would want anyone in your role to have walked before their first solo shift. Short and precise.
      </p>

      <div className="mt-8 border-y border-line py-4">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{ROLE_LABEL[role]}</p>
          <p className="font-mono text-[11px] text-ink-soft">{done} of {total} done</p>
        </div>
        <div className="mt-2 h-1.5 w-full rounded-full bg-black/10">
          <div className="h-full rounded-full transition-all" style={{ width: pct + "%", background: "var(--accent)" }} />
        </div>
      </div>

      {!lessons.length ? (
        <p className="mt-8 font-serif italic text-[15px] text-ink-soft">No lessons required for your role yet. Ask your manager — this is the calm before the reps.</p>
      ) : (
        <ul className="mt-8 divide-y divide-line">
          {lessons.map((l) => {
            const p = progress.get(l.id);
            const status = p?.status || "not_started";
            const statusLabel = status === "done" ? "Done" : status === "in_progress" ? "In progress" : "Not started";
            const isOpen = openId === l.id;
            return (
              <li key={l.id} className="py-4">
                <button className="flex w-full items-baseline justify-between gap-4 text-left" onClick={() => { setOpenId(isOpen ? null : l.id); if (!isOpen) markStarted(l.id); }}>
                  <div>
                    <p className="font-serif text-[19px] text-ink">{l.title}</p>
                    <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wide text-clay">{l.estimated_minutes} min · {statusLabel}</p>
                  </div>
                  <span className={"font-mono text-[11px] " + (status === "done" ? "" : "text-ink-soft")} style={status === "done" ? { color: "var(--accent)" } : undefined}>{isOpen ? "close" : status === "done" ? "revisit" : "open"}</span>
                </button>
                {isOpen ? (
                  <div className="mt-3 rounded-2xl border border-line bg-card p-5">
                    <p className="font-serif text-[16px] leading-relaxed text-ink whitespace-pre-wrap">{l.body_md || "This lesson does not yet have a written body. Ask your manager to walk you through it in person."}</p>
                    <div className="mt-4 flex gap-3">
                      {status !== "done" ? (
                        <button onClick={() => markComplete(l.id)} className="rounded-xl px-5 py-2.5 font-sans text-[13px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>Mark complete</button>
                      ) : (
                        <span className="font-sans text-[13px] text-ink-soft">Completed {p?.completed_at ? new Date(p.completed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""}.</span>
                      )}
                      <Link href="/academy" className="rounded-xl border border-black/15 px-4 py-2.5 font-sans text-[13px] text-ink-soft">Open Academy</Link>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-10 font-mono text-[10px] uppercase tracking-wide text-clay">
        Your progress is shared with your manager. Everything here is on your side of the OS.
      </p>
    </main>
  );
}
