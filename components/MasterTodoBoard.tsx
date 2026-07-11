"use client";
import { useMemo, useState } from "react";

type Todo = {
  id: string;
  entity_code: string | null;
  source: "pa_orchestrator" | "user_added" | "system_generated" | "from_conversation";
  title: string;
  description: string | null;
  status: "pending" | "in_progress" | "blocked" | "completed" | "deferred";
  priority: number;
  impact_score: number;
  assignee_user_id: string | null;
  due_at: string | null;
  updated_at: string;
};

type Profile = { id: string; name: string | null };

type ViewMode = "all" | "mine" | "impact" | "source";

const SOURCE_LABEL: Record<Todo["source"], string> = {
  pa_orchestrator: "PA",
  user_added: "You",
  system_generated: "Auto",
  from_conversation: "Chat",
};

function fmtDue(s: string | null) {
  if (!s) return "";
  try {
    const d = new Date(s);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  } catch { return ""; }
}

function ImpactChip({ n }: { n: number }) {
  return (
    <span className="font-mono text-[10px] uppercase tracking-wide text-clay">
      impact {"·".repeat(n) || "·"}
    </span>
  );
}

function SourceBadge({ src }: { src: Todo["source"] }) {
  return (
    <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide text-ink-soft">
      {SOURCE_LABEL[src]}
    </span>
  );
}

function StatusPill({ status }: { status: Todo["status"] }) {
  const map: Record<string, string> = {
    pending: "text-clay",
    in_progress: "text-ink",
    blocked: "text-tomato",
    completed: "text-basil",
    deferred: "text-clay italic",
  };
  return <span className={`font-mono text-[10px] uppercase tracking-wide ${map[status] || ""}`}>{status.replace("_", " ")}</span>;
}

export default function MasterTodoBoard({
  entity,
  open,
  done,
  profiles,
  me,
}: {
  entity: string;
  open: Todo[];
  done: Todo[];
  profiles: Profile[];
  me: string | null;
}) {
  const [view, setView] = useState<ViewMode>("impact");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [composerOpen, setComposerOpen] = useState(false);
  const [openList, setOpenList] = useState(open);
  const [doneList, setDoneList] = useState(done);

  const profileName = useMemo(() => new Map(profiles.map((p) => [p.id, p.name || p.id.slice(0, 6)])), [profiles]);

  const filtered = useMemo(() => {
    let list = openList.slice();
    if (view === "mine" && me) list = list.filter((t) => t.assignee_user_id === me);
    if (sourceFilter !== "all") list = list.filter((t) => t.source === sourceFilter);
    if (statusFilter !== "all") list = list.filter((t) => t.status === statusFilter);
    if (assigneeFilter !== "all") list = list.filter((t) => t.assignee_user_id === assigneeFilter);
    // Sort
    if (view === "source") {
      list.sort((a, b) => a.source.localeCompare(b.source) || b.impact_score - a.impact_score);
    } else if (view === "impact" || view === "all" || view === "mine") {
      list.sort((a, b) => b.impact_score - a.impact_score || (a.due_at ? Date.parse(a.due_at) : Infinity) - (b.due_at ? Date.parse(b.due_at) : Infinity));
    }
    return list;
  }, [openList, view, sourceFilter, statusFilter, assigneeFilter, me]);

  async function patch(id: string, body: any) {
    const r = await fetch(`/api/master-todo?id=${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (d.ok && d.todo) {
      if (d.todo.status === "completed" || d.todo.status === "deferred") {
        setOpenList((l) => l.filter((t) => t.id !== id));
        setDoneList((l) => [d.todo, ...l]);
      } else {
        setOpenList((l) => l.map((t) => (t.id === id ? d.todo : t)));
      }
    }
  }

  async function createTodo(payload: any) {
    const r = await fetch("/api/master-todo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await r.json();
    if (d.ok && d.todo) {
      setOpenList((l) => [d.todo, ...l]);
      setComposerOpen(false);
    }
  }

  return (
    <div className="mt-8">
      {/* View toggle */}
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {(["all", "mine", "impact", "source"] as ViewMode[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wide transition ${
              view === v ? "border-ink bg-ink text-paper" : "border-line text-ink-soft hover:border-ink-soft"
            }`}
          >
            {v === "mine" ? "Mine" : v === "impact" ? "By impact" : v === "source" ? "By source" : "All"}
          </button>
        ))}
      </div>

      {/* Filter chips */}
      <div className="mt-3 flex flex-wrap gap-2">
        <FilterSelect
          label="source"
          value={sourceFilter}
          onChange={setSourceFilter}
          options={[
            { v: "all", l: "all sources" },
            { v: "pa_orchestrator", l: "PA" },
            { v: "user_added", l: "You" },
            { v: "system_generated", l: "Auto" },
            { v: "from_conversation", l: "Chat" },
          ]}
        />
        <FilterSelect
          label="status"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { v: "all", l: "any status" },
            { v: "pending", l: "pending" },
            { v: "in_progress", l: "in progress" },
            { v: "blocked", l: "blocked" },
          ]}
        />
        <FilterSelect
          label="assignee"
          value={assigneeFilter}
          onChange={setAssigneeFilter}
          options={[
            { v: "all", l: "anyone" },
            ...(me ? [{ v: me, l: "me" }] : []),
            ...profiles.map((p) => ({ v: p.id, l: p.name || p.id.slice(0, 6) })),
          ]}
        />
      </div>

      {/* Add todo */}
      <div className="mt-6">
        {composerOpen ? (
          <Composer
            entity={entity}
            profiles={profiles}
            me={me}
            onCancel={() => setComposerOpen(false)}
            onSave={createTodo}
          />
        ) : (
          <button
            onClick={() => setComposerOpen(true)}
            className="w-full rounded-2xl border border-dashed border-line py-4 font-mono text-[11px] uppercase tracking-wide text-clay transition hover:border-ink-soft hover:text-ink"
          >
            + Add todo
          </button>
        )}
      </div>

      {/* Open list */}
      <section className="mt-8">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Open · {filtered.length}</p>
        {filtered.length === 0 ? (
          <p className="mt-4 border-t border-line py-6 text-center font-serif italic text-[15px] text-ink-soft">
            Nothing here — the plate is clear.
          </p>
        ) : (
          <ul className="mt-3">
            {filtered.map((t) => (
              <li key={t.id} className="border-t border-line py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <SourceBadge src={t.source} />
                      <StatusPill status={t.status} />
                      <ImpactChip n={t.impact_score} />
                    </div>
                    <p className="mt-1.5 font-serif text-[17px] text-ink">{t.title}</p>
                    {t.description ? <p className="mt-1 font-sans text-[13px] text-ink-soft">{t.description}</p> : null}
                    <p className="mt-1 font-mono text-[10px] text-clay">
                      {t.assignee_user_id ? `assignee · ${profileName.get(t.assignee_user_id) || t.assignee_user_id.slice(0, 6)}` : "unassigned"}
                      {t.due_at ? ` · due ${fmtDue(t.due_at)}` : ""}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {t.status !== "in_progress" ? (
                    <TinyBtn onClick={() => patch(t.id, { status: "in_progress" })}>Start</TinyBtn>
                  ) : null}
                  {t.status !== "blocked" ? (
                    <TinyBtn onClick={() => patch(t.id, { status: "blocked" })}>Block</TinyBtn>
                  ) : null}
                  <TinyBtn onClick={() => patch(t.id, { status: "completed" })}>Complete</TinyBtn>
                  <TinyBtn onClick={() => patch(t.id, { status: "deferred" })}>Defer</TinyBtn>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent done */}
      {doneList.length > 0 ? (
        <section className="mt-10">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Recent · closed</p>
          <ul className="mt-3">
            {doneList.slice(0, 10).map((t) => (
              <li key={t.id} className="border-t border-line py-3 opacity-70">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-serif italic text-[14px] text-ink-soft">{t.title}</p>
                  <StatusPill status={t.status} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function TinyBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full border border-line px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink-soft transition hover:border-ink hover:text-ink"
    >
      {children}
    </button>
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

function Composer({
  entity, profiles, me, onCancel, onSave,
}: {
  entity: string;
  profiles: Profile[];
  me: string | null;
  onCancel: () => void;
  onSave: (payload: any) => void;
}) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [impact, setImpact] = useState(3);
  const [assignee, setAssignee] = useState<string>(me || "");
  const [entityScope, setEntityScope] = useState<string>(entity);
  return (
    <div className="rounded-2xl border border-line bg-paper-deep p-4">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">New todo</p>
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="What needs to happen?"
        className="mt-2 w-full bg-transparent font-serif text-[19px] text-ink outline-none placeholder:text-clay"
      />
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="Notes, context, the why…"
        rows={2}
        className="mt-2 w-full resize-none bg-transparent font-sans text-[13px] text-ink outline-none placeholder:text-clay"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-clay">
          entity
          <select value={entityScope} onChange={(e) => setEntityScope(e.target.value)} className="bg-transparent text-ink outline-none">
            <option value={entity}>{entity}</option>
            <option value="">cross-entity</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-clay">
          impact
          <select value={impact} onChange={(e) => setImpact(Number(e.target.value))} className="bg-transparent text-ink outline-none">
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wide text-clay">
          assignee
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="bg-transparent text-ink outline-none">
            <option value="">unassigned</option>
            {me ? <option value={me}>me</option> : null}
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name || p.id.slice(0, 6)}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => title.trim() && onSave({
            entity_code: entityScope || null,
            title: title.trim(),
            description: desc.trim() || null,
            impact_score: impact,
            assignee_user_id: assignee || null,
            source: "user_added",
          })}
          className="rounded-full bg-ink px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-paper transition hover:opacity-80"
        >
          Add
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
