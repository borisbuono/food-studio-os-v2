"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { ENTITY_ACCENT, ENTITY_LABEL, type EntityKey } from "@/lib/entities";

export const dynamic = "force-dynamic";

// Grow · Reach · Content calendar.
//
// Week view. Each column = a day. Cards are social_posts rows. Drag a draft
// onto a day to move its scheduled_at. Empty state guides Boris to "Add post"
// which opens the composer. Editorial identity — hairlines only, no shadows,
// per-entity accent stroke on the header + drop-target ring.

const ENTITY_CODE: Record<EntityKey, "IFL" | "BM" | "BBH"> = {
  utopia: "IFL", taller: "IFL", bistro_mondo: "BM", holdings: "BBH",
};

type Channel = "instagram" | "facebook" | "tiktok" | "threads";
const CHANNELS: Channel[] = ["instagram", "facebook", "tiktok", "threads"];
const CHANNEL_LABEL: Record<Channel, string> = {
  instagram: "IG", facebook: "FB", tiktok: "TikTok", threads: "Threads",
};

type Post = {
  id: string;
  entity_code: string;
  channel: Channel;
  title: string | null;
  body: string;
  media_urls: string[];
  scheduled_at: string | null;
  status: "draft" | "scheduled" | "published" | "failed";
  buffer_update_id: string | null;
  published_at: string | null;
  created_at: string;
};

function startOfWeek(d: Date): Date {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const wd = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - wd);
  return x;
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDay(d: Date): string { return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" }); }

export default function CalendarPage() {
  const [entity, setEntity] = useState<EntityKey>("utopia");
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [posts, setPosts] = useState<Post[]>([]);
  const [drafts, setDrafts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [composerOpen, setComposerOpen] = useState<null | { day?: string }>(null);
  const [live, setLive] = useState<boolean | null>(null);

  const ec = ENTITY_CODE[entity];
  const accent = ENTITY_ACCENT[entity];

  useEffect(() => {
    const e = (typeof window !== "undefined" ? localStorage.getItem("fs_entity") : null) as EntityKey | null;
    if (e) setEntity(e);
  }, []);

  useEffect(() => {
    // FS_SOCIAL_LIVE surfaces through a lightweight probe on the send route.
    // We just render a dry-run badge; no need to expose the env directly.
    let done = false;
    fetch("/api/grow/reach/social/live", { cache: "no-store" }).then((r) => r.json()).then((j) => {
      if (!done) setLive(Boolean(j?.live));
    }).catch(() => { if (!done) setLive(false); });
    return () => { done = true; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    const sb = supabaseBrowser;
    const weekEnd = addDays(weekStart, 7);
    const [scheduledRes, draftsRes] = await Promise.all([
      sb.from("social_posts")
        .select("*").eq("entity_code", ec)
        .gte("scheduled_at", weekStart.toISOString())
        .lt("scheduled_at", weekEnd.toISOString())
        .order("scheduled_at", { ascending: true }),
      sb.from("social_posts")
        .select("*").eq("entity_code", ec).eq("status", "draft").is("scheduled_at", null)
        .order("created_at", { ascending: false }).limit(20),
    ]);
    if (scheduledRes.error) setErr(scheduledRes.error.message);
    setPosts((scheduledRes.data || []) as Post[]);
    setDrafts((draftsRes.data || []) as Post[]);
    setLoading(false);
  }, [ec, weekStart]);

  useEffect(() => { load(); }, [load]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const byDay = useMemo(() => {
    const m: Record<string, Post[]> = {};
    for (const p of posts) {
      if (!p.scheduled_at) continue;
      const k = ymd(new Date(p.scheduled_at));
      (m[k] ||= []).push(p);
    }
    return m;
  }, [posts]);

  const onDropOnDay = async (day: Date, e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/post-id");
    if (!id) return;
    // Preserve time-of-day if the post already had a schedule, else default 09:00.
    const existing = [...posts, ...drafts].find((p) => p.id === id);
    let hh = 9, mm = 0;
    if (existing?.scheduled_at) {
      const d = new Date(existing.scheduled_at); hh = d.getHours(); mm = d.getMinutes();
    }
    const when = new Date(day); when.setHours(hh, mm, 0, 0);
    const { error } = await supabaseBrowser.from("social_posts")
      .update({ scheduled_at: when.toISOString(), status: existing?.status === "draft" ? "draft" : (existing?.status || "draft") })
      .eq("id", id);
    if (error) { setErr(error.message); return; }
    load();
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-12" style={{ ["--accent" as any]: accent }}>
      <Link href="/grow/reach" className="font-sans text-sm text-ink-soft">← Reach</Link>
      <div className="mt-6 flex items-baseline justify-between gap-6">
        <div>
          <p className="font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Grow · reach · calendar</p>
          <h1 className="mt-2 font-serif text-3xl text-ink">Content calendar</h1>
          <p className="mt-2 max-w-2xl lg:max-w-5xl font-sans text-[13px] leading-relaxed text-ink-soft">
            Plan the week for {ENTITY_LABEL[entity]}. Drag drafts onto days, schedule through Buffer when the plan is set.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${live ? "border-basil/40 bg-basil/10 text-basil" : "border-line bg-paper-deep text-muted"}`}>
            {live == null ? "…" : live ? "buffer live" : "dry-run"}
          </span>
          <button onClick={() => setComposerOpen({})} className="rounded-full border border-ink bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-paper">
            add post →
          </button>
        </div>
      </div>

      <div className="mt-8 flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="rounded-full border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft">← prev</button>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))} className="rounded-full border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft">today</button>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="rounded-full border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft">next →</button>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-wide text-muted">
          {fmtDay(days[0])} — {fmtDay(days[6])}
        </p>
      </div>

      {err ? (
        <p className="mt-3 rounded border border-tomato/40 bg-tomato/10 px-2 py-1 font-mono text-[10px] text-tomato">⚠ {err}</p>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-7">
        {days.map((d) => {
          const key = ymd(d);
          const items = byDay[key] || [];
          const isToday = ymd(new Date()) === key;
          return (
            <div
              key={key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDropOnDay(d, e)}
              className="min-h-[220px] rounded-lg border border-line bg-paper p-3 transition-colors hover:border-ink-soft"
              style={isToday ? { borderColor: "var(--accent)" } : undefined}
            >
              <div className="flex items-baseline justify-between">
                <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{fmtDay(d)}</p>
                <button
                  onClick={() => setComposerOpen({ day: key })}
                  className="font-mono text-[10px] uppercase tracking-wide text-ink-soft hover:text-ink"
                  title="Add a post on this day"
                >
                  +
                </button>
              </div>
              {items.length === 0 ? (
                <p className="mt-6 text-center font-sans text-[11px] italic text-muted">Nothing planned.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {items.map((p) => (
                    <PostCard key={p.id} post={p} />
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <section className="mt-10 border-t border-line pt-6">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">draft backlog</p>
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted">drag onto a day →</p>
        </div>
        {loading ? (
          <p className="mt-4 font-sans text-[13px] italic text-ink-soft">Loading…</p>
        ) : drafts.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-line bg-paper-deep p-6 text-center">
            <p className="font-sans text-[13px] italic text-ink-soft">No unscheduled drafts.</p>
            <p className="mt-2 font-sans text-[12px] text-ink-soft">
              Ask Chef to draft one — <em>"draft a post about tonight"</em> — or hit <em>Add post</em> above.
            </p>
          </div>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2">
            {drafts.map((p) => <PostCard key={p.id} post={p} compact />)}
          </ul>
        )}
      </section>

      {composerOpen ? (
        <Composer
          entity={ec}
          day={composerOpen.day}
          onClose={() => setComposerOpen(null)}
          onSaved={() => { setComposerOpen(null); load(); }}
        />
      ) : null}
    </main>
  );
}

function PostCard({ post, compact }: { post: Post; compact?: boolean }) {
  const label = CHANNEL_LABEL[post.channel] || post.channel;
  const time = post.scheduled_at ? new Date(post.scheduled_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <li
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/post-id", post.id)}
      className={`cursor-grab rounded border border-line bg-paper-deep p-2 hover:border-ink-soft ${compact ? "min-w-[180px] max-w-[240px]" : ""}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-[9px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>{label}</p>
        <p className="font-mono text-[9px] uppercase tracking-wide text-muted">{time || post.status}</p>
      </div>
      <p className="mt-1 line-clamp-2 font-serif text-[13px] text-ink">{post.title || post.body.slice(0, 60)}</p>
      {post.buffer_update_id ? (
        <p className="mt-1 font-mono text-[9px] text-muted">buffer · {post.buffer_update_id.slice(0, 8)}</p>
      ) : null}
    </li>
  );
}

function Composer({
  entity, day, onClose, onSaved,
}: { entity: "IFL" | "BM" | "BBH"; day?: string; onClose: () => void; onSaved: () => void }) {
  const [channels, setChannels] = useState<Channel[]>(["instagram"]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [media, setMedia] = useState("");
  const [when, setWhen] = useState<string>(() => {
    const base = day ? new Date(day + "T09:00:00") : new Date();
    if (!day) base.setHours(base.getHours() + 1, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}T${pad(base.getHours())}:${pad(base.getMinutes())}`;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const toggle = (c: Channel) => setChannels((cs) => cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]);

  const save = async (asScheduled: boolean) => {
    setBusy(true); setErr("");
    try {
      if (!body.trim()) throw new Error("Post body is required.");
      if (channels.length === 0) throw new Error("Pick at least one channel.");
      if (asScheduled && !when) throw new Error("Pick a schedule time.");

      const mediaArr = media.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
      const scheduled_at = when ? new Date(when).toISOString() : null;

      // One social_posts row per channel — Buffer schedules per profile.
      const rows = channels.map((ch) => ({
        entity_code: entity,
        channel: ch,
        title: title.trim() || null,
        body: body.trim(),
        media_urls: mediaArr,
        scheduled_at: asScheduled ? scheduled_at : null,
        status: asScheduled ? "scheduled" : "draft",
      }));
      const sb = supabaseBrowser;
      const { data: inserted, error } = await sb.from("social_posts").insert(rows).select("id,channel");
      if (error) throw error;

      if (asScheduled) {
        const resp = await fetch("/api/grow/reach/social/schedule", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entity, channels, caption: body.trim(),
            media_urls: mediaArr, scheduled_at,
            post_ids: (inserted || []).map((r: any) => r.id),
          }),
        });
        const j = await resp.json().catch(() => ({}));
        if (!resp.ok || !j?.ok) throw new Error(j?.error || `schedule failed (${resp.status})`);
      }
      onSaved();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-16" onClick={onClose}>
      <div className="w-full max-w-xl lg:max-w-4xl rounded-2xl border border-line bg-paper p-6" onClick={(e) => e.stopPropagation()}>
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">new post</p>
        <h2 className="mt-1 font-serif text-2xl text-ink">Compose</h2>

        <div className="mt-5">
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted">channels</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {CHANNELS.map((c) => (
              <button
                key={c}
                onClick={() => toggle(c)}
                className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wide ${channels.includes(c) ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:border-ink-soft"}`}
              >
                {CHANNEL_LABEL[c]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <label className="font-mono text-[10px] uppercase tracking-wide text-muted">title (internal)</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded border border-line bg-paper px-3 py-2 font-sans text-[13px] text-ink" placeholder="e.g. Tomato spotlight" />
        </div>
        <div className="mt-3">
          <label className="font-mono text-[10px] uppercase tracking-wide text-muted">body</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} className="mt-1 w-full rounded border border-line bg-paper px-3 py-2 font-sans text-[13px] text-ink" placeholder="What goes on the feed…" />
        </div>
        <div className="mt-3">
          <label className="font-mono text-[10px] uppercase tracking-wide text-muted">media URLs (one per line)</label>
          <textarea value={media} onChange={(e) => setMedia(e.target.value)} rows={2} className="mt-1 w-full rounded border border-line bg-paper px-3 py-2 font-mono text-[11px] text-ink" placeholder="https://…" />
        </div>
        <div className="mt-3">
          <label className="font-mono text-[10px] uppercase tracking-wide text-muted">schedule at</label>
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="mt-1 w-full rounded border border-line bg-paper px-3 py-2 font-sans text-[13px] text-ink" />
        </div>

        {err ? (
          <p className="mt-3 rounded border border-tomato/40 bg-tomato/10 px-2 py-1 font-mono text-[10px] text-tomato">⚠ {err}</p>
        ) : null}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="rounded-full border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft">
            cancel
          </button>
          <button onClick={() => save(false)} disabled={busy} className="rounded-full border border-ink px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:bg-ink hover:text-paper">
            save draft
          </button>
          <button onClick={() => save(true)} disabled={busy} className="rounded-full border border-ink bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-paper">
            {busy ? "…" : "schedule via buffer →"}
          </button>
        </div>
      </div>
    </div>
  );
}
