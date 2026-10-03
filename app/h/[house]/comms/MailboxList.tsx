"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type MailboxRow = {
  id: string; address: string; status: string; forwards_to_holded: boolean;
  connected_at: string | null; last_pull_at: string | null; last_error: string | null; waiting: number;
};

function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const NOTICE: Record<string, string> = {
  state_mismatch: "That connect link had expired. Try again.",
  no_refresh_token: "Google did not hand over a long-lived token — remove the OS from the account's connected apps and connect again.",
  not_configured: "Google sign-in is not configured on the server yet (GOOGLE_OAUTH_CLIENT_ID).",
  no_service_key: "Server is missing its service key — nothing can be stored yet.",
  save_failed: "Connected to Google but the mailbox could not be saved.",
  forbidden: "Only a manager of this house can connect a mailbox.",
  no_email: "Google did not say which mailbox that was.",
};
function noticeText(n: string | null): string | null {
  if (!n) return null;
  if (n.startsWith("connected:")) return `Connected ${n.slice(10)}. First pull is running.`;
  if (n.startsWith("denied:")) return "You cancelled on Google's side. Nothing changed.";
  if (n.startsWith("missing_scopes:")) return `Google granted fewer permissions than the OS needs (${n.slice(15)}). Connect again and tick every box.`;
  if (n.startsWith("token_")) return `Google refused the code (${n}). Usually the redirect URI is not on the OAuth client yet — see the ship note.`;
  return NOTICE[n] || n;
}

export default function MailboxList({ slug, rows: initial, canManage, configured, notice }: {
  slug: string; rows: MailboxRow[]; canManage: boolean; configured: boolean; notice: string | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(noticeText(notice));
  const back = `/h/${slug}/comms?tab=mail`;

  async function post(body: Record<string, unknown>, url = "/api/email/accounts") {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return r.json().catch(() => ({}));
  }
  async function disconnect(r: MailboxRow) {
    if (!confirm(`Disconnect ${r.address}? The OS stops reading it and forgets its keys.`)) return;
    setBusy(r.id);
    const j = await post({ action: "disconnect", id: r.id });
    if (j.ok) setRows((xs) => xs.filter((x) => x.id !== r.id)); else setMsg(j.error || "failed");
    setBusy(null);
  }
  async function toggleHolded(r: MailboxRow) {
    setBusy(r.id);
    const j = await post({ action: "set", id: r.id, forwards_to_holded: !r.forwards_to_holded });
    if (j.ok) setRows((xs) => xs.map((x) => (x.id === r.id ? { ...x, forwards_to_holded: !r.forwards_to_holded } : x))); else setMsg(j.error || "failed");
    setBusy(null);
  }
  async function pullNow() {
    setBusy("pull");
    const j = await post({ entity: slug }, "/api/email/pull");
    setMsg(j.ok ? "Pulled. " + (j.results || []).map((x: any) => `${x.account}: ${x.ok ? `${x.counts?.inserted ?? 0} new` : x.error}`).join(" · ") : (j.error || "pull failed"));
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="mt-3">
      {msg ? <p className="mb-3 rounded border border-black/15 bg-paper-deep px-3 py-2 text-sm">{msg}</p> : null}

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-black/20 p-6 text-center">
          <p className="text-sm text-ink-soft">No mailbox connected.</p>
          <p className="mt-1 text-xs text-clay">Connect the house inbox (info@…) and, if there is one, the admin@… address suppliers write to.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-black/10 bg-paper p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.address}</p>
                  <p className="font-mono text-[10px] text-clay">
                    {r.status === "active" ? "connected" : r.status === "needs_reconnect" ? "needs reconnect" : r.status}
                    {" · last pull "}{ago(r.last_pull_at)}
                    {r.waiting ? ` · ${r.waiting} waiting` : ""}
                  </p>
                </div>
                <span className={"shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] " + (r.status === "active" ? "bg-black text-white" : "border border-black/20 text-ink-soft")}>
                  {r.status === "active" ? "on" : "off"}
                </span>
              </div>
              {r.last_error ? <p className="mt-1 text-xs text-red-700">{r.last_error}</p> : null}
              {canManage ? (
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  <label className="flex items-center gap-1.5 text-ink-soft">
                    <input type="checkbox" checked={r.forwards_to_holded} disabled={busy === r.id} onChange={() => toggleHolded(r)} />
                    forwards to Holded's scanner (invoices here are never pushed twice)
                  </label>
                  {r.status === "needs_reconnect" ? (
                    <a href={`/api/email/connect?entity=${slug}&back=${encodeURIComponent(back)}`} className="underline-offset-2 hover:underline">Reconnect</a>
                  ) : null}
                  <button onClick={() => disconnect(r)} disabled={busy === r.id} className="text-clay underline-offset-2 hover:underline">Disconnect</button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {configured ? (
            <a href={`/api/email/connect?entity=${slug}&back=${encodeURIComponent(back)}`}
               className="rounded-md bg-black px-4 py-3 text-sm font-medium text-white">
              Connect a mailbox
            </a>
          ) : (
            <span className="rounded-md border border-black/15 px-4 py-3 text-sm text-ink-soft">Connect a mailbox — not configured yet</span>
          )}
          {rows.length ? (
            <button onClick={pullNow} disabled={busy === "pull"} className="rounded-md border border-black/15 px-4 py-3 text-sm">
              {busy === "pull" ? "Pulling…" : "Pull now"}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-xs text-clay">Only a manager of this house can connect or remove a mailbox.</p>
      )}
    </div>
  );
}
