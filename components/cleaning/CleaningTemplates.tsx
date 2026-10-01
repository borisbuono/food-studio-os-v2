"use client";

// CleaningTemplates — the house's cleaning lists, for managers (S1, 2026-10-02).
//
// What Boris owes after the seed is ONE check per list: does it match the
// printed sheet? So every seeded list carries a "needs your check" line and a
// single tap ("Matches the sheet") clears it. Lines are edited as plain text,
// one per line — the same shape as the paper. A temperature line (S2) is
// written as "temp: <equipment> <min>-<max>", e.g. "temp: Nevera pescado 0-4".
// Lists are never deleted; "Off" retires one (its past runs keep the name).

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { resolve, type Lang } from "@/lib/i18nDict";
import type { CleaningTemplate, CleaningTemplateItem } from "@/lib/cleaning/types";
import { WEEKDAYS } from "@/lib/cleaning/types";

type Props = { entityId: string; houseSlug: string; lang: Lang };

const FREQS = ["opening", "daily", "closing", "weekly", "monthly"] as const;

function itemsToText(items: CleaningTemplateItem[]): string {
  return (items || []).map((i) => i.kind === "temp" ? `temp: ${i.equipment || i.label} ${i.min_c ?? ""}-${i.max_c ?? ""}`.trim() : i.label).join("\n");
}
export function textToItems(text: string): CleaningTemplateItem[] {
  const out: CleaningTemplateItem[] = [];
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^temp\s*:\s*(.+?)(?:\s+(-?\d+(?:[.,]\d+)?)\s*(?:-|–|a|to)\s*(-?\d+(?:[.,]\d+)?))?\s*$/i);
    if (m) {
      const eq = m[1].trim();
      const min = m[2] != null ? Number(m[2].replace(",", ".")) : null;
      const max = m[3] != null ? Number(m[3].replace(",", ".")) : null;
      out.push({ label: eq, order: out.length + 1, kind: "temp", equipment: eq, equipment_type: /congel|freez/i.test(eq) ? "freezer" : "fridge", min_c: min, max_c: max });
    } else {
      out.push({ label: line.slice(0, 300), order: out.length + 1 });
    }
  }
  return out;
}

export default function CleaningTemplates({ entityId, houseSlug, lang }: Props) {
  const t = useCallback((k: string) => resolve(k, lang), [lang]);
  const wd = WEEKDAYS[lang === "es" ? "es" : "en"];
  const [list, setList] = useState<CleaningTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);   // template id or "new"
  const [draft, setDraft] = useState<{ name: string; area: string; frequency: string; weekday: number; text: string }>({ name: "", area: "", frequency: "closing", weekday: 1, text: "" });
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await fetch(`/api/cleaning/templates?entity=${entityId}`, { cache: "no-store" });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "load failed");
      setList(j.templates || []);
    } catch (e: any) { setError(String(e?.message || e)); }
  }, [entityId]);
  useEffect(() => { reload(); }, [reload]);

  const patch = useCallback(async (id: string, body: Record<string, unknown>) => {
    setSaving(true); setError(null);
    try {
      const r = await fetch(`/api/cleaning/templates/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "save failed");
      setList((xs) => xs.map((x) => (x.id === id ? j.template : x)));
      return true;
    } catch (e: any) { setError(String(e?.message || e)); return false; }
    finally { setSaving(false); }
  }, []);

  const startEdit = (tpl: CleaningTemplate | null) => {
    if (!tpl) { setEditing("new"); setDraft({ name: "", area: "", frequency: "closing", weekday: 1, text: "" }); return; }
    setEditing(tpl.id);
    setDraft({ name: tpl.name, area: tpl.area || "", frequency: tpl.frequency, weekday: tpl.weekday || 1, text: itemsToText(tpl.items) });
  };

  const save = useCallback(async () => {
    const items = textToItems(draft.text);
    const body = { name: draft.name, area: draft.area || null, frequency: draft.frequency, weekday: draft.frequency === "weekly" ? draft.weekday : null, items };
    if (editing === "new") {
      setSaving(true); setError(null);
      try {
        const r = await fetch(`/api/cleaning/templates`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entity_id: entityId, ...body }) });
        const j = await r.json();
        if (!j?.ok) throw new Error(j?.error || "save failed");
        setList((xs) => [...xs, j.template]);
        setEditing(null);
      } catch (e: any) { setError(String(e?.message || e)); }
      finally { setSaving(false); }
      return;
    }
    if (editing && (await patch(editing, body))) setEditing(null);
  }, [draft, editing, entityId, patch]);

  const when = (tpl: CleaningTemplate) => t("cleaning.shift." + tpl.frequency) + (tpl.frequency === "weekly" && tpl.weekday ? " · " + wd[tpl.weekday] : "");

  return (
    <div className="mx-auto max-w-xl px-4 pb-10 lg:max-w-3xl">
      <div className="flex items-baseline justify-between gap-3 pt-2">
        <Link href={`/h/${houseSlug}/service/cleaning`} className="font-mono text-[12px] uppercase tracking-wide text-ink underline-offset-4 hover:underline">← {t("cleaning.today")}</Link>
        <button type="button" onClick={() => startEdit(null)} className="min-h-[44px] rounded-xl border border-ink px-4 font-mono text-[12px] uppercase tracking-wide text-ink">{t("cleaning.tpl.new")}</button>
      </div>
      <p className="mt-2 text-[13px] text-clay">{t("cleaning.tpl.takes_effect")}</p>
      {error ? <p role="alert" className="mt-3 rounded-xl border border-tomato/40 bg-paper-deep px-3 py-2 text-[14px] text-tomato">{error}</p> : null}

      {editing ? (
        <form className="mt-4 rounded-2xl border border-ink bg-paper p-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <label className="block font-mono text-[11px] uppercase tracking-wide text-clay">{t("cleaning.tpl.name")}
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 font-sans text-[16px] text-ink" />
          </label>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="block font-mono text-[11px] uppercase tracking-wide text-clay">{t("cleaning.tpl.area")}
              <input value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value })} placeholder="Cocina · Sala · Pica" className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 font-sans text-[16px] text-ink" />
            </label>
            <label className="block font-mono text-[11px] uppercase tracking-wide text-clay">{t("cleaning.tpl.frequency")}
              <select value={draft.frequency} onChange={(e) => setDraft({ ...draft, frequency: e.target.value })} className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 font-sans text-[16px] text-ink">
                {FREQS.map((f) => <option key={f} value={f}>{t("cleaning.shift." + f)}</option>)}
              </select>
            </label>
          </div>
          {draft.frequency === "weekly" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <button key={d} type="button" onClick={() => setDraft({ ...draft, weekday: d })} className={"min-h-[40px] rounded-lg border px-3 font-mono text-[12px] " + (draft.weekday === d ? "border-ink bg-ink text-paper" : "border-line text-ink")}>{wd[d].slice(0, 3)}</button>
              ))}
            </div>
          ) : null}
          <label className="mt-3 block font-mono text-[11px] uppercase tracking-wide text-clay">{t("cleaning.tpl.edit")}
            <textarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} rows={Math.min(24, Math.max(6, draft.text.split("\n").length + 1))} className="mt-1 block w-full rounded-lg border border-line bg-paper px-3 py-2 font-sans text-[15px] leading-snug text-ink" />
          </label>
          <p className="mt-1 text-[12px] text-clay">{t("cleaning.tpl.lines_hint")}</p>
          <div className="mt-4 flex gap-3">
            <button type="submit" disabled={saving} className="min-h-[48px] rounded-xl bg-ink px-5 font-mono text-[13px] uppercase tracking-wide text-paper disabled:opacity-40">{t("cleaning.tpl.save")}</button>
            <button type="button" onClick={() => setEditing(null)} className="min-h-[48px] rounded-xl border border-line px-5 font-mono text-[13px] uppercase tracking-wide text-ink">{t("cleaning.tpl.cancel")}</button>
          </div>
        </form>
      ) : null}

      <ul className="mt-4 space-y-3">
        {list.map((tpl) => {
          const review = !!(tpl.metadata as any)?.needs_boris_review;
          return (
            <li key={tpl.id} className={"rounded-2xl border bg-paper p-4 " + (tpl.active ? "border-line" : "border-line-soft opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-serif text-[20px] leading-tight text-ink">{tpl.name}</h3>
                  <p className="font-mono text-[11px] uppercase tracking-wide text-clay">{[tpl.area, when(tpl), `${tpl.items.length} ${lang === "es" ? "líneas" : "lines"}`].filter(Boolean).join(" · ")}</p>
                </div>
                <button type="button" onClick={() => patch(tpl.id, { active: !tpl.active })} className="shrink-0 min-h-[40px] rounded-lg border border-line px-3 font-mono text-[11px] uppercase tracking-wide text-ink">{tpl.active ? t("cleaning.tpl.active") : t("cleaning.tpl.retired")}</button>
              </div>
              {review ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper-deep px-3 py-2">
                  <p className="text-[13px] text-ink-soft">{t("cleaning.tpl.review")}{(tpl.metadata as any)?.review ? ` — ${(tpl.metadata as any).review}` : ""}</p>
                  <button type="button" onClick={() => patch(tpl.id, { reviewed: true })} className="min-h-[40px] rounded-lg bg-ink px-3 font-mono text-[11px] uppercase tracking-wide text-paper">{t("cleaning.tpl.reviewed")}</button>
                </div>
              ) : null}
              <ol className="mt-3 list-decimal space-y-1 pl-6 text-[14px] leading-snug text-ink-soft">
                {tpl.items.slice(0, 6).map((i) => <li key={i.order}>{i.kind === "temp" ? `°C ${i.equipment || i.label}` : i.label}</li>)}
                {tpl.items.length > 6 ? <li className="list-none -ml-6 text-clay">… +{tpl.items.length - 6}</li> : null}
              </ol>
              <button type="button" onClick={() => startEdit(tpl)} className="mt-3 min-h-[44px] rounded-xl border border-ink px-4 font-mono text-[12px] uppercase tracking-wide text-ink">{t("cleaning.tpl.edit")}</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
