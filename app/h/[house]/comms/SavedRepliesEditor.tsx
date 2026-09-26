"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

export type SavedRow = { id: string; key: string; title: string; lang: string; body: string; sort: number; active: boolean };

const LANGS = ["en", "es", "de", "nl", "fr", "it", "ca"];

export default function SavedRepliesEditor({ entityId, rows: initial }: { entityId: string; rows: SavedRow[] }) {
  const [rows, setRows] = useState<SavedRow[]>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function patch(id: string, p: Partial<SavedRow>) {
    setRows((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  }
  function flash(t: string) { setMsg(t); setTimeout(() => setMsg(null), 2000); }

  async function save(r: SavedRow) {
    setBusy(r.id);
    const { error } = await supabaseBrowser.from("social_saved_replies")
      .update({ key: r.key.trim().toLowerCase(), title: r.title.trim(), lang: r.lang, body: r.body, sort: r.sort, active: r.active })
      .eq("id", r.id);
    setBusy(null);
    flash(error ? error.message : "Saved");
  }
  async function remove(r: SavedRow) {
    setBusy(r.id);
    const { error } = await supabaseBrowser.from("social_saved_replies").delete().eq("id", r.id);
    setBusy(null);
    if (error) return flash(error.message);
    setRows((xs) => xs.filter((x) => x.id !== r.id));
  }
  async function add() {
    setBusy("new");
    const { data, error } = await supabaseBrowser.from("social_saved_replies")
      .insert({ entity_id: entityId, key: `new-${Date.now().toString(36)}`, title: "New reply", lang: "en", body: "", sort: 100, active: false })
      .select("id, key, title, lang, body, sort, active").single();
    setBusy(null);
    if (error) return flash(error.message);
    setRows((xs) => [...xs, data as SavedRow]);
  }

  return (
    <div className="mt-3 space-y-3">
      {rows.map((r) => (
        <div key={r.id} className={"rounded-lg border p-3 " + (r.active ? "border-black/10 bg-paper" : "border-dashed border-black/20 bg-paper-deep")}>
          <div className="flex flex-wrap items-center gap-2">
            <input value={r.key} onChange={(e) => patch(r.id, { key: e.target.value })}
              className="w-24 rounded border border-black/15 bg-white px-2 py-1 font-mono text-xs" placeholder="key" />
            <input value={r.title} onChange={(e) => patch(r.id, { title: e.target.value })}
              className="min-w-0 flex-1 rounded border border-black/15 bg-white px-2 py-1 text-sm" placeholder="Title" />
            <select value={r.lang} onChange={(e) => patch(r.id, { lang: e.target.value })}
              className="rounded border border-black/15 bg-white px-2 py-1 text-xs">
              {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <label className="flex items-center gap-1 text-xs text-clay">
              <input type="checkbox" checked={r.active} onChange={(e) => patch(r.id, { active: e.target.checked })} /> on
            </label>
          </div>
          <textarea value={r.body} onChange={(e) => patch(r.id, { body: e.target.value })} rows={3}
            className="mt-2 w-full rounded border border-black/15 bg-white p-2 text-sm" />
          <div className="mt-2 flex items-center gap-3 text-xs">
            <button onClick={() => save(r)} disabled={busy === r.id}
              className="rounded-md bg-black px-4 py-2 text-white disabled:opacity-40">{busy === r.id ? "Saving…" : "Save"}</button>
            <button onClick={() => remove(r)} disabled={busy === r.id} className="text-clay hover:underline">Delete</button>
          </div>
        </div>
      ))}
      <button onClick={add} disabled={busy === "new"} className="rounded-md border border-black/15 px-4 py-2 text-sm">+ Add a reply</button>
      {msg ? <div className="fixed inset-x-3 bottom-4 z-50 rounded-md bg-black px-4 py-3 text-center text-sm text-white sm:inset-x-auto sm:right-6 sm:w-80">{msg}</div> : null}
    </div>
  );
}
