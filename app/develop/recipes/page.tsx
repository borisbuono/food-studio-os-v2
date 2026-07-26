import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

// Recipe corpus — the operator's own library of every dish, prep, sub-recipe,
// and imported worksheet. Editorial face on purpose (Fraunces, whitespace),
// no numeric chrome in the cover; the Calculation view carries precision.
export default async function DevelopRecipes() {
  const supabase = supabaseServer();
  const recipes = ((await supabase.from("recipes").select("id,name,section,servings,cost_per_serving_eur,source_import_id").order("name")).data || []) as any[];
  const pending = ((await supabase.from("recipe_imports").select("id,external_ref,status,parsed_json,created_at").in("status", ["parsed","pending"]).order("created_at", { ascending: false }).limit(20)).data || []) as any[];

  return (
    <main className="mx-auto max-w-3xl lg:max-w-5xl px-7 py-16 bg-paper">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-tomato">The corpus</p>
          <h1 className="mt-2 font-serif text-5xl font-light leading-tight text-ink">Every recipe, in one place</h1>
        </div>
        <Link
          href="/develop/recipes/import"
          className="rounded-full bg-ink px-5 py-2.5 font-sans text-[13px] font-medium text-paper transition hover:opacity-90"
        >
          Import
        </Link>
      </div>

      <p className="mt-4 max-w-xl lg:max-w-4xl font-serif text-[19px] font-light italic leading-snug text-ink-soft">
        Paste a recipe. Upload a PDF. Connect the Drive folder. Every dish
        becomes a first-class row — costed, scaled, and ready for the pass.
      </p>

      {pending.length ? (
        <section className="mt-14 border-t border-line pt-8">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-clay">Awaiting review</p>
          <ul className="mt-4 divide-y divide-line">
            {pending.map((p) => (
              <li key={p.id} className="flex items-baseline justify-between gap-4 py-3">
                <Link href={`/develop/recipes/import?resume=${p.id}`} className="flex-1 font-serif text-[18px] text-ink transition hover:opacity-70">
                  {noEmoji(p?.parsed_json?.title || p.external_ref || "Untitled parse")}
                </Link>
                <span className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-clay">{p.status}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-14 border-t border-line pt-8">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.28em] text-clay">The library — {recipes.length} recipe{recipes.length === 1 ? "" : "s"}</p>
        {recipes.length === 0 ? (
          <div className="mt-8 border border-dashed border-line px-8 py-14 text-center">
            <p className="font-serif text-[21px] font-light italic text-ink-soft">Nothing here yet.</p>
            <p className="mt-2 font-sans text-[13px] text-clay">Import your first recipe to begin.</p>
            <Link href="/develop/recipes/import" className="mt-6 inline-block font-mono text-[11px] uppercase tracking-[0.24em] text-tomato">Open the import surface →</Link>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {recipes.map((r) => (
              <li key={r.id}>
                <Link href={`/develop/menu/${r.id}`} className="flex items-baseline justify-between gap-4 py-4 transition hover:opacity-70">
                  <span className="font-serif text-[20px] text-ink">{noEmoji(r.name)}</span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-clay">
                    {r.section || "unfiled"}
                    {r.source_import_id ? <span className="ml-3 text-tomato">imported</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
