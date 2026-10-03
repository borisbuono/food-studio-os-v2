"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { OAuthClientPublic } from "@/lib/google/oauthClient";

// "Google client for this house" — the one thing a manager pastes before
// Connect works (Boris 2026-10-03: credentials per entity, Internal app = one
// client per Workspace). Shows the id prefix and when it was set; never the
// secret. Replace re-opens the paste form; Disable deletes the secret from
// Vault and leaves the row so the date is still visible.
function prefix(id: string) { return id.length > 18 ? `${id.slice(0, 18)}…` : id; }
function day(iso: string) { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }

export default function GoogleClientCard({ slug, client, canManage, domainHint }: {
  slug: string; client: OAuthClientPublic | null; canManage: boolean; domainHint?: string | null;
}) {
  const router = useRouter();
  const active = !!client && client.status === "active";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [hd, setHd] = useState(client?.hosted_domain || domainHint || "");

  async function post(body: Record<string, unknown>) {
    const r = await fetch("/api/email/google-client", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entity: slug, ...body }) });
    return r.json().catch(() => ({}));
  }
  async function save() {
    setBusy(true); setMsg(null);
    const j = await post({ action: "set", client_id: id, client_secret: secret, hosted_domain: hd });
    setBusy(false);
    if (!j.ok) { setMsg(j.error || "Could not save."); return; }
    setId(""); setSecret(""); setOpen(false);
    setMsg("Saved. The secret is in the vault; only its id is shown here.");
    router.refresh();
  }
  async function disable() {
    if (!confirm("Disable the Google client for this house? Connected mailboxes stop refreshing until a client is set again.")) return;
    setBusy(true); setMsg(null);
    const j = await post({ action: "disable" });
    setBusy(false);
    if (!j.ok) { setMsg(j.error || "Could not disable."); return; }
    router.refresh();
  }

  return (
    <section className="mt-5 rounded-lg border border-black/10 bg-paper p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">Google client for this house</p>
          {active && client ? (
            <p className="font-mono text-[10px] text-clay">
              {prefix(client.client_id)} · set on {day(client.updated_at)}{client.hosted_domain ? ` · ${client.hosted_domain}` : ""}
            </p>
          ) : client ? (
            <p className="font-mono text-[10px] text-clay">disabled {day(client.updated_at)} · was {prefix(client.client_id)}</p>
          ) : (
            <p className="text-xs text-clay">Not set. Each house uses its own Google Workspace client — paste it once and Connect works.</p>
          )}
        </div>
        <span className={"shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] " + (active ? "bg-black text-white" : "border border-black/20 text-ink-soft")}>
          {active ? "set" : "not set"}
        </span>
      </div>

      {msg ? <p className="mt-2 rounded border border-black/15 bg-paper-deep px-3 py-2 text-xs">{msg}</p> : null}

      {canManage ? (
        <div className="mt-3">
          {!open ? (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <button onClick={() => setOpen(true)} className="rounded-md border border-black/15 px-3 py-2 text-sm">
                {active ? "Replace" : "Set the Google client"}
              </button>
              {active ? <button onClick={disable} disabled={busy} className="text-clay underline-offset-2 hover:underline">Disable</button> : null}
            </div>
          ) : (
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void save(); }}>
              <label className="block text-xs text-ink-soft">
                Client ID
                <input value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" spellCheck={false} required
                       placeholder="123456789012-abc…xyz.apps.googleusercontent.com"
                       className="mt-1 w-full rounded border border-black/15 bg-white px-2 py-2 font-mono text-xs" />
              </label>
              <label className="block text-xs text-ink-soft">
                Client secret
                <input value={secret} onChange={(e) => setSecret(e.target.value)} type="password" autoComplete="off" spellCheck={false} required
                       placeholder="GOCSPX-…"
                       className="mt-1 w-full rounded border border-black/15 bg-white px-2 py-2 font-mono text-xs" />
              </label>
              <label className="block text-xs text-ink-soft">
                Workspace domain <span className="text-clay">(optional — pre-selects that Workspace on Google's account picker)</span>
                <input value={hd} onChange={(e) => setHd(e.target.value)} autoComplete="off" spellCheck={false}
                       placeholder="bistro-mondo.com"
                       className="mt-1 w-full rounded border border-black/15 bg-white px-2 py-2 font-mono text-xs" />
              </label>
              <div className="flex items-center gap-3">
                <button type="submit" disabled={busy || !id || !secret} className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
                  {busy ? "Saving…" : "Save to vault"}
                </button>
                <button type="button" onClick={() => { setOpen(false); setId(""); setSecret(""); }} className="text-xs text-clay underline-offset-2 hover:underline">Cancel</button>
              </div>
              <p className="text-[11px] text-clay">Google Cloud Console → APIs &amp; Services → Credentials → the OAuth client for this Workspace. The secret is stored encrypted and never shown again.</p>
            </form>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-clay">Only a manager of this house can set its Google client.</p>
      )}
    </section>
  );
}
