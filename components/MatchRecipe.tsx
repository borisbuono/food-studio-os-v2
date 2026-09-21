"use client";

// The Recipe column on /studio/money/menu-margin.
// Shows what the dish is linked to and lets Boris change it: pick another
// recipe, unlink a wrong guess, or create an empty recipe named after the
// dish and link it in one click.

import { useState } from "react";
import { useRouter } from "next/navigation";

export type RecipeOption = { id: string; name: string; ing: number };

export default function MatchRecipe({
  rowId,
  currentId,
  currentName,
  componentCount,
  manual,
  recipes,
}: {
  rowId: string;
  currentId: string | null;
  currentName: string | null;
  componentCount: number | null;
  manual: boolean;
  recipes: RecipeOption[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send(body: any) {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/menu-margin/${rowId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setErr(j.error || `failed (${r.status})`);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div>
        {currentName ? (
          <span className="font-serif text-[12px] text-ink-soft">
            {currentName}
            {componentCount ? ` · ${componentCount} comp.` : ""}
            {manual && <span className="ml-1 font-mono text-[9px] uppercase tracking-wide text-clay">set by hand</span>}
          </span>
        ) : (
          <span className="font-mono text-[10px] uppercase tracking-wide text-red-700">no match</span>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="ml-2 font-mono text-[9px] uppercase tracking-wide text-clay underline"
        >
          {currentName ? "change" : "link"}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded border border-black/10 bg-white/70 p-2">
      <select
        defaultValue={currentId ?? ""}
        disabled={busy}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") send({ matched_recipe_id: null });
          else send({ matched_recipe_id: v });
        }}
        className="w-56 rounded border border-black/20 bg-white px-1.5 py-1 font-serif text-[12px] text-ink"
      >
        <option value="">— no recipe —</option>
        {recipes.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name} ({r.ing})
          </option>
        ))}
      </select>
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => send({ create_recipe: true })}
          className="rounded border border-black/20 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-ink hover:border-ink/60 disabled:opacity-50"
        >
          new recipe from this dish
        </button>
        <button
          type="button"
          onClick={() => { setEditing(false); setErr(null); }}
          className="font-mono text-[9px] uppercase tracking-wide text-clay"
        >
          cancel
        </button>
      </div>
      {err && <p className="mt-1 font-serif text-[11px] text-red-700">{err}</p>}
    </div>
  );
}
