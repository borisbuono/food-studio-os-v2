"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// A ticket shows IVA but not our fiscal details, so it isn't deductible until
// a factura exists. This card looks first, then drafts the request — it never sends.
const STATUS: Record<string, string> = {
  unchecked: "Not checked yet",
  resolved: "Factura found — linked",
  requestable_client: "Factura obtainable — we're already their client",
  requestable_new: "Factura obtainable — register our details with them first",
  awaiting_factura: "Requested — waiting for the factura",
  consolidated: "Billed monthly / by the card issuer — no per-ticket chase",
  not_obtainable: "No factura possible — non-deductible",
};
const btn = "rounded-lg border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide";

type Draft = {
  ok: true; resolved?: boolean; status?: string; template?: string; to?: { email: string; from: string }[];
  draft?: { subject: string; body: string }; ticket_url?: string | null; issuer?: string | null; standing_fix?: string | null;
  mailbox?: string; fiscal_address_missing?: boolean; supplier?: { name: string; cif: string | null; phone: string | null } | null;
};

export default function TicketChase({ id, status, supplier, amount, date }: { id: string; status: string | null; supplier: string | null; amount: number | null; date: string | null }) {
  const router = useRouter();
  const [d, setD] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  const [issuer, setIssuer] = useState("");
  const [mode, setMode] = useState<null | "impossible" | "billing">(null);

  async function call(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/capture/chase", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action, ...extra }) });
      const j = await r.json();
      if (!j.ok) { setErr(j.error); return null; }
      return j;
    } catch (e: any) { setErr(String(e?.message || e)); return null; } finally { setBusy(false); }
  }
  async function draft() {
    const j = await call("draft");
    if (!j) return;
    if (j.resolved) { router.refresh(); return; }
    setD(j); setTo(j.to?.[0]?.email || ""); setSubject(j.draft?.subject || ""); setBody(j.draft?.body || "");
  }
  const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body + (d?.ticket_url ? `\n\n(Ticket: ${d.ticket_url})` : ""))}`;
  const done = status === "resolved" || status === "not_obtainable" || status === "consolidated";

  return (
    <div className="mt-2 rounded-xl border border-line p-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-amber">Ticket — not a factura · {STATUS[status || "unchecked"] || status}</p>
      {!done && !d ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button disabled={busy} onClick={draft} className={btn + " text-ink"}>{busy ? "Looking…" : status === "awaiting_factura" ? "Chase again" : "Get the factura"}</button>
          <button disabled={busy} onClick={() => setMode("billing")} className={btn + " text-ink-soft"}>Billed monthly / by someone else</button>
          <button disabled={busy} onClick={() => setMode("impossible")} className={btn + " text-ink-soft"}>No factura possible</button>
        </div>
      ) : null}
      {d ? (
        <div className="mt-2 space-y-2">
          <p className="font-serif text-[14px] text-ink">
            {supplier || d.supplier?.name}{amount != null ? `, €${Number(amount).toFixed(2)}` : ""}{date ? `, ${date}` : ""}.{" "}
            {d.template === "client" ? "Already a client — request the factura." : "Not registered as a customer — send our fiscal details and request the factura."}
          </p>
          {d.issuer ? <p className="font-mono text-[11px] text-amber">Factura issued by {d.issuer} — send it there, not to the shop.</p> : null}
          {d.standing_fix ? <p className="font-mono text-[11px] text-amber">{d.standing_fix}</p> : null}
          {d.fiscal_address_missing ? <p className="font-mono text-[11px] text-tomato">No fiscal address on file for this company — fill it in the draft.</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wide text-clay">To</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="supplier email" className="min-w-[16rem] flex-1 rounded-lg border border-line bg-transparent px-2 py-1 font-sans text-[13px] text-ink" />
          </div>
          {d.to && d.to.length ? <p className="font-mono text-[10px] text-ink-soft">Found: {d.to.map((x) => `${x.email} (${x.from})`).join(" · ")}</p>
            : <p className="font-mono text-[10px] text-ink-soft">No email found{d.supplier?.phone ? ` — phone on the ticket: ${d.supplier.phone}` : ""}. {d.mailbox}</p>}
          <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-lg border border-line bg-transparent px-2 py-1 font-sans text-[13px] text-ink" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="w-full rounded-lg border border-line bg-transparent px-2 py-1 font-sans text-[13px] text-ink" />
          <div className="flex flex-wrap gap-2">
            <a href={mailto} className={btn + " text-ink"} style={{ borderColor: "var(--accent)" }}>Open in mail</a>
            {d.ticket_url ? <a href={d.ticket_url} target="_blank" rel="noreferrer" className={btn + " text-ink-soft"}>Ticket file (attach it)</a> : null}
            <button disabled={busy} onClick={async () => { if (await call("mark_requested", { to })) { setD(null); router.refresh(); } }} className={btn + " text-ink"}>I sent it</button>
            <button disabled={busy} onClick={() => setD(null)} className={btn + " text-ink-soft"}>Close</button>
          </div>
        </div>
      ) : null}
      {mode === "impossible" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="why (e.g. shop closed, no records)" className="min-w-[14rem] flex-1 rounded-lg border border-line bg-transparent px-2 py-1 font-sans text-[13px] text-ink" />
          <button disabled={busy || note.trim().length < 3} onClick={async () => { if (await call("not_obtainable", { note })) { setMode(null); router.refresh(); } }} className={btn + " text-tomato"}>Mark non-deductible</button>
        </div>
      ) : null}
      {mode === "billing" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="who issues the factura (e.g. CaixaBank – Solred)" className="min-w-[14rem] flex-1 rounded-lg border border-line bg-transparent px-2 py-1 font-sans text-[13px] text-ink" />
          <button disabled={busy} onClick={async () => { if (await call("set_billing", { invoice_issued_by: issuer, billing_mode: "consolidated_monthly" })) { setMode(null); router.refresh(); } }} className={btn + " text-ink"}>Save — monthly factura</button>
        </div>
      ) : null}
      {err ? <p className="mt-2 font-mono text-[11px] text-tomato">{err}</p> : null}
    </div>
  );
}
