"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { ENTITY_ACCENT, ENTITY_LABEL, type EntityKey, E_BM, E_TALLER, E_HOLDINGS } from "@/lib/entities";
export const dynamic = "force-dynamic";

// Grow · Reach · posting calendar (Meta stack).
//
// v1 shipped 2026-09-20. Rewritten off the Buffer-era shell onto the Meta
// pipeline: rows on social_posts, approval tick per row, meta-publish edge
// function reads approved_by_boris and refuses otherwise. The composer's
// Buffer schedule route is preserved for the row-write path; publishing is
// now Meta, not Buffer.
//
// Ibiza time throughout the UI — scheduled_at is timestamptz (UTC at rest),
// displayed in Europe/Madrid on every render. Approval is one click, 5s undo.

const ENTITY_CODE: Record<EntityKey, "IFL" | "BM" | "BBH"> = {
  [E_TALLER]: "IFL", [E_BM]: "BM", [E_HOLDINGS]: "BBH",
};
const ENTITY_SHORT_CODE: Record<EntityKey, "IFS" | "BM" | "BBH"> = {
  [E_TALLER]: "IFS", [E_BM]: "BM", [E_HOLDINGS]: "BBH",
};

type Channel = "instagram" | "facebook" | "tiktok" | "threads";
const CHANNELS: Channel[] = ["instagram", "facebook", "tiktok", "threads"];
const CHANNEL_LABEL: Record<Channel, string> = {
  instagram: "IG", facebook: "FB", tiktok: "TT", threads: "TH",
};

type MediaType = "IMAGE" | "CAROUSEL" | "REELS" | "STORIES";
type Status = "draft" | "scheduled" | "publishing" | "published" | "failed";

type Post = {
  id: string;
  entity_code: string;
  channel: Channel;
  title: string | null;
  body: string;
  media_urls: string[];
  scheduled_at: string | null;
  status: Status;
  buffer_update_id: string | null;
  remote_id: string | null;
  permalink: string | null;
  error: string | null;
  media_type: MediaType | null;
  first_comment: string | null;
  approved_by_boris: boolean;
  approved_by_user: string | null;
  approved_at: string | null;
  published_at: string | null;
  created_at: string;
};

// --- Ibiza-time helpers ---------------------------------------------------
// Everything the user sees is Europe/Madrid. Storage stays UTC.
const TZ = "Europe/Madrid";
function madridParts(iso: string): { y: string; m: string; d: string; hh: string; mm: string } {
  const dtf = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { y: parts.year, m: parts.month, d: parts.day, hh: parts.hour, mm: parts.minute };
}
function ymdMadrid(iso: string): string {
  const p = madridParts(iso); return `${p.y}-${p.m}-${p.d}`;
}
function hhmmMadrid(iso: string): string {
  const p = madridParts(iso); return `${p.hh}:${p.mm}`;
}
function ymdMadridFromDate(d: Date): string { return ymdMadrid(d.toISOString()); }
function fmtDayLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", { timeZone: TZ, weekday: "short", day: "2-digit", month: "short" });
}
// Convert Y-M-D + HH:mm (interpreted in Madrid) to UTC ISO. Handles DST via
// two-step calibration: build a Date at UTC, ask "what wall time does this
// print in Madrid?", correct by the delta, retry once.
function madridLocalToUtcIso(y: number, m: number, d: number, hh: number, mm: number): string {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const printed = madridParts(guess.toISOString());
  const drift =
    (Number(printed.hh) - hh) * 60 +
    (Number(printed.mm) - mm) +
    (Number(printed.d) - d) * 24 * 60;
  const corrected = new Date(guess.getTime() - drift * 60_000);
  return corrected.toISOString();
}
// Week starts Monday, in Madrid time.
function startOfMadridWeek(d: Date): Date {
  const p = madridParts(d.toISOString());
  const y = Number(p.y), m = Number(p.m), day = Number(p.d);
  // Find weekday via Intl (Mon=1..Sun=7 in en-GB).
  const wdName = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" }).format(new Date(madridLocalToUtcIso(y, m, day, 0, 0)));
  const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wdName);
  const mondayOffset = (idx + 6) % 7;
  const utcMonday = new Date(madridLocalToUtcIso(y, m, day - mondayOffset, 0, 0));
  return utcMonday;
}
function addDaysMadrid(d: Date, n: number): Date {
  const p = madridParts(d.toISOString());
  return new Date(madridLocalToUtcIso(Number(p.y), Number(p.m), Number(p.d) + n, 0, 0));
}

// --- Status pill ----------------------------------------------------------
const STATUS_PILL: Record<Status, { bg: string; fg: string; border: string; label: string }> = {
  draft:       { bg: "bg-paper-deep", fg: "text-clay",   border: "border-line",       label: "draft" },
  scheduled:   { bg: "bg-paper-deep", fg: "text-ink",    border: "border-line",       label: "scheduled" },
  publishing:  { bg: "bg-amber/15",   fg: "text-ochre",  border: "border-amber/40",   label: "publishing" },
  published:   { bg: "bg-basil/10",   fg: "text-basil",  border: "border-basil/40",   label: "published" },
  failed:      { bg: "bg-tomato/10",  fg: "text-tomato", border: "border-tomato/40",  label: "failed" },
};

export default function CalendarPage() {
  const [entity, setEntity] = useState<EntityKey>(E_BM);
  const [weekStart, setWeekStart] = useState<Date>(() => startOfMadridWeek(new Date()));
  const [posts, setPosts] = useState<Post[]>([]);
  const [drafts, setDrafts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [composerOpen, setComposerOpen] = useState<null | { day?: string }>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [urlHealth, setUrlHealth] = useState<Record<string, { all_ok: boolean; checked_at: number }>>({});
  const [undo, setUndo] = useState<null | { post_id: string; prev: boolean; deadline: number }>(null);

  const ec = ENTITY_CODE[entity];
  const accent = ENTITY_ACCENT[entity];

  useEffect(() => {
    const e = (typeof window !== "undefined" ? localStorage.getItem("fs_entity") : null) as EntityKey | null;
    if (e) setEntity(e);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    const sb = supabaseBrowser;
    // Query window is a UTC range covering the Madrid week — use the same
    // helpers so the boundary is correct in both DST directions.
    const weekEnd = addDaysMadrid(weekStart, 7);
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

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysMadrid(weekStart, i)), [weekStart]);
  const byDay = useMemo(() => {
    const m: Record<string, Post[]> = {};
    for (const p of posts) {
      if (!p.scheduled_at) continue;
      const k = ymdMadrid(p.scheduled_at);
      (m[k] ||= []).push(p);
    }
    // Time-sort within each day.
    for (const k of Object.keys(m)) m[k].sort((a, b) => (a.scheduled_at! < b.scheduled_at! ? -1 : 1));
    return m;
  }, [posts]);

  // Fire URL checks for the currently visible posts once per week change.
  const checkedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const visible = posts.filter((p) => p.media_urls?.length && !checkedRef.current.has(p.id));
    if (!visible.length) return;
    // Fire and forget; the response updates urlHealth incrementally.
    (async () => {
      for (const p of visible) {
        checkedRef.current.add(p.id);
        try {
          const r = await fetch("/api/social/check-urls", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ post_id: p.id }),
          });
          const j = await r.json().catch(() => ({}));
          if (j?.ok) {
            setUrlHealth((h) => ({ ...h, [p.id]: { all_ok: Boolean(j.all_ok), checked_at: Date.now() } }));
          }
        } catch { /* soft-fail — the badge just doesn't show */ }
      }
    })();
  }, [posts]);

  const onDropOnDay = async (day: Date, e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/post-id");
    if (!id) return;
    const existing = [...posts, ...drafts].find((p) => p.id === id);
    let hh = 9, mm = 0;
    if (existing?.scheduled_at) {
      const t = madridParts(existing.scheduled_at);
      hh = Number(t.hh); mm = Number(t.mm);
    }
    const p = madridParts(day.toISOString());
    const whenIso = madridLocalToUtcIso(Number(p.y), Number(p.m), Number(p.d), hh, mm);
    const { error } = await supabaseBrowser.from("social_posts")
      .update({ scheduled_at: whenIso, status: existing?.status === "draft" ? "draft" : (existing?.status || "draft") })
      .eq("id", id);
    if (error) { setErr(error.message); return; }
    load();
  };

  const setApproval = async (post_id: string, approved: boolean, prev: boolean) => {
    // Optimistic — flip in memory first.
    setPosts((ps) => ps.map((p) => (p.id === post_id ? { ...p, approved_by_boris: approved } : p)));
    setDrafts((ps) => ps.map((p) => (p.id === post_id ? { ...p, approved_by_boris: approved } : p)));
    setUndo({ post_id, prev, deadline: Date.now() + 5000 });
    try {
      const r = await fetch("/api/social/approve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post_id, approved }),
      });
      const j = await r.json();
      if (!r.ok || !j?.ok) {
        // Roll back.
        setPosts((ps) => ps.map((p) => (p.id === post_id ? { ...p, approved_by_boris: prev } : p)));
        setDrafts((ps) => ps.map((p) => (p.id === post_id ? { ...p, approved_by_boris: prev } : p)));
        setErr(j?.error || `approve failed (${r.status})`);
        setUndo(null);
      }
    } catch (e: any) {
      setPosts((ps) => ps.map((p) => (p.id === post_id ? { ...p, approved_by_boris: prev } : p)));
      setErr(e?.message || "approve failed");
      setUndo(null);
    }
  };

  // Auto-dismiss undo toast.
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), Math.max(0, undo.deadline - Date.now()));
    return () => clearTimeout(t);
  }, [undo]);

  const drawerPost = drawerId ? [...posts, ...drafts].find((p) => p.id === drawerId) : null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-12" style={{ ["--accent" as any]: accent }}>
      <Link href="/grow/reach" className="font-sans text-sm text-ink-soft">← Reach</Link>
      <div className="mt-6 flex items-baseline justify-between gap-6">
        <div>
          <p className="font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Grow · reach · calendar</p>
          <h1 className="mt-2 font-serif text-3xl text-ink">Posting calendar</h1>
          <p className="mt-2 max-w-2xl lg:max-w-5xl font-sans text-[13px] leading-relaxed text-ink-soft">
            Plan the week for {ENTITY_LABEL[entity]}. Times shown in Ibiza. Tick a card to approve for publishing — the Meta pipeline refuses to send anything unapproved.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="inline-block rounded-full border border-line bg-paper-deep px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink-soft">
            meta · v4
          </span>
          <button onClick={() => setComposerOpen({})} className="rounded-full border border-ink bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-paper">
            add post →
          </button>
        </div>
      </div>

      <div className="mt-8 flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <button onClick={() => setWeekStart(addDaysMadrid(weekStart, -7))} className="rounded-full border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft">← prev</button>
          <button onClick={() => setWeekStart(startOfMadridWeek(new Date()))} className="rounded-full border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft">today</button>
          <button onClick={() => setWeekStart(addDaysMadrid(weekStart, 7))} className="rounded-full border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft">next →</button>
        </div>
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
          {fmtDayLabel(days[0])} — {fmtDayLabel(days[6])} · Europe/Madrid
        </p>
      </div>

      {err ? (
        <p className="mt-3 rounded border border-tomato/40 bg-tomato/10 px-2 py-1 font-mono text-[10px] text-tomato">⚠ {err}</p>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-7">
        {days.map((d) => {
          const key = ymdMadridFromDate(d);
          const items = byDay[key] || [];
          const isToday = ymdMadrid(new Date().toISOString()) === key;
          return (
            <div
              key={key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDropOnDay(d, e)}
              className="min-h-[220px] rounded-lg border border-line bg-paper p-3 transition-colors hover:border-ink-soft"
              style={isToday ? { borderColor: "var(--accent)" } : undefined}
            >
              <div className="flex items-baseline justify-between">
                <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{fmtDayLabel(d)}</p>
                <button
                  onClick={() => setComposerOpen({ day: key })}
                  className="font-mono text-[10px] uppercase tracking-wide text-ink-soft hover:text-ink"
                  title="Add a post on this day"
                >
                  +
                </button>
              </div>
              {items.length === 0 ? (
                <p className="mt-6 text-center font-sans text-[11px] italic text-clay">Nothing planned.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {items.map((p) => (
                    <PostCard
                      key={p.id}
                      post={p}
                      entityShort={ENTITY_SHORT_CODE[entity]}
                      urlOk={urlHealth[p.id]?.all_ok}
                      onOpen={() => setDrawerId(p.id)}
                      onApprove={(next) => setApproval(p.id, next, p.approved_by_boris)}
                    />
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
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">drag onto a day →</p>
        </div>
        {loading ? (
          <p className="mt-4 font-sans text-[13px] italic text-ink-soft">Loading…</p>
        ) : drafts.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-line bg-paper-deep p-6 text-center">
            <p className="font-sans text-[13px] italic text-ink-soft">No unscheduled drafts.</p>
          </div>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2">
            {drafts.map((p) => (
              <PostCard
                key={p.id}
                post={p}
                entityShort={ENTITY_SHORT_CODE[entity]}
                urlOk={urlHealth[p.id]?.all_ok}
                onOpen={() => setDrawerId(p.id)}
                onApprove={(next) => setApproval(p.id, next, p.approved_by_boris)}
                compact
              />
            ))}
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

      {drawerPost ? (
        <Drawer
          post={drawerPost}
          urlHealth={urlHealth[drawerPost.id]}
          onClose={() => setDrawerId(null)}
        />
      ) : null}

      {undo ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-ink bg-ink px-4 py-2 font-mono text-[11px] text-paper shadow-lg">
          approval updated · <button className="underline" onClick={() => { setApproval(undo.post_id, undo.prev, !undo.prev); setUndo(null); }}>undo</button>
        </div>
      ) : null}
    </main>
  );
}

// --- Card ----------------------------------------------------------------
function PostCard({
  post, entityShort, urlOk, onOpen, onApprove, compact,
}: {
  post: Post;
  entityShort: string;
  urlOk: boolean | undefined;
  onOpen: () => void;
  onApprove: (next: boolean) => void;
  compact?: boolean;
}) {
  const time = post.scheduled_at ? hhmmMadrid(post.scheduled_at) : null;
  const pill = STATUS_PILL[post.status];
  const mtype = (post.media_type || "IMAGE") as MediaType;
  const isStory = mtype === "STORIES";
  const thumb = post.media_urls?.[0];

  return (
    <li
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/post-id", post.id)}
      className={`group cursor-pointer rounded border bg-paper-deep p-2 hover:border-ink-soft ${compact ? "min-w-[180px] max-w-[240px]" : ""} ${isStory ? "border-dashed border-ochre/60" : "border-line"}`}
      onClick={onOpen}
    >
      <div className="flex items-start gap-2">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="h-12 w-12 flex-shrink-0 rounded object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }} />
        ) : (
          <div className="h-12 w-12 flex-shrink-0 rounded border border-line bg-paper" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-[9px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>{entityShort}</span>
              <span className="font-mono text-[9px] uppercase tracking-wide text-clay">·</span>
              <span className="font-mono text-[9px] uppercase tracking-wide text-ink-soft">{CHANNEL_LABEL[post.channel] || post.channel}</span>
              {urlOk === false ? (
                <span className="ml-1 font-mono text-[10px] text-tomato" title="One or more media URLs failed">⚠</span>
              ) : null}
            </div>
            <span className="font-mono text-[9px] uppercase tracking-wide text-ink">{time || "—"}</span>
          </div>
          <p className="mt-1 line-clamp-2 font-serif text-[12px] text-ink">{post.title || post.body.slice(0, 60)}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className={`rounded px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wide ${pill.bg} ${pill.fg} border ${pill.border}`}>{pill.label}</span>
            <span className="rounded border border-line bg-paper px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wide text-ink-soft">{mtype}</span>
            {post.permalink ? (
              <a
                href={post.permalink}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="rounded border border-basil/40 bg-basil/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wide text-basil"
              >
                view →
              </a>
            ) : null}
          </div>
        </div>
        {/* Approval tick — one click. */}
        <button
          onClick={(e) => { e.stopPropagation(); onApprove(!post.approved_by_boris); }}
          disabled={post.status === "published"}
          title={post.approved_by_boris ? "Approved — click to withdraw" : "Tick to approve"}
          className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded border font-mono text-[12px] leading-none disabled:opacity-40 ${
            post.approved_by_boris
              ? "border-basil bg-basil text-paper"
              : "border-line bg-paper text-clay hover:border-ink"
          }`}
        >
          {post.approved_by_boris ? "✓" : ""}
        </button>
      </div>
    </li>
  );
}

// --- Drawer --------------------------------------------------------------
function Drawer({
  post, urlHealth, onClose,
}: {
  post: Post;
  urlHealth: { all_ok: boolean; checked_at: number } | undefined;
  onClose: () => void;
}) {
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [perUrl, setPerUrl] = useState<{ url: string; ok: boolean; status: number | null; error?: string }[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/social/check-urls", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post_id: post.id }),
    }).then((r) => r.json()).then((j) => {
      if (!cancelled && j?.ok) setPerUrl(j.urls || []);
    }).catch(() => { /* soft-fail */ });
    return () => { cancelled = true; };
  }, [post.id]);

  const media = post.media_urls || [];
  const current = media[carouselIdx];
  const scheduledMadrid = post.scheduled_at ? `${ymdMadrid(post.scheduled_at)} ${hhmmMadrid(post.scheduled_at)}` : null;
  const pill = STATUS_PILL[post.status];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-ink/40" onClick={onClose}>
      <div className="h-full w-full max-w-lg overflow-y-auto border-l border-line bg-paper p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{post.entity_code} · {post.channel} · {post.media_type || "IMAGE"}</p>
          <button onClick={onClose} className="font-mono text-[10px] uppercase tracking-wide text-ink-soft hover:text-ink">close ✕</button>
        </div>
        <h2 className="mt-1 font-serif text-2xl text-ink">{post.title || "Untitled post"}</h2>

        {media.length > 0 ? (
          <div className="mt-4">
            <div className="relative rounded border border-line bg-paper-deep">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={current} alt="" className="max-h-[420px] w-full rounded object-contain" />
              {media.length > 1 ? (
                <>
                  <button
                    onClick={() => setCarouselIdx((i) => (i - 1 + media.length) % media.length)}
                    className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full border border-line bg-paper px-2 py-1 font-mono text-[10px] text-ink"
                  >‹</button>
                  <button
                    onClick={() => setCarouselIdx((i) => (i + 1) % media.length)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full border border-line bg-paper px-2 py-1 font-mono text-[10px] text-ink"
                  >›</button>
                  <p className="absolute bottom-1 left-1/2 -translate-x-1/2 rounded bg-ink/70 px-1.5 py-0.5 font-mono text-[9px] text-paper">
                    {carouselIdx + 1} / {media.length}
                  </p>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        <section className="mt-5">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">body · en</p>
          <p className="mt-1 whitespace-pre-wrap font-serif text-[14px] text-ink">{post.body}</p>
        </section>

        {post.first_comment ? (
          <section className="mt-4">
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">first comment · es</p>
            <p className="mt-1 whitespace-pre-wrap font-sans text-[13px] text-ink-soft">{post.first_comment}</p>
          </section>
        ) : null}

        <section className="mt-4 flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${pill.bg} ${pill.fg} border ${pill.border}`}>{pill.label}</span>
          {post.approved_by_boris ? (
            <span className="rounded border border-basil/40 bg-basil/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-basil">approved</span>
          ) : (
            <span className="rounded border border-line bg-paper-deep px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-clay">not approved</span>
          )}
        </section>

        <section className="mt-4 space-y-1 font-mono text-[11px] text-ink-soft">
          {scheduledMadrid ? (
            <p>scheduled · <span className="text-ink">{scheduledMadrid}</span> Madrid · <span className="text-clay">{post.scheduled_at}</span> UTC</p>
          ) : (
            <p>scheduled · <span className="text-clay">not scheduled</span></p>
          )}
          {post.approved_at ? (
            <p>approved · <span className="text-ink">{ymdMadrid(post.approved_at)} {hhmmMadrid(post.approved_at)}</span> Madrid</p>
          ) : null}
          {post.published_at ? (
            <p>published · <span className="text-ink">{ymdMadrid(post.published_at)} {hhmmMadrid(post.published_at)}</span> Madrid</p>
          ) : null}
          {post.permalink ? (
            <p>permalink · <a href={post.permalink} target="_blank" rel="noreferrer" className="text-basil underline">{post.permalink}</a></p>
          ) : null}
        </section>

        {post.error ? (
          <section className="mt-4">
            <p className="font-mono text-[10px] uppercase tracking-wide text-tomato">error · verbatim</p>
            <pre className="mt-1 overflow-x-auto whitespace-pre rounded border border-tomato/40 bg-tomato/10 p-2 font-mono text-[11px] text-tomato">{post.error}</pre>
          </section>
        ) : null}

        {media.length > 0 ? (
          <section className="mt-4">
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">media urls · health</p>
            <ul className="mt-1 space-y-1">
              {media.map((u, i) => {
                const h = perUrl?.[i];
                const dot = !h ? "bg-clay" : h.ok ? "bg-basil" : "bg-tomato";
                return (
                  <li key={i} className="flex items-center gap-2 font-mono text-[10px]">
                    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dot}`} title={h ? (h.ok ? `${h.status} OK` : (h.error || String(h.status))) : "checking…"} />
                    <a href={u} target="_blank" rel="noreferrer" className="truncate text-ink-soft hover:text-ink">{u}</a>
                  </li>
                );
              })}
            </ul>
            {urlHealth && !urlHealth.all_ok ? (
              <p className="mt-2 font-mono text-[10px] text-tomato">⚠ One or more URLs failed. Meta fetches these itself — fix before approving.</p>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

// --- Composer ------------------------------------------------------------
function Composer({
  entity, day, onClose, onSaved,
}: { entity: "IFL" | "BM" | "BBH"; day?: string; onClose: () => void; onSaved: () => void }) {
  const [channels, setChannels] = useState<Channel[]>(["instagram"]);
  const [mediaType, setMediaType] = useState<MediaType>("IMAGE");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [firstComment, setFirstComment] = useState("");
  const [media, setMedia] = useState("");
  const [when, setWhen] = useState<string>(() => {
    // datetime-local input speaks the browser's local timezone. We DISPLAY it
    // as Madrid time so the user picks Ibiza-clock; on save we convert to
    // UTC via madridLocalToUtcIso.
    const base = day ? new Date(day + "T09:00:00Z") : new Date();
    const p = madridParts((day ? new Date(day + "T09:00:00Z") : base).toISOString());
    if (day) {
      return `${p.y}-${p.m}-${p.d}T09:00`;
    }
    // one hour from now, in Madrid
    const nowP = madridParts(new Date(Date.now() + 60 * 60 * 1000).toISOString());
    return `${nowP.y}-${nowP.m}-${nowP.d}T${nowP.hh}:00`;
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
      // when = "YYYY-MM-DDTHH:mm" — interpret as Madrid clock, convert to UTC.
      const [datePart, timePart] = when.split("T");
      const [y, m, d] = datePart.split("-").map(Number);
      const [hh, mm] = timePart.split(":").map(Number);
      const scheduled_at = asScheduled ? madridLocalToUtcIso(y, m, d, hh, mm) : null;

      // One social_posts row per channel.
      const rows = channels.map((ch) => ({
        entity_code: entity,
        channel: ch,
        title: title.trim() || null,
        body: body.trim(),
        first_comment: firstComment.trim() || null,
        media_type: mediaType,
        media_urls: mediaArr,
        scheduled_at,
        status: asScheduled ? "scheduled" : "draft",
        approved_by_boris: false,
      }));
      const sb = supabaseBrowser;
      const { data: inserted, error } = await sb.from("social_posts").insert(rows).select("id,channel");
      if (error) throw error;

      // Row-write only. Meta-publish is invoked by an external scheduler once
      // approved_by_boris flips true. Composer no longer talks to Buffer.
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
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">channels</p>
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
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">media type</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {(["IMAGE", "CAROUSEL", "REELS", "STORIES"] as MediaType[]).map((t) => (
              <button
                key={t}
                onClick={() => setMediaType(t)}
                className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wide ${mediaType === t ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:border-ink-soft"}`}
              >
                {t.toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <label className="font-mono text-[10px] uppercase tracking-wide text-clay">title (internal)</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded border border-line bg-paper px-3 py-2 font-sans text-[13px] text-ink" placeholder="e.g. Tomato spotlight" />
        </div>
        <div className="mt-3">
          <label className="font-mono text-[10px] uppercase tracking-wide text-clay">body · en</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} className="mt-1 w-full rounded border border-line bg-paper px-3 py-2 font-sans text-[13px] text-ink" placeholder="What goes on the feed…" />
        </div>
        <div className="mt-3">
          <label className="font-mono text-[10px] uppercase tracking-wide text-clay">first comment · es (IG only)</label>
          <textarea value={firstComment} onChange={(e) => setFirstComment(e.target.value)} rows={3} className="mt-1 w-full rounded border border-line bg-paper px-3 py-2 font-sans text-[13px] text-ink" placeholder="Traducción al castellano…" />
        </div>
        <div className="mt-3">
          <label className="font-mono text-[10px] uppercase tracking-wide text-clay">media URLs (one per line)</label>
          <textarea value={media} onChange={(e) => setMedia(e.target.value)} rows={2} className="mt-1 w-full rounded border border-line bg-paper px-3 py-2 font-mono text-[11px] text-ink" placeholder="https://…" />
        </div>
        <div className="mt-3">
          <label className="font-mono text-[10px] uppercase tracking-wide text-clay">schedule at · Ibiza clock</label>
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
            {busy ? "…" : "schedule →"}
          </button>
        </div>
      </div>
    </div>
  );
}
