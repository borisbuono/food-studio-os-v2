"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// InboxList — the one list. Phone-first: each row is a card with the person,
// what they wrote, the post it sits on, a suggested reply you can edit in
// place, and ONE big Send button. No confirm dialogs: ten rows = ten taps.
//
// Send = POST /api/inbox/act {approve} → writes approved_by_boris → meta-reply.
// Skip / Hide / Redraft are the small buttons underneath.

export type EmailMeta = {
  category: string | null; confidence: number | null; enquiry_fields: Record<string, unknown> | null; needs_you_due: string | null;
  hours_to_answer: number | null; outcome: string | null; message_count: number; first_received_at: string | null;
};
export type InboxItem = {
  kind: "comment" | "dm" | "email";
  id: string;
  account_id: string;
  platform: "instagram" | "facebook" | "email";
  account_handle: string | null;
  who: string;
  text: string;
  lang: string | null;
  at: string | null;
  status: string;
  flagged: boolean;
  flag_reason: string | null;
  draft: string;
  draft_lang: string | null;
  replied_at: string | null;
  error: string | null;
  media: { permalink: string | null; thumb: string | null; caption: string | null } | null;
  is_reply: boolean;
  history: Array<{ dir: "in" | "out"; text: string; at: string }> | null;
  window_from?: string | null;
  email?: EmailMeta;
};
const EMAIL_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "enquiry", label: "Enquiry" }, { key: "booking_change", label: "Booking change" }, { key: "supplier_doc", label: "Supplier document" },
  { key: "fiscal_legal", label: "Fiscal / legal" }, { key: "newsletter_noise", label: "Noise" }, { key: "other", label: "Other" },
];
function fieldsLine(f: Record<string, unknown> | null | undefined): string {
  if (!f) return "";
  const parts: string[] = [];
  if (f.date) parts.push(String(f.date));
  if (f.pax) parts.push(`${f.pax} pax`);
  if (f.budget_pp) parts.push(`~${f.budget_pp} €/pp`);
  if (f.venue_case) parts.push(f.venue_case === "ours" ? "at ours" : f.venue_case === "provider" ? "their venue" : "needs a venue");
  if (f.food_shape) parts.push(String(f.food_shape));
  return parts.join(" · ");
}
export type AccountChip = { id: string; handle: string; platform: "instagram" | "facebook"; active: boolean };
export type SavedReply = { id: string; key: string; title: string; lang: string; body: string };

type Filter = "waiting" | "flagged" | "sent" | "skipped" | "failed" | "all";
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "waiting", label: "Waiting" },
  { key: "flagged", label: "For Boris" },
  { key: "sent", label: "Sent" },
  { key: "skipped", label: "Skipped" },
  { key: "failed", label: "Failed" },
  { key: "all", label: "All" },
];

function ago(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function matches(it: InboxItem, f: Filter): boolean {
  switch (f) {
    case "waiting": return ["new", "drafted", "approved", "classified"].includes(it.status) && !it.flagged;
    case "flagged": return it.flagged && !["replied", "skipped", "hidden"].includes(it.status);
    case "sent": return it.status === "replied" || it.status === "hidden";
    case "skipped": return it.status === "skipped";
    case "failed": return it.status === "failed";
    default: return true;
  }
}

export default function InboxList({ slug, items: initial, accounts, saved }: {
  slug: string; items: InboxItem[]; accounts: AccountChip[]; saved: SavedReply[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<InboxItem[]>(initial);
  const [filter, setFilter] = useState<Filter>("waiting");
  const [account, setAccount] = useState<string | "all">("all");
  const [channel, setChannel] = useState<"all" | "social" | "email">("all");
  const hasEmail = useMemo(() => initial.some((i) => i.kind === "email"), [initial]);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  const shown = useMemo(
    () => items.filter((i) => matches(i, filter) && (account === "all" || i.account_id === account) && (channel === "all" || (channel === "email") === (i.kind === "email"))),
    [items, filter, account, channel],
  );
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { waiting: 0, flagged: 0, sent: 0, skipped: 0, failed: 0, all: items.length };
    for (const i of items) for (const f of ["waiting", "flagged", "sent", "skipped", "failed"] as Filter[]) if (matches(i, f)) c[f]++;
    return c;
  }, [items]);

  function patch(id: string, p: Partial<InboxItem>) {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }

  async function act(it: InboxItem, action: "approve" | "skip" | "restore" | "hide" | "redraft" | "recategorise" | "outcome", extra: Record<string, unknown> = {}) {
    const key = `${it.kind}:${it.id}`;
    setBusy((b) => ({ ...b, [key]: action }));
    try {
      const r = await fetch(it.kind === "email" ? "/api/email/act" : "/api/inbox/act", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, kind: it.kind, id: it.id, text: it.draft, ...extra }),
      });
      const j = await r.json().catch(() => ({}));
      if (action === "recategorise") {
        if (j.ok) { patch(it.id, { status: j.routed?.startsWith("noise") ? "noise" : j.routed?.startsWith("captured") ? "archived" : j.routed?.startsWith("flagged") ? "flagged" : "classified", flagged: !!j.routed?.startsWith("flagged"), email: it.email ? { ...it.email, category: j.category } : it.email, error: null }); setToast(`Re-sorted as ${j.category}: ${j.routed}`); }
        else { setToast(j.error ?? "failed"); }
      } else if (action === "outcome") {
        if (j.ok) { patch(it.id, { email: it.email ? { ...it.email, outcome: j.outcome } : it.email }); setToast(`Noted: ${j.outcome}`); } else setToast(j.error ?? "failed");
      } else if (action === "redraft") {
        if (j.ok) patch(it.id, { status: j.status === "flagged" ? "drafted" : "drafted", flagged: j.status === "flagged", flag_reason: j.flag_reason ?? null, draft: j.reply ?? "", draft_lang: j.lang ?? null, error: null });
        else { patch(it.id, { error: j.error ?? "redraft failed" }); setToast(j.error ?? "redraft failed"); }
      } else if (j.ok) {
        patch(it.id, { status: j.status, error: null, replied_at: action === "approve" ? new Date().toISOString() : it.replied_at });
        if (action === "approve") setToast(`Sent to ${it.who}`);
      } else {
        patch(it.id, { status: j.status ?? it.status, error: j.error ?? "failed" });
        setToast(j.error ?? "failed");
      }
    } catch (e: any) {
      patch(it.id, { error: String(e?.message || e) });
      setToast(String(e?.message || e));
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[key]; return n; });
      setTimeout(() => setToast(null), 2500);
    }
  }

  return (
    <div className="mt-3">
      {/* Filters — two rows of chips, thumb-sized. */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={"rounded-full border px-3 py-1.5 text-xs " + (filter === f.key ? "border-black bg-black text-white" : "border-black/15 bg-paper text-ink-soft")}>
            {f.label}{counts[f.key] ? <span className="ml-1 font-mono opacity-70">{counts[f.key]}</span> : null}
          </button>
        ))}
      </div>
      {hasEmail ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(["all", "social", "email"] as const).map((c) => (
            <button key={c} onClick={() => setChannel(c)}
              className={"rounded-full border px-3 py-1 text-[11px] " + (channel === c ? "border-black bg-black text-white" : "border-black/15 text-ink-soft")}>
              {c === "all" ? "all channels" : c === "social" ? "IG · FB" : "Email"}
            </button>
          ))}
        </div>
      ) : null}
      {accounts.length > 1 ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <button onClick={() => setAccount("all")}
            className={"rounded-full border px-3 py-1 text-[11px] " + (account === "all" ? "border-black bg-black text-white" : "border-black/15 text-ink-soft")}>
            all accounts
          </button>
          {accounts.map((a) => (
            <button key={a.id} onClick={() => setAccount(a.id)}
              className={"rounded-full border px-3 py-1 text-[11px] " + (account === a.id ? "border-black bg-black text-white" : "border-black/15 text-ink-soft")}>
              {a.platform === "instagram" ? "IG" : "FB"} · {a.handle}
            </button>
          ))}
        </div>
      ) : null}

      {shown.length === 0 ? (
        <p className="mt-10 text-center text-sm text-clay">
          {filter === "waiting" ? "Nothing waiting. The polls run every 10 minutes." : "Nothing here."}
        </p>
      ) : null}

      <ul className="mt-3 space-y-3">
        {shown.map((it) => {
          const key = `${it.kind}:${it.id}`;
          const b = busy[key];
          const done = ["replied", "hidden", "skipped"].includes(it.status);
          const canSend = !done && !b && it.draft.trim().length > 0;
          return (
            <li key={key} className="rounded-lg border border-black/10 bg-paper p-3">
              {/* who / where / when */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {it.who}
                    <span className="ml-2 font-mono text-[10px] uppercase text-clay">
                      {it.kind === "email" ? "Email" : it.kind === "dm" ? "DM" : it.platform === "instagram" ? "IG" : "FB"}{it.is_reply ? " · reply" : ""}
                      {it.kind === "email" && it.email?.category ? ` · ${EMAIL_CATEGORIES.find((c) => c.key === it.email?.category)?.label ?? it.email.category}` : ""}
                      {it.kind === "email" && it.email?.confidence != null && it.email.confidence < 0.7 ? " · unsure" : ""}
                    </span>
                  </p>
                  <p className="font-mono text-[10px] text-clay">
                    {it.account_handle ?? ""} · {ago(it.at)}{it.lang ? ` · ${it.lang}` : ""}
                    {it.status === "replied" ? " · sent" : it.status === "hidden" ? " · hidden" : it.status === "skipped" ? " · skipped" : it.status === "failed" ? " · failed" : ""}
                  </p>
                </div>
                {it.media?.permalink ? (
                  <a href={it.media.permalink} target="_blank" rel="noreferrer" className="shrink-0" title={it.media.caption ?? "open post"}>
                    {it.media.thumb
                      ? <img src={it.media.thumb} alt="" className="h-12 w-12 rounded object-cover" />
                      : <span className="inline-block rounded border border-black/15 px-2 py-1 text-[10px]">post ↗</span>}
                  </a>
                ) : null}
              </div>

              {/* email: what the OS read from it */}
              {it.kind === "email" && it.email ? (
                <p className="mt-1 font-mono text-[10px] text-clay">
                  {fieldsLine(it.email.enquiry_fields)}
                  {it.email.needs_you_due ? `deadline ${it.email.needs_you_due}` : ""}
                  {it.email.message_count > 1 ? `${fieldsLine(it.email.enquiry_fields) || it.email.needs_you_due ? " · " : ""}${it.email.message_count} messages` : ""}
                  {it.status === "replied" && it.email.hours_to_answer != null ? ` · answered in ${it.email.hours_to_answer} h` : ""}
                </p>
              ) : null}

              {/* what they wrote (DMs: short history, theirs last) */}
              {it.kind === "dm" && it.history && it.history.length > 1 ? (
                <div className="mt-2 space-y-1">
                  {it.history.map((h, i) => (
                    <p key={i} className={"whitespace-pre-wrap rounded px-2 py-1 text-sm " + (h.dir === "in" ? "bg-paper-deep" : "bg-black/5 text-ink-soft")}>
                      {h.dir === "out" ? <span className="font-mono text-[10px] text-clay">you · </span> : null}{h.text}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="mt-2 whitespace-pre-wrap text-sm">{it.text}</p>
              )}

              {/* suggested reply */}
              {done ? (
                it.status === "replied" && (it.draft) ? (
                  <p className="mt-2 rounded bg-black/5 px-2 py-1 text-sm text-ink-soft"><span className="font-mono text-[10px] text-clay">you · </span>{it.draft}</p>
                ) : null
              ) : it.flagged ? (
                <div className="mt-2 rounded border border-black/20 bg-paper-deep p-2">
                  <p className="font-mono text-[10px] uppercase text-clay">For Boris to write</p>
                  <p className="text-xs text-ink-soft">{it.flag_reason}</p>
                  <textarea
                    value={it.draft} onChange={(e) => patch(it.id, { draft: e.target.value })}
                    placeholder="Write it here, then Send."
                    rows={3} className="mt-2 w-full rounded border border-black/15 bg-white p-2 text-sm" />
                </div>
              ) : (
                <textarea
                  value={it.draft} onChange={(e) => patch(it.id, { draft: e.target.value })}
                  placeholder={it.status === "new" ? "Drafting…" : "Suggested reply"}
                  rows={Math.min(6, Math.max(2, Math.ceil(it.draft.length / 48)))}
                  className="mt-2 w-full rounded border border-black/15 bg-white p-2 text-sm" />
              )}

              {it.error ? <p className="mt-1 text-xs text-red-700">{it.error}</p> : null}

              {/* the tap */}
              {!done ? (
                <div className="mt-2 flex items-center gap-2">
                  <button onClick={() => act(it, "approve")} disabled={!canSend}
                    className="flex-1 rounded-md bg-black px-4 py-3 text-sm font-medium text-white disabled:opacity-40">
                    {b === "approve" ? "Sending…" : it.status === "failed" ? "Send again" : "Send ✓"}
                  </button>
                  {saved.length ? (
                    <select
                      className="h-11 max-w-[8.5rem] rounded border border-black/15 bg-paper px-2 text-xs"
                      value="" onChange={(e) => {
                        const s = saved.find((x) => x.id === e.target.value);
                        if (s) patch(it.id, { draft: s.body });
                      }}>
                      <option value="">Saved…</option>
                      {saved.map((s) => <option key={s.id} value={s.id}>{s.title} · {s.lang}</option>)}
                    </select>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-1.5 flex flex-wrap gap-3 text-xs">
                {!done ? <button onClick={() => act(it, "skip")} disabled={!!b} className="text-clay underline-offset-2 hover:underline">Skip</button> : null}
                {!done && it.kind === "comment" ? <button onClick={() => act(it, "hide")} disabled={!!b} className="text-clay underline-offset-2 hover:underline">Hide</button> : null}
                {!done ? <button onClick={() => act(it, "redraft")} disabled={!!b} className="text-clay underline-offset-2 hover:underline">{b === "redraft" ? "Drafting…" : "Redraft"}</button> : null}
                {it.status === "skipped" ? <button onClick={() => act(it, "restore")} disabled={!!b} className="text-clay underline-offset-2 hover:underline">Back to waiting</button> : null}
                {it.kind === "email" && !["replied"].includes(it.status) ? (
                  <select className="rounded border border-black/15 bg-paper px-1 py-0.5 text-[11px] text-clay" value="" disabled={!!b}
                    onChange={(e) => { if (e.target.value) act(it, "recategorise", { category: e.target.value }); }}>
                    <option value="">Wrong pile…</option>
                    {EMAIL_CATEGORIES.filter((c) => c.key !== it.email?.category).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                ) : null}
                {it.kind === "email" && it.email?.category === "enquiry" && ["replied", "skipped"].includes(it.status) ? (
                  <select className="rounded border border-black/15 bg-paper px-1 py-0.5 text-[11px] text-clay" value={it.email.outcome ?? ""} disabled={!!b}
                    onChange={(e) => { if (e.target.value) act(it, "outcome", { outcome: e.target.value }); }}>
                    <option value="">Outcome…</option>
                    <option value="won">Won</option><option value="lost">Lost</option><option value="no_answer">No answer</option><option value="not_sales">Not sales</option>
                  </select>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex items-center justify-between text-xs text-clay">
        <button onClick={() => router.refresh()} className="underline-offset-2 hover:underline">Refresh</button>
        <a href={`/h/${slug}/comms?tab=saved`} className="underline-offset-2 hover:underline">Saved replies</a>
      </div>

      {toast ? (
        <div className="fixed inset-x-3 bottom-4 z-50 rounded-md bg-black px-4 py-3 text-center text-sm text-white shadow-lg sm:inset-x-auto sm:right-6 sm:w-80">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
