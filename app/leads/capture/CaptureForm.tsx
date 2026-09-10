"use client";

import { useState } from "react";
import { resolveFunnelCopy, normaliseFunnelScopeInput } from "./copyBridge";

type Props = {
  entitySlug: string;
  source: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
};

export default function CaptureForm(props: Props) {
  const scope = normaliseFunnelScopeInput(props.entitySlug);
  const copy = resolveFunnelCopy(scope);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [partySize, setPartySize] = useState("");
  const [intent, setIntent] = useState("");
  const [requestedDate, setRequestedDate] = useState("");
  const [message, setMessage] = useState("");
  const [honeypot, setHoneypot] = useState(""); // NEVER shown to real users
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "sending") return;
    setStatus("sending");
    try {
      const body: Record<string, unknown> = {
        entity_slug: props.entitySlug,
        source: props.source,
        utm_source: props.utmSource,
        utm_medium: props.utmMedium,
        utm_campaign: props.utmCampaign,
        landing_url: typeof window !== "undefined" ? window.location.href : null,
        referrer_url: typeof document !== "undefined" ? document.referrer || null : null,
        name: name || null,
        email: email || null,
        phone: phone || null,
        party_size: partySize ? Number(partySize) : null,
        intent: intent || null,
        requested_date: requestedDate || null,
        message: message || null,
        website_url: honeypot, // will be dropped by the endpoint if populated
      };
      const res = await fetch("/api/leads/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("capture non-ok");
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-6">
        <p className="text-slate-800">{copy.website_form.success}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">{copy.website_form.field_labels.name}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">{copy.website_form.field_labels.email}</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">{copy.website_form.field_labels.phone}</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">{copy.website_form.field_labels.party_size}</label>
          <input
            type="number"
            min={1}
            max={200}
            value={partySize}
            onChange={(e) => setPartySize(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">{copy.website_form.field_labels.requested_date}</label>
          <input
            type="date"
            value={requestedDate}
            onChange={(e) => setRequestedDate(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">{copy.website_form.field_labels.intent}</label>
        <select
          value={intent}
          onChange={(e) => setIntent(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          <option value="">—</option>
          {copy.website_form.intent_options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">{copy.website_form.field_labels.message}</label>
        <textarea
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
        />
      </div>

      {/* Honeypot — hidden from humans, offered to bots. */}
      <div style={{ position: "absolute", left: "-10000px", top: "auto", width: 1, height: 1, overflow: "hidden" }} aria-hidden>
        <label>
          Website (leave empty)
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </label>
      </div>

      <button
        type="submit"
        disabled={status === "sending"}
        className="w-full rounded-md bg-slate-900 text-white py-2.5 text-sm uppercase tracking-wide disabled:opacity-50"
      >
        {status === "sending" ? "Sending…" : copy.website_form.cta}
      </button>
      {status === "error" ? (
        <p className="text-sm text-red-600">Something went wrong. Please try again.</p>
      ) : null}
    </form>
  );
}
