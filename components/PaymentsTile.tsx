"use client";
import Link from "next/link";

// PaymentsTile — the Command Center tile Boris didn't have on 2026-07-05
// when he discovered Wix, Meta Ads (BM disabled since Apr 4), Holded (retry
// loop), and Google Workspace (chronic decline across 4 card rotations) were
// all failing silently. See memory/payment_method_rotation_needed.md.
//
// Renders a big number (count of non-healthy platforms) + the 3 highest-severity
// rows with a coloured pill each. Tap → /administrate/finance/payments.

export type PaymentRow = {
  entity_code: "IFL" | "BM" | "BBH";
  platform: string;
  state: "healthy" | "at_risk" | "failing" | "disabled" | "missing_card";
  card_last4: string | null;
  last_failure_at: string | null;
  failure_count_30d: number;
  notes: string | null;
};

const SEVERITY: Record<PaymentRow["state"], number> = {
  disabled: 0, failing: 1, at_risk: 2, missing_card: 3, healthy: 4,
};

const PLATFORM_LABEL: Record<string, string> = {
  "google-workspace": "Google Workspace",
  "wix-newsletter": "Wix",
  "meta-ads": "Meta Ads",
  "holded": "Holded",
  "apideck": "Apideck",
};

function platformLabel(p: string) {
  return PLATFORM_LABEL[p] || p.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Pill colours use the design tokens defined in tailwind.config.ts:
// tomato = red (disabled), clay/amber = orange (failing), muted (missing_card),
// basil = green (healthy). at_risk uses amber too, one shade lighter in copy.
function pillClasses(state: PaymentRow["state"]) {
  switch (state) {
    case "disabled":     return "border-tomato/40 bg-tomato/10 text-tomato";
    case "failing":      return "border-tomato/40 bg-tomato/10 text-tomato";
    case "at_risk":      return "border-clay/40 bg-clay/10 text-clay";
    case "missing_card": return "border-line bg-paper-deep text-muted";
    case "healthy":      return "border-basil/40 bg-basil/10 text-basil";
  }
}

function shortReason(r: PaymentRow) {
  // A one-line "why this row matters" for the mini-list on Home.
  if (r.state === "disabled") {
    const when = r.last_failure_at?.slice(0, 10);
    return when ? `disabled since ${when}` : "disabled";
  }
  if (r.state === "failing") {
    return r.failure_count_30d ? `${r.failure_count_30d} fails in 30d` : "failing";
  }
  if (r.state === "at_risk") {
    return r.failure_count_30d ? `retry loop · ${r.failure_count_30d} fails 30d` : "retry loop";
  }
  if (r.state === "missing_card") return "no card on file";
  return "healthy";
}

const ENT_LABEL: Record<PaymentRow["entity_code"], string> = {
  IFL: "IFL", BM: "BM", BBH: "BBH",
};

export default function PaymentsTile({ rows }: { rows: PaymentRow[] }) {
  // Rank by severity, then failure_count_30d desc, then platform name for
  // a stable ordering so the tile doesn't flicker across page loads.
  const sorted = rows.slice().sort((a, b) => {
    const s = SEVERITY[a.state] - SEVERITY[b.state];
    if (s !== 0) return s;
    return (b.failure_count_30d || 0) - (a.failure_count_30d || 0)
        || a.platform.localeCompare(b.platform);
  });
  const notHealthy = sorted.filter((r) => r.state !== "healthy").length;
  const top = sorted.filter((r) => r.state !== "healthy").slice(0, 3);
  const allGood = notHealthy === 0;

  return (
    <Link href="/administrate/finance/payments" className="block rounded-2xl border border-black/10 bg-card p-5 transition hover:border-line">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Payments</p>
        <span className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>all →</span>
      </div>
      <p className={"mt-2 font-serif text-4xl " + (allGood ? "text-basil" : "text-tomato")}>
        {allGood ? "0" : notHealthy}
      </p>
      <p className="mt-1 font-sans text-[13px] text-ink-soft">
        {allGood ? "all platforms healthy" : `platform${notHealthy === 1 ? "" : "s"} not healthy`}
      </p>
      {top.length > 0 ? (
        <ul className="mt-4 divide-y divide-black/5 border-t border-black/10">
          {top.map((r) => (
            <li key={r.entity_code + ":" + r.platform} className="flex items-center justify-between gap-3 py-2">
              <span className="font-sans text-[13px] text-ink truncate">
                {platformLabel(r.platform)} <span className="text-clay">· {ENT_LABEL[r.entity_code]}</span>
                <span className="ml-1.5 font-mono text-[11px] text-ink-soft">· {shortReason(r)}</span>
              </span>
              <span className={"shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide " + pillClasses(r.state)}>
                {r.state.replace("_", " ")}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Link>
  );
}

// Compact inline listing used on /administrate/finance/setup/[entity].
// Same data, no headline number — just the per-entity roll of platform states.
export function BillingHealthMini({ rows }: { rows: PaymentRow[] }) {
  if (!rows.length) return (
    <p className="mt-3 font-serif italic text-[13px] text-muted">No billing data seeded for this entity.</p>
  );
  const sorted = rows.slice().sort((a, b) => SEVERITY[a.state] - SEVERITY[b.state]);
  return (
    <ul className="mt-3 divide-y divide-line">
      {sorted.map((r) => (
        <li key={r.entity_code + ":" + r.platform} className="flex items-center justify-between gap-3 py-2">
          <span className="font-serif text-[15px] text-ink">
            {platformLabel(r.platform)}
            {r.card_last4 ? <span className="ml-2 font-mono text-[11px] text-muted">···· {r.card_last4}</span> : null}
          </span>
          <span className={"shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide " + pillClasses(r.state)}>
            {r.state.replace("_", " ")}
          </span>
        </li>
      ))}
    </ul>
  );
}
