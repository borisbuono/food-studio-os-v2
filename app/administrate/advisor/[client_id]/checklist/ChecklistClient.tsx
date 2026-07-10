"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Item = {
  id: string;
  advisory_client_id: string;
  step_key: string;
  label: string;
  hint: string | null;
  status: "todo" | "in_progress" | "done" | "skipped" | "blocked";
  notes: string | null;
  sort_order: number;
};

const STATUSES: [Item["status"], string][] = [
  ["todo",        "todo"],
  ["in_progress", "in progress"],
  ["done",        "done"],
  ["skipped",     "skipped"],
  ["blocked",     "blocked"],
];

const statusChip: Record<Item["status"], string> = {
  todo:        "border-line text-clay",
  in_progress: "border-ochre/40 text-ochre",
  done:        "border-basil/30 text-basil",
  skipped:     "border-line-soft text-clay",
  blocked:     "border-tomato/40 text-tomato",
};

export default function ChecklistClient({ clientId, initialItems }: { clientId: string; initialItems: Item[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(initialItems);
  const [savingId, setSavingId] = useState<string | null>(null);

  async function patch(itemId: string, patch: Partial<Item>) {
    setSavingId(itemId);
    // optimistic
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, ...patch } as Item : it)));
    try {
      const r = await fetch("/api/advisor/checklist/" + itemId, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "save failed");
      // If activation was auto-flipped, refresh so the parent surfaces it.
      if (patch.status === "done" || patch.status === "skipped") router.refresh();
    } catch (e) {
      // rollback — pull from server
      router.refresh();
    }
    setSavingId(null);
  }

  return (
    <section className="mt-8">
      <ul className="divide-y divide-line">
        {items.map((it) => (
          <li key={it.id} className="py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <p className="font-serif text-[17px] text-ink">{it.label}</p>
                {it.hint ? <p className="mt-1 font-serif italic text-[13px] text-ink-soft">{it.hint}</p> : null}
              </div>
              <select
                value={it.status}
                onChange={(e) => patch(it.id, { status: e.target.value as Item["status"] })}
                disabled={savingId === it.id}
                className={"border bg-transparent px-2 py-1 font-mono text-[10px] uppercase tracking-wide " + statusChip[it.status]}
              >
                {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <textarea
              placeholder="notes"
              value={it.notes || ""}
              onChange={(e) => setItems((prev) => prev.map((r) => (r.id === it.id ? { ...r, notes: e.target.value } : r)))}
              onBlur={(e) => patch(it.id, { notes: e.target.value })}
              className="mt-2 w-full border-b border-line bg-transparent px-1 py-1 font-sans text-[13px] text-ink-soft resize-none focus:border-ink focus:outline-none"
              rows={1}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
