"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type TemplateItem = {
  id: string;
  template_id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  per_cover: number | null;
  station: string | null;
  sort_order: number;
};

type Template = {
  id: string;
  entity_id: string;
  name: string;
  station: string | null;
  active: boolean;
  applies_days_of_week: number[] | null;
  items: TemplateItem[];
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function PrepTemplates({ entityId, houseSlug }: { entityId: string; houseSlug: string }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newStation, setNewStation] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/prep/templates?entity=${entityId}`, { cache: "no-store" });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "load failed");
      setTemplates(j.templates || []);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { reload(); }, [reload]);

  const createTemplate = useCallback(async () => {
    if (!newName.trim()) return;
    try {
      const res = await fetch(`/api/prep/templates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entity_id: entityId,
          name: newName.trim(),
          station: newStation.trim() || null,
        }),
      });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "create failed");
      setNewName(""); setNewStation("");
      await reload();
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }, [entityId, newName, newStation, reload]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
        {houseSlug.toUpperCase()} · Kitchen · Prep templates
      </p>
      <h1 className="mt-2 font-serif text-3xl">Prep templates</h1>
      <p className="mt-2 font-serif italic text-ink-soft">
        Recurring items. The generator materialises them into the day's prep list based on active flag and weekday.
      </p>

      <section className="mt-6 rounded-md border border-line p-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">New template</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            placeholder="Name (e.g. Weekday lunch prep)"
            value={newName} onChange={(e) => setNewName(e.target.value)}
            className="flex-1 rounded-md border border-line px-3 py-2 text-sm"
          />
          <input
            placeholder="Station (cold, hot, pastry…)"
            value={newStation} onChange={(e) => setNewStation(e.target.value)}
            className="w-full rounded-md border border-line px-3 py-2 text-sm sm:w-56"
          />
          <button
            onClick={createTemplate} disabled={!newName.trim()}
            className="rounded-md bg-ink px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </section>

      {error ? (
        <div className="mt-4 rounded-md border border-tomato/40 bg-tomato/5 px-3 py-2 text-[12px] text-tomato">
          {error}
        </div>
      ) : null}

      <section className="mt-8 space-y-4">
        {loading && templates.length === 0 ? (
          <p className="font-serif italic text-ink-soft">Loading…</p>
        ) : templates.length === 0 ? (
          <p className="font-serif italic text-ink-soft">No templates yet.</p>
        ) : (
          templates.map((t) => (
            <TemplateCard
              key={t.id} template={t}
              open={openId === t.id}
              onToggle={() => setOpenId(openId === t.id ? null : t.id)}
              onChanged={reload}
              onError={setError}
            />
          ))
        )}
      </section>
    </main>
  );
}

function TemplateCard({
  template, open, onToggle, onChanged, onError,
}: {
  template: Template;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [perCover, setPerCover] = useState("");
  const [station, setStation] = useState("");

  const daysLabel = useMemo(() => {
    const d = template.applies_days_of_week;
    if (!d || d.length === 0) return "every day";
    return d.slice().sort().map((n) => DAY_LABELS[n]).join(" ");
  }, [template.applies_days_of_week]);

  const addItem = useCallback(async () => {
    if (!name.trim()) return;
    try {
      const res = await fetch(`/api/prep/templates/${template.id}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          quantity: qty ? Number(qty) : null,
          unit: unit.trim() || null,
          per_cover: perCover ? Number(perCover) : null,
          station: station.trim() || null,
          sort_order: template.items.length,
        }),
      });
      const j = await res.json();
      if (!j?.ok) throw new Error(j?.error || "add failed");
      setName(""); setQty(""); setUnit(""); setPerCover(""); setStation("");
      onChanged();
    } catch (e: any) {
      onError(String(e?.message || e));
    }
  }, [name, qty, unit, perCover, station, template.id, template.items.length, onChanged, onError]);

  return (
    <div className="rounded-md border border-line">
      <button onClick={onToggle} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <div>
          <p className="font-serif text-lg">{template.name}</p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-clay">
            {template.station || "no station"} · {daysLabel} · {template.items.length} items · {template.active ? "active" : "inactive"}
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase text-ink-soft">{open ? "close" : "open"}</span>
      </button>
      {open ? (
        <div className="border-t border-line px-4 pb-4 pt-3">
          {template.items.length === 0 ? (
            <p className="font-serif italic text-[13px] text-ink-soft">No items yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {template.items.map((it) => (
                <li key={it.id} className="flex items-baseline justify-between py-2">
                  <span className="font-serif text-[14px]">{it.name}</span>
                  <span className="font-mono text-[10px] uppercase text-ink-soft">
                    {it.quantity != null ? `${it.quantity} ${it.unit || ""}`.trim() : ""}
                    {it.per_cover != null ? ` · ${it.per_cover}/cover` : ""}
                    {it.station ? ` · ${it.station}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 rounded-md border border-line/60 bg-black/[.02] p-3">
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Add item</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-6">
              <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)}
                     className="col-span-2 rounded-md border border-line px-3 py-2 text-sm" />
              <input placeholder="Qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)}
                     className="rounded-md border border-line px-3 py-2 text-sm" />
              <input placeholder="Unit" value={unit} onChange={(e) => setUnit(e.target.value)}
                     className="rounded-md border border-line px-3 py-2 text-sm" />
              <input placeholder="Per cover" inputMode="decimal" value={perCover} onChange={(e) => setPerCover(e.target.value)}
                     className="rounded-md border border-line px-3 py-2 text-sm" />
              <input placeholder="Station" value={station} onChange={(e) => setStation(e.target.value)}
                     className="rounded-md border border-line px-3 py-2 text-sm" />
              <button onClick={addItem} disabled={!name.trim()}
                      className="col-span-2 rounded-md bg-ink px-3 py-2 text-sm text-white disabled:opacity-50 sm:col-span-6">
                Add
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
