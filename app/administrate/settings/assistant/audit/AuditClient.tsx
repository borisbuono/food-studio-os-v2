"use client";
import { useMemo, useState } from "react";

// Audit table + per-row expand. Filter chips by action_kind.
// Editorial identity: hairlines, mono microcopy for the meta labels.

type Action = {
  id: string;
  action_type: string;
  action_kind: string | null;
  entity_code: string | null;
  cost_eur: number | null;
  latency_ms: number | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  payload: any | null;
  created_at: string;
  target_table: string | null;
  target_id: string | null;
};

const KIND_FILTERS: [string, string][] = [
  ["all", "all"],
  ["chat", "chat"],
  ["brief", "brief"],
  ["draft", "draft"],
  ["triage", "triage"],
  ["memory_extract", "memory"],
  ["send", "send"],
  ["webhook_receive", "webhook"],
];

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60)     return s + "s ago";
  if (s < 3600)   return Math.floor(s / 60) + "m ago";
  if (s < 86400)  return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

export default function AuditClient({ actions }: { actions: Action[] }) {
  const [filter, setFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (filter === "all") return actions;
    return actions.filter((a) => (a.action_kind || "") === filter);
  }, [actions, filter]);

  return (
    <section className="mt-10">
      <div className="flex items-center gap-4">
        {KIND_FILTERS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={"font-mono text-[10px] uppercase tracking-wide pb-0.5 " + (filter === k ? "text-ink border-b border-ink" : "text-clay border-b border-transparent hover:text-ink")}
          >
            {label}
          </button>
        ))}
      </div>

      <ul className="mt-4 divide-y divide-black/10">
        {filtered.map((a) => {
          const isOpen = expanded === a.id;
          return (
            <li key={a.id}>
              <button
                onClick={() => setExpanded(isOpen ? null : a.id)}
                className="flex w-full items-baseline justify-between gap-4 py-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-serif text-[14px] text-ink truncate">
                    <span className="font-mono text-[10px] uppercase tracking-wide text-clay mr-2">{a.action_kind || a.action_type}</span>
                    <span className="text-ink-soft">{a.action_type}</span>
                  </p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">
                    {relativeTime(a.created_at)}
                    {a.model ? ` · ${a.model}` : ""}
                    {typeof a.latency_ms === "number" ? ` · ${a.latency_ms}ms` : ""}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-[11px] text-ink">€{Number(a.cost_eur || 0).toFixed(4)}</p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">
                    {(a.input_tokens || 0) + " in · " + (a.output_tokens || 0) + " out"}
                  </p>
                </div>
              </button>

              {isOpen ? (
                <div className="pb-4 pl-1">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Payload</p>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-sm border border-black/10 bg-black/5 p-3 font-mono text-[11px] text-ink-soft whitespace-pre-wrap break-all">
{JSON.stringify(a.payload, null, 2)}
                  </pre>
                  {a.target_table || a.target_id ? (
                    <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-clay">
                      Target: {a.target_table || "—"}{a.target_id ? " · " + String(a.target_id).slice(0, 12) : ""}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
        {filtered.length === 0 ? (
          <li className="py-8 text-center font-serif italic text-[14px] text-ink-soft">
            No actions under this filter yet.
          </li>
        ) : null}
      </ul>
    </section>
  );
}
