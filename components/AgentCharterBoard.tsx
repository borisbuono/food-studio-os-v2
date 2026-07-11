"use client";
import { useMemo, useState } from "react";

type Charter = {
  id: string;
  entity_code: string | null;
  agent_type: "research" | "build" | "write" | "pa" | "other";
  objective: string;
  scope: string | null;
  constraints: string | null;
  success_criteria: string | null;
  deliverables: any[];
  status: "draft" | "ready" | "running" | "completed" | "abandoned" | "failed";
  started_at: string | null;
  completed_at: string | null;
  output_summary: string | null;
  created_at: string;
};

const AGENT_TYPES: Charter["agent_type"][] = ["research", "build", "write", "pa", "other"];
const STATUSES: Charter["status"][] = ["draft", "ready", "running", "completed", "abandoned", "failed"];

function StatusPill({ status }: { status: Charter["status"] }) {
  const map: Record<Charter["status"], string> = {
    draft: "text-clay",
    ready: "text-ink",
    running: "text-basil",
    completed: "text-ink-soft",
    abandoned: "text-clay italic",
    failed: "text-tomato",
  };
  return <span className={`font-mono text-[10px] uppercase tracking-wide ${map[status]}`}>{status}</span>;
}

function TypeBadge({ t }: { t: Charter["agent_type"] }) {
  return (
    <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-ink-soft">
      {t}
    </span>
  );
}

export default function AgentCharterBoard({
  entity,
  charters: initial,
}: {
  entity: string;
  charters: Charter[];
}) {
  const [charters, setCharters] = useState<Charter[]>(initial);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [composerOpen, setComposerOpen] = useState(false);
  const [drawer, setDrawer] = useState<Charter | null>(null);

  const filtered = useMemo(() => {
    return charters.filter((c) => {
      if (typeFilter !== "all" && c.agent_type !== typeFilter) return false;
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      return true;
    });
  }, [charters, typeFilter, statusFilter]);

  async function spawnCharter(payload: any) {
    const r = await fetch("/api/agent/spawn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (d.ok && d.charter) {
      setCharters((cs) => [d.charter, ...cs]);
      setComposerOpen(false);
    }
  }

  return (
    <div className="mt-8">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <FilterSelect
          label="type"
          value={typeFilter}
          onChange={setTypeFilter}
          options={[{ v: "all", l: "any type" }, ...AGENT_TYPES.map((t) => ({ v: t, l: t }))]}
        />
        <FilterSelect
          label="status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[{ v: "all", l: "any status" }, ...STATUSES.map((t) => ({ v: t, l: t }))]}
        />
      </div>

      {/* Spawn */}
      <div className="mt-6">
        {composerOpen ? (
          <CharterComposer entity={entity} onCancel={() => setComposerOpen(false)} onSave={spawnCharter} />
        ) : (
          <button
            onClick={() => setComposerOpen(true)}
            className="w-full rounded-2xl border border-dashed border-line py-4 font-mono text-[11px] uppercase tracking-wide text-clay transition hover:border-ink-soft hover:text-ink"
          >
            + Spawn agent
          </button>
        )}
      </div>

      {/* List */}
      <section className="mt-8">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Charters · {filtered.length}</p>
        {filtered.length === 0 ? (
          <p className="mt-4 border-t border-line py-6 text-center font-serif italic text-[15px] text-ink-soft">
            No charters yet — every agent-task starts with one.
          </p>
        ) : (
          <ul className="mt-3">
            {filtered.map((c) => (
              <li key={c.id} className="border-t border-line py-4">
                <div className="flex items-center gap-2">
                  <TypeBadge t={c.agent_type} />
                  <StatusPill status={c.status} />
                </div>
                <p className="mt-1.5 font-serif text-[17px] text-ink">{c.objective}</p>
                {c.scope ? <p className="mt-1 font-sans text-[13px] text-ink-soft">{c.scope.slice(0, 200)}{c.scope.length > 200 ? "…" : ""}</p> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    onClick={() => setDrawer(c)}
                    className="rounded-full border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink-soft transition hover:border-ink hover:text-ink"
                  >
                    View
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Drawer */}
      {drawer ? <CharterDrawer charter={drawer} onClose={() => setDrawer(null)} /> : null}
    </div>
  );
}

function CharterDrawer({ charter, onClose }: { charter: Charter; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-t-3xl bg-paper p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Charter · {charter.agent_type}</p>
          <button onClick={onClose} className="font-mono text-[10px] uppercase tracking-wide text-ink-soft">Close</button>
        </div>
        <h2 className="mt-3 font-serif text-2xl text-ink">{charter.objective}</h2>
        <Section label="Scope" body={charter.scope} />
        <Section label="Constraints" body={charter.constraints} />
        <Section label="Success criteria" body={charter.success_criteria} />
        {charter.deliverables && charter.deliverables.length ? (
          <div className="mt-5">
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Deliverables</p>
            <ul className="mt-2 list-inside list-disc font-sans text-[14px] text-ink">
              {charter.deliverables.map((d: any, i: number) => (
                <li key={i}>{typeof d === "string" ? d : d?.description || JSON.stringify(d)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <Section label="Output summary" body={charter.output_summary} />
      </div>
    </div>
  );
}

function Section({ label, body }: { label: string; body: string | null }) {
  if (!body) return null;
  return (
    <div className="mt-5">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{label}</p>
      <p className="mt-2 whitespace-pre-wrap font-serif text-[14px] leading-relaxed text-ink">{body}</p>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[];
}) {
  return (
    <label className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-clay">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent font-mono text-[10px] uppercase tracking-wide text-ink outline-none"
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>{o.l}</option>
        ))}
      </select>
    </label>
  );
}

function CharterComposer({
  entity, onCancel, onSave,
}: {
  entity: string;
  onCancel: () => void;
  onSave: (payload: any) => void;
}) {
  const [type, setType] = useState<Charter["agent_type"]>("research");
  const [objective, setObjective] = useState("");
  const [scope, setScope] = useState("");
  const [constraints, setConstraints] = useState("");
  const [success, setSuccess] = useState("");
  const [deliverables, setDeliverables] = useState("");

  return (
    <div className="rounded-2xl border border-line bg-paper-deep p-4">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">New charter</p>
      <div className="mt-2 flex items-center gap-2">
        <label className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-clay">
          type
          <select value={type} onChange={(e) => setType(e.target.value as Charter["agent_type"])} className="bg-transparent text-ink outline-none">
            {AGENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <Field label="Objective" value={objective} onChange={setObjective} placeholder="What is this agent trying to accomplish?" required />
      <Field label="Scope" value={scope} onChange={setScope} placeholder="Where it may look, what it may touch." rows={2} />
      <Field label="Constraints" value={constraints} onChange={setConstraints} placeholder="What it must not do, or which sources are off-limits." rows={2} />
      <Field label="Success criteria" value={success} onChange={setSuccess} placeholder="How you'll know it worked." rows={2} />
      <Field label="Deliverables (one per line)" value={deliverables} onChange={setDeliverables} placeholder="e.g. A 300-word supplier brief. A ranked list of 5 candidates." rows={3} />

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => objective.trim() && onSave({
            entity_code: entity,
            agent_type: type,
            objective: objective.trim(),
            scope: scope.trim() || null,
            constraints: constraints.trim() || null,
            success_criteria: success.trim() || null,
            deliverables: deliverables.split("\n").map((l) => l.trim()).filter(Boolean).map((description) => ({ description })),
          })}
          className="rounded-full bg-ink px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-paper transition hover:opacity-80"
        >
          Spawn
        </button>
        <button
          onClick={onCancel}
          className="rounded-full border border-line px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink-soft transition hover:border-ink-soft"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, rows = 1, required = false,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; required?: boolean;
}) {
  return (
    <div className="mt-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{label}{required ? " *" : ""}</p>
      {rows > 1 ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className="mt-1 w-full resize-none border-b border-line bg-transparent font-serif text-[15px] text-ink outline-none placeholder:text-clay focus:border-ink"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="mt-1 w-full border-b border-line bg-transparent font-serif text-[15px] text-ink outline-none placeholder:text-clay focus:border-ink"
        />
      )}
    </div>
  );
}
