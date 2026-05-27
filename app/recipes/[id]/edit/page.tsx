"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

type Ing = { id?: string; name: string; quantity: string; unit: string };

export default function EditRecipe({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [section, setSection] = useState("");
  const [portions, setPortions] = useState("");
  const [pitch, setPitch] = useState("");
  const [method, setMethod] = useState("");
  const [allergens, setAllergens] = useState("");
  const [hero, setHero] = useState("");
  const [ings, setIngs] = useState<Ing[]>([]);
  const originalIds = useRef<string[]>([]);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabaseBrowser.auth.getSession();
      setAuthed(!!s.session);
      const { data: r } = await supabaseBrowser.from("recipes").select("*").eq("id", params.id).maybeSingle();
      if (r) {
        setName(r.name || ""); setSection(r.section || ""); setPortions(r.portions ? String(r.portions) : "");
        setPitch(r.voice_statement || ""); setMethod((r.description || "").trim());
        setAllergens(Array.isArray(r.allergens) ? r.allergens.join(", ") : (r.allergens || ""));
        setHero(r.hero_image_url || "");
      }
      const { data: ig } = await supabaseBrowser.from("recipe_ingredients").select("id,name,quantity,unit,sort_order").eq("recipe_id", params.id).order("sort_order");
      const rows = (ig || []).map((i: any) => ({ id: i.id, name: i.name || "", quantity: i.quantity != null ? String(i.quantity) : "", unit: i.unit || "" }));
      originalIds.current = rows.map((x: any) => x.id);
      setIngs(rows);
      setLoading(false);
    })();
  }, [params.id]);

  const setIng = (k: number, f: keyof Ing, v: string) => setIngs((a) => a.map((x, i) => (i === k ? { ...x, [f]: v } : x)));
  const addIng = () => setIngs((a) => [...a, { name: "", quantity: "", unit: "" }]);
  const rmIng = (k: number) => setIngs((a) => a.filter((_, i) => i !== k));

  const save = async () => {
    if (!authed) { setErr("Sign in to save changes."); return; }
    if (!name.trim()) { setErr("Give the recipe a name."); return; }
    setSaving(true); setErr(null);
    const allergensArr = allergens.split(",").map((s) => s.trim()).filter(Boolean);
    const { error: e1 } = await supabaseBrowser.from("recipes").update({
      name: name.trim(),
      section: section.trim() || null,
      portions: portions.trim() && !isNaN(Number(portions)) ? Number(portions) : null,
      voice_statement: pitch.trim() || null,
      description: method.trim() || null,
      allergens: allergensArr.length ? allergensArr : null,
      hero_image_url: hero.trim() || null,
    }).eq("id", params.id);
    if (e1) { setErr("Couldn't save recipe — " + e1.message); setSaving(false); return; }

    // Ingredients: update existing in place (preserves cost links), insert new, delete removed.
    const cur = ings.filter((i) => i.name.trim());
    const ops: Promise<any>[] = [];
    cur.forEach((i, idx) => {
      if (i.id) ops.push(Promise.resolve(supabaseBrowser.from("recipe_ingredients").update({ name: i.name.trim(), quantity: i.quantity.trim() || null, unit: i.unit.trim() || null, sort_order: idx }).eq("id", i.id)));
    });
    const inserts = cur.map((i, idx) => ({ i, idx })).filter((x) => !x.i.id).map((x) => ({ recipe_id: params.id, name: x.i.name.trim(), quantity: x.i.quantity.trim() || null, unit: x.i.unit.trim() || null, sort_order: x.idx, yield_factor: 1 }));
    if (inserts.length) ops.push(Promise.resolve(supabaseBrowser.from("recipe_ingredients").insert(inserts)));
    const curIds = new Set(cur.filter((i) => i.id).map((i) => i.id));
    const removed = originalIds.current.filter((id) => !curIds.has(id));
    if (removed.length) ops.push(Promise.resolve(supabaseBrowser.from("recipe_ingredients").delete().in("id", removed)));
    const results = await Promise.all(ops);
    const bad: any = results.find((r: any) => r && r.error);
    if (bad) { setErr("Recipe saved; ingredients hit an error — " + bad.error.message); setSaving(false); return; }
    router.push("/recipes/" + params.id);
  };

  if (loading) return <main className="mx-auto max-w-xl px-6 py-12"><p className="font-serif text-2xl text-ink">Loading…</p></main>;

  const field = "w-full rounded-xl border border-black/15 bg-paper px-4 py-3 font-sans text-[15px] text-ink outline-none focus:border-tomato/50";
  const label = "mt-5 mb-1 font-mono text-[10.5px] uppercase tracking-[0.2em] text-clay";
  const mini = "w-16 rounded-xl border border-black/15 bg-paper px-2 py-3 text-center font-sans text-[15px] text-ink outline-none";

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href={"/recipes/" + params.id} className="font-sans text-sm text-ink-soft">← cancel</Link>
      <h1 className="mt-6 font-serif text-3xl text-ink">Edit recipe</h1>
      {authed === false && <p className="mt-3 rounded-xl bg-paper-deep px-4 py-3 font-sans text-[13px] text-tomato">Sign in to save changes — you can still review the fields.</p>}

      <p className={label}>Name</p>
      <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Recipe name" />
      <div className="grid grid-cols-2 gap-3">
        <div><p className={label}>Section</p><input className={field} value={section} onChange={(e) => setSection(e.target.value)} placeholder="e.g. Sauces" /></div>
        <div><p className={label}>Portions (base)</p><input className={field} value={portions} onChange={(e) => setPortions(e.target.value)} inputMode="numeric" placeholder="e.g. 4" /></div>
      </div>

      <p className={label}>One-line pitch</p>
      <input className={field} value={pitch} onChange={(e) => setPitch(e.target.value)} placeholder="The voice statement shown under the title" />

      <p className={label}>Method — one step per line</p>
      <textarea className={field + " min-h-[180px] font-serif text-[16px] leading-relaxed"} value={method} onChange={(e) => setMethod(e.target.value)} placeholder={"One step per line.\nFixes a mis-parsed method."} />

      <p className={label}>Ingredients</p>
      <div className="space-y-2">
        {ings.map((i, k) => (
          <div key={k} className="flex items-center gap-2">
            <input className={field + " flex-1"} value={i.name} onChange={(e) => setIng(k, "name", e.target.value)} placeholder="Ingredient" />
            <input className={mini} value={i.quantity} onChange={(e) => setIng(k, "quantity", e.target.value)} placeholder="qty" />
            <input className={mini} value={i.unit} onChange={(e) => setIng(k, "unit", e.target.value)} placeholder="unit" />
            <button aria-label="remove" onClick={() => rmIng(k)} className="h-9 w-9 shrink-0 rounded-full border border-black/15 font-serif text-[16px] text-ink-soft">×</button>
          </div>
        ))}
      </div>
      <button onClick={addIng} className="mt-2 rounded-full border border-black/15 px-4 h-9 font-sans text-[13px] text-ink-soft">+ add ingredient</button>

      <p className={label}>Allergens (comma-separated)</p>
      <input className={field} value={allergens} onChange={(e) => setAllergens(e.target.value)} placeholder="gluten, dairy, egg" />

      <p className={label}>Photo URL (optional)</p>
      <input className={field} value={hero} onChange={(e) => setHero(e.target.value)} placeholder="https://…" />

      {err && <p className="mt-4 font-sans text-[13px] text-tomato">{err}</p>}

      <button onClick={save} disabled={saving || authed === false} className="mt-7 w-full rounded-2xl bg-ink py-4 font-serif text-[17px] text-paper transition hover:opacity-90 disabled:opacity-30">{saving ? "Saving…" : "Save recipe"}</button>
      <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-wide text-clay">Editing existing ingredients keeps their cost links</p>
    </main>
  );
}
