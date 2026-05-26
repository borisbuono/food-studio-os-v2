"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile, MyProfile } from "@/lib/profile";

type FB = { id: string; route: string | null; kind: string; body: string; status: string; priority: string; author_name: string | null; author_role: string | null; restaurant_id: string | null; created_at: string };

const STATUSES = ["new", "triaged", "in_progress", "done", "wontfix"];
const STATUS_LABEL: Record<string, string> = { new: "New", triaged: "Triaged", in_progress: "In progress", done: "Done", wontfix: "Won’t fix" };
const KIND_LABEL: Record<string, string> = { love: "Love", idea: "Idea", bug: "Bug", confusing: "Confusing" };
const ago = (t: string) => { const m = Math.floor((Date.now() - new Date(t).getTime()) / 60000); if (m < 60) return m + "m"; const h = Math.floor(m / 60); if (h < 24) return h + "h"; return Math.floor(h / 24) + "d"; };

export default function FeedbackBoard() {
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [items, setItems] = useState<FB[]>([]);
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<string>("open");

  const load = async () => {
    const { data } = await supabaseBrowser.from("feedback").select("id,route,kind,body,status,priority,author_name,author_role,restaurant_id,created_at").order("created_at", { ascending: false }).limit(200);
    setItems(data || []);
  };
  useEffect(() => { getMyProfile().then(setProfile); load().then(() => setReady(true)); }, []);

  const isAdmin = !!profile?.isAdmin;
  const setStatus = async (id: string, status: string) => {
    if (!isAdmin) return;
    setItems((xs) => xs.map((x) => x.id === id ? { ...x, status } : x));
    const patch: any = { status };
    if (status === "done" || status === "wontfix") { patch.resolved_by = profile!.id; patch.resolved_at = new Date().toISOString(); }
    if (status === "triaged") patch.triaged_by = profile!.id;
    try { await supabaseBrowser.from("feedback").update(patch).eq("id", id); } catch { load(); }
  };
  const setPriority = async (id: string, priority: string) => {
    if (!isAdmin) return;
    setItems((xs) => xs.map((x) => x.id === id ? { ...x, priority } : x));
    try { await supabaseBrowser.from("feedback").update({ priority }).eq("id", id); } catch { load(); }
  };

  if (!ready) return <main className="mx-auto max-w-2xl px-6 py-12"><p className="font-serif text-2xl text-ink">Opening the board…</p></main>;

  const open = items.filter((i) => i.status !== "done" && i.status !== "wontfix");
  const shown = filter === "open" ? open : filter === "all" ? items : items.filter((i) => i.status === filter);
  const counts = { open: open.length, bugs: open.filter((i) => i.kind === "bug").length, ideas: open.filter((i) => i.kind === "idea").length };

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/administrate" className="font-sans text-sm text-ink-soft">← administrate</Link>
      <p className="mt-5 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Feedback board</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">What the team is telling us</h1>
      <p className="mt-2 font-sans text-[14px] text-ink-soft">{counts.open} open · {counts.bugs} bugs · {counts.ideas} ideas. {isAdmin ? "Move a card to triage, start or close it." : "Owners and managers move cards; everyone can add notes from any screen."}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {["open", "new", "triaged", "in_progress", "done", "all"].map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={"rounded-full px-3 py-1 font-sans text-[12px] transition " + (filter === f ? "text-[#FBF8F2]" : "border border-black/15 text-ink-soft")} style={filter === f ? { background: "var(--accent)" } : undefined}>{f === "open" ? "Open" : f === "all" ? "All" : STATUS_LABEL[f]}</button>
        ))}
      </div>

      <ul className="mt-6 space-y-3">
        {shown.map((i) => (
          <li key={i.id} className="rounded-2xl border border-black/10 bg-card p-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color: i.kind === "bug" ? "#9A3122" : i.kind === "love" ? "#0E7C86" : "var(--accent)" }}>{KIND_LABEL[i.kind] || i.kind}{i.priority === "high" ? " · high" : ""}</span>
              <span className="font-mono text-[10px] text-clay">{i.route} · {ago(i.created_at)} ago</span>
            </div>
            <p className="mt-2 font-serif text-[16px] leading-relaxed text-ink">{i.body}</p>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">{i.author_name || "Someone"}{i.author_role ? " · " + i.author_role : ""} · {STATUS_LABEL[i.status]}</p>
            {isAdmin ? (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-black/10 pt-3">
                {STATUSES.map((st) => (
                  <button key={st} onClick={() => setStatus(i.id, st)} className={"rounded-full px-2.5 py-1 font-sans text-[11px] transition " + (i.status === st ? "text-[#FBF8F2]" : "border border-black/15 text-ink-soft hover:border-ink/40")} style={i.status === st ? { background: "var(--accent)" } : undefined}>{STATUS_LABEL[st]}</button>
                ))}
                <span className="mx-1 h-4 w-px bg-black/10" />
                <button onClick={() => setPriority(i.id, i.priority === "high" ? "normal" : "high")} className={"rounded-full px-2.5 py-1 font-sans text-[11px] transition " + (i.priority === "high" ? "bg-tomato text-[#FBF8F2]" : "border border-black/15 text-ink-soft")}>{i.priority === "high" ? "high" : "flag high"}</button>
              </div>
            ) : null}
          </li>
        ))}
        {!shown.length ? <li className="font-sans text-[14px] text-clay">Nothing here — notes land as the team uses the app.</li> : null}
      </ul>
    </main>
  );
}