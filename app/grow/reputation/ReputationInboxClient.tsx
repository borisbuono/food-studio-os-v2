"use client";
import { useEffect, useMemo, useState } from "react";

type ReviewRow = {
  id: string;
  platform: string;
  external_id: string;
  reviewer_name: string | null;
  rating: number | null;
  title: string | null;
  body: string | null;
  language: string | null;
  posted_at: string;
  response_body: string | null;
  response_posted_at: string | null;
  sentiment: string | null;
  tags: string[] | null;
  url: string | null;
};

const PLATFORM_LABEL: Record<string, string> = {
  google_business: "Google",
  tripadvisor: "TripAdvisor",
  thefork: "TheFork",
  yelp: "Yelp",
};
const PLATFORM_COLOR: Record<string, string> = {
  google_business: "#4285F4",
  tripadvisor: "#00AA6C",
  thefork: "#3B7A57",
  yelp: "#D32323",
};

function stars(n: number | null) {
  if (n == null) return "—";
  const filled = Math.max(0, Math.min(5, n));
  return "★★★★★".slice(0, filled) + "☆☆☆☆☆".slice(0, 5 - filled);
}
function when(t: string) {
  const d = new Date(t);
  const m = Math.floor((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  const days = Math.floor(h / 24);
  if (days < 30) return days + "d";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}

export default function ReputationInboxClient({ reviews }: { reviews: ReviewRow[] }) {
  const [platform, setPlatform] = useState<string>("all");
  const [replyState, setReplyState] = useState<"all" | "unreplied" | "replied">("all");
  const [rating, setRating] = useState<number | "all">("all");
  const [selected, setSelected] = useState<ReviewRow | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string>("");

  // Chef FAB page context — feeds "draft a reply" prompts from the FAB itself
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as any).__fsChefContext = {
      route: "/grow/reputation",
      selected_review: selected ? {
        platform: PLATFORM_LABEL[selected.platform] || selected.platform,
        reviewer_name: selected.reviewer_name,
        rating: selected.rating,
        body: selected.body?.slice(0, 800),
        language: selected.language,
      } : null,
    };
    return () => { if (typeof window !== "undefined") (window as any).__fsChefContext = null; };
  }, [selected]);

  const filtered = useMemo(() => reviews.filter((r) => {
    if (platform !== "all" && r.platform !== platform) return false;
    if (replyState === "unreplied" && r.response_body) return false;
    if (replyState === "replied" && !r.response_body) return false;
    if (rating !== "all" && r.rating !== rating) return false;
    return true;
  }), [reviews, platform, replyState, rating]);

  const syncAll = async () => {
    setSyncing(true); setSyncMsg("");
    try {
      const r = await fetch("/api/grow/reputation/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      const d = await r.json();
      if (d.ok) {
        const pulled = Object.values(d.results || {}).reduce((s: number, x: any) => s + (x?.pulled || 0), 0);
        setSyncMsg(`✓ synced ${pulled} reviews — refresh to see them`);
      } else setSyncMsg("⚠ " + (d.error || "sync failed"));
    } catch (e: any) {
      setSyncMsg("⚠ " + (e?.message || "sync failed"));
    }
    setSyncing(false);
  };

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Stream</p>
        <div className="flex items-center gap-2">
          {syncMsg ? <span className="font-mono text-[10px] text-muted">{syncMsg}</span> : null}
          <button onClick={syncAll} disabled={syncing} className="rounded-full border border-ink bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-paper disabled:opacity-40">
            {syncing ? "syncing…" : "sync all now ↻"}
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Chip active={platform === "all"} onClick={() => setPlatform("all")}>All platforms</Chip>
        <Chip active={platform === "google_business"} onClick={() => setPlatform("google_business")}>Google</Chip>
        <Chip active={platform === "tripadvisor"} onClick={() => setPlatform("tripadvisor")}>TripAdvisor</Chip>
        <Chip active={platform === "thefork"} onClick={() => setPlatform("thefork")}>TheFork</Chip>
        <span className="mx-2 h-4 w-px bg-line" />
        <Chip active={replyState === "unreplied"} onClick={() => setReplyState(replyState === "unreplied" ? "all" : "unreplied")}>Unreplied</Chip>
        <Chip active={replyState === "replied"} onClick={() => setReplyState(replyState === "replied" ? "all" : "replied")}>Replied</Chip>
        <span className="mx-2 h-4 w-px bg-line" />
        {[1, 2, 3, 4, 5].map((n) => (
          <Chip key={n} active={rating === n} onClick={() => setRating(rating === n ? "all" : n)}>{n}★</Chip>
        ))}
      </div>

      {/* Reviews stream */}
      <div className="mt-6 space-y-3">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line bg-paper-deep/40 p-6 text-center">
            <p className="font-serif italic text-[14px] text-ink-soft">
              {reviews.length === 0
                ? "No reviews yet. Once you connect Google Business / TripAdvisor / TheFork, they'll appear here."
                : "No reviews match those filters."}
            </p>
          </div>
        ) : filtered.map((r) => (
          <button key={r.id} onClick={() => setSelected(r)} className="block w-full rounded-xl border border-line bg-paper p-4 text-left hover:border-ink-soft">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="inline-block rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-paper" style={{ backgroundColor: PLATFORM_COLOR[r.platform] || "#9C9282" }}>
                  {PLATFORM_LABEL[r.platform] || r.platform}
                </span>
                <span className="font-mono text-[12px] text-clay">{stars(r.rating)}</span>
                <span className="font-serif text-[14px] text-ink">{r.reviewer_name || "Anonymous"}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-muted">{when(r.posted_at)}</span>
                {r.response_body ? (
                  <span className="inline-block rounded-full border border-basil/40 bg-basil/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-basil">Replied</span>
                ) : (
                  <span className="inline-block rounded-full border border-tomato/40 bg-tomato/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-tomato">Awaiting reply</span>
                )}
              </div>
            </div>
            {r.title ? <p className="mt-2 font-serif text-[15px] text-ink">{r.title}</p> : null}
            <p className="mt-1 font-serif text-[14px] leading-relaxed text-ink-soft line-clamp-3">{r.body}</p>
          </button>
        ))}
      </div>

      {selected ? <ReviewDrawer review={selected} onClose={() => setSelected(null)} /> : null}
    </section>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wide ${active ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:border-ink-soft"}`}>
      {children}
    </button>
  );
}

function ReviewDrawer({ review, onClose }: { review: ReviewRow; onClose: () => void }) {
  const [reply, setReply] = useState(review.response_body || "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [drafting, setDrafting] = useState(false);
  const replied = !!review.response_body;

  const draftWithChef = async () => {
    setDrafting(true); setMsg("");
    try {
      const chefPrompt = `Draft a warm, professional reply to this ${PLATFORM_LABEL[review.platform] || review.platform} review. Match the guest's language. Keep it 2-3 sentences. Reviewer: ${review.reviewer_name || "guest"}. Rating: ${review.rating || "n/a"}/5. Review: "${(review.body || "").slice(0, 800)}"`;
      const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        message: chefPrompt,
        route: "/grow/reputation",
        language: review.language || "en",
        page_context: { intent: "draft_reply", platform: review.platform, rating: review.rating, reviewer_name: review.reviewer_name, review_body: (review.body || "").slice(0, 800) },
      })});
      const d = await r.json();
      // Strip any <chef>{...}</chef> tail — page.tsx already does but be defensive
      const clean = (d.reply || "").replace(/<chef>[\s\S]*?<\/chef>/g, "").trim();
      if (clean) setReply(clean);
      else setMsg("⚠ Chef didn't return a draft — try again.");
    } catch (e: any) {
      setMsg("⚠ " + (e?.message || "draft failed"));
    }
    setDrafting(false);
  };

  const postReply = async () => {
    if (!reply.trim()) return;
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/grow/reputation/reply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ review_id: review.id, body: reply.trim() }) });
      const d = await r.json();
      if (d.ok) { setMsg(d.dryRun ? "✓ posted (dry-run — see server log)" : "✓ posted"); }
      else setMsg("⚠ " + (d.error || "post failed"));
    } catch (e: any) {
      setMsg("⚠ " + (e?.message || "post failed"));
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center sm:justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-paper p-6 sm:max-w-2xl sm:rounded-2xl">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{PLATFORM_LABEL[review.platform] || review.platform} · {new Date(review.posted_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</p>
            <h2 className="mt-1 font-serif text-[22px] text-ink">{review.reviewer_name || "Anonymous"} <span className="ml-2 font-mono text-[13px] text-clay">{stars(review.rating)}</span></h2>
          </div>
          <button onClick={onClose} className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft">close ✕</button>
        </div>

        {review.title ? <p className="mt-4 font-serif text-[17px] text-ink">{review.title}</p> : null}
        <p className="mt-2 whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-ink-soft">{review.body}</p>

        {review.sentiment || (review.tags && review.tags.length) ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {review.sentiment ? <span className="rounded-full border border-line bg-paper-deep px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink">{review.sentiment}</span> : null}
            {(review.tags || []).map((t) => <span key={t} className="rounded-full border border-line bg-paper-deep px-2 py-0.5 font-mono text-[10px] text-muted">{t}</span>)}
          </div>
        ) : null}

        {review.url ? <p className="mt-3 font-mono text-[10px]"><a href={review.url} target="_blank" rel="noreferrer" className="text-clay underline">Open on {PLATFORM_LABEL[review.platform] || review.platform} ↗</a></p> : null}

        <div className="mt-6 border-t border-line pt-4">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{replied ? "Reply" : "Draft reply"}</p>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Write a reply — or ask Chef to draft one for you"
            rows={5}
            className="mt-2 w-full rounded-lg border border-line bg-paper px-3 py-2 font-serif text-[14px] leading-relaxed text-ink placeholder:text-muted focus:border-ink-soft focus:outline-none"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={draftWithChef} disabled={drafting} className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft disabled:opacity-40">
              {drafting ? "chef drafting…" : "draft with Chef ✧"}
            </button>
            <button onClick={postReply} disabled={busy || !reply.trim()} className="rounded-full border border-ink bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-paper disabled:opacity-40">
              {busy ? "posting…" : replied ? "update reply →" : "post reply →"}
            </button>
            {msg ? <span className="font-mono text-[10px] text-ink">{msg}</span> : null}
          </div>
          {review.response_posted_at ? <p className="mt-2 font-mono text-[10px] text-muted">Original reply posted {new Date(review.response_posted_at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p> : null}
        </div>
      </div>
    </div>
  );
}
