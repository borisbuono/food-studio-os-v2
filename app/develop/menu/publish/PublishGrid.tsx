"use client";
import { useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { ALLERGEN_KEYS, DIETARY_KEYS, allergenLabel, dietaryLabel } from "@/lib/guest/allergens";

type Row = {
  id: string; name: string; section: string | null; category: string | null;
  price: number | null; published_to_m: boolean;
  allergens: string[] | null; dietary: string[] | null;
  is_eighty_six: boolean | null;
};

export default function PublishGrid({ items }: { items: Row[] }) {
  const [rows, setRows] = useState<Row[]>(items);
  const [busy, setBusy] = useState<string | null>(null);
  const [openTag, setOpenTag] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const grouped = useMemo(() => {
    const filt = rows.filter((r) => !q || (r.name || "").toLowerCase().includes(q.toLowerCase()));
    const map = new Map<string, Row[]>();
    filt.forEach((r) => {
      const key = `${r.category || "food"} · ${r.section || "—"}`;
      map.set(key, [...(map.get(key) || []), r]);
    });
    return Array.from(map.entries());
  }, [rows, q]);

  async function toggle(id: string, next: boolean) {
    setBusy(id);
    const prev = rows;
    setRows(rows.map((r) => r.id === id ? { ...r, published_to_m: next } : r));
    const { error } = await supabaseBrowser.from("menu_items").update({ published_to_m: next }).eq("id", id);
    if (error) setRows(prev);
    setBusy(null);
  }
  async function bulkPublish(ids: string[], next: boolean) {
    setBusy("bulk");
    const prev = rows;
    setRows(rows.map((r) => ids.includes(r.id) ? { ...r, published_to_m: next } : r));
    const { error } = await supabaseBrowser.from("menu_items").update({ published_to_m: next }).in("id", ids);
    if (error) setRows(prev);
    setBusy(null);
  }
  async function saveTags(id: string, allergens: string[], dietary: string[]) {
    setBusy(id);
    const prev = rows;
    setRows(rows.map((r) => r.id === id ? { ...r, allergens, dietary } : r));
    const { error } = await supabaseBrowser.from("menu_items").update({ allergens, dietary }).eq("id", id);
    if (error) setRows(prev);
    setBusy(null);
  }

  return (
    <div className="mt-8">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search item…"
        className="mb-6 w-full rounded border border-line bg-transparent px-3 py-2 font-sans text-sm outline-none focus:border-ink"
      />

      {grouped.length === 0 ? (
        <p className="mt-10 font-serif italic text-ink-soft">No menu items yet — add some in Develop first.</p>
      ) : null}

      {grouped.map(([label, group]) => {
        const allPub = group.every((r) => r.published_to_m);
        const ids = group.map((r) => r.id);
        return (
          <section key={label} className="mt-8">
            <div className="flex items-baseline justify-between border-b border-line pb-2">
              <h3 className="font-sans text-xs font-medium uppercase tracking-wide text-clay">{label} · {group.length}</h3>
              <button
                onClick={() => bulkPublish(ids, !allPub)}
                className="font-mono text-[10.5px] uppercase tracking-wide text-tomato hover:underline"
              >
                {allPub ? "unpublish all" : "publish all"}
              </button>
            </div>
            <ul>
              {group.map((r) => (
                <li key={r.id} className="border-b border-line-soft py-3">
                  <div className="flex items-center gap-4">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={r.published_to_m}
                        disabled={busy === r.id}
                        onChange={(e) => toggle(r.id, e.target.checked)}
                        className="h-4 w-4 accent-black"
                      />
                      <span className="font-serif text-[17px] text-ink">{r.name}</span>
                    </label>
                    <span className="font-mono text-[11px] text-clay">{r.price !== null ? `€${r.price}` : ""}</span>
                    <div className="ml-auto flex items-center gap-3">
                      <span className="font-mono text-[10.5px] text-clay">
                        {(r.allergens || []).length} allergen{(r.allergens || []).length === 1 ? "" : "s"} · {(r.dietary || []).length} diet
                      </span>
                      <button
                        onClick={() => setOpenTag(openTag === r.id ? null : r.id)}
                        className="font-mono text-[10.5px] uppercase tracking-wide text-tomato hover:underline"
                      >
                        {openTag === r.id ? "close" : "tag"}
                      </button>
                    </div>
                  </div>
                  {openTag === r.id ? (
                    <TagEditor row={r} onSave={(a, d) => saveTags(r.id, a, d)} />
                  ) : (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {(r.dietary || []).map((d) => (
                        <span key={"d" + d} className="rounded-full border border-line px-2 py-0.5 font-sans text-[10.5px] text-olive">{dietaryLabel(d, "en")}</span>
                      ))}
                      {(r.allergens || []).map((a) => (
                        <span key={"a" + a} className="rounded-full bg-line-soft px-2 py-0.5 font-sans text-[10.5px] text-ink-soft">{allergenLabel(a, "en")}</span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function TagEditor({ row, onSave }: { row: Row; onSave: (a: string[], d: string[]) => void }) {
  const [a, setA] = useState<string[]>(row.allergens || []);
  const [d, setD] = useState<string[]>(row.dietary || []);
  return (
    <div className="mt-3 rounded border border-line-soft bg-paper-deep/40 p-3">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Allergens</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {ALLERGEN_KEYS.map((k) => {
          const on = a.includes(k);
          return (
            <button
              key={k}
              onClick={() => setA((s) => on ? s.filter((x) => x !== k) : [...s, k])}
              className={"rounded-full border px-2.5 py-0.5 font-sans text-[11px] " + (on ? "border-ink bg-ink text-paper" : "border-line text-ink-soft")}
            >
              {allergenLabel(k, "en")}
            </button>
          );
        })}
      </div>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-clay">Dietary</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {DIETARY_KEYS.map((k) => {
          const on = d.includes(k);
          return (
            <button
              key={k}
              onClick={() => setD((s) => on ? s.filter((x) => x !== k) : [...s, k])}
              className={"rounded-full border px-2.5 py-0.5 font-sans text-[11px] " + (on ? "border-olive bg-olive text-paper" : "border-line text-ink-soft")}
            >
              {dietaryLabel(k, "en")}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex gap-3">
        <button
          onClick={() => onSave(a, d)}
          className="rounded-full bg-ink px-4 py-1.5 font-sans text-[12px] text-paper"
        >
          Save
        </button>
      </div>
    </div>
  );
}
