import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabaseServer";
import { MiniMarkdown } from "@/lib/recipes/miniMarkdown";
import PrintButton from "./PrintButton";

// Two jobs on one route (Next can't have /recipes/[id] and /recipes/[slug]):
//  * UUID  → transitional redirect to /develop/menu/<id> (signed-in, kept
//            until 2027-01-08 per the 2026-07-08 fold).
//  * slug  → PUBLIC recipe page, no sign-in (Boris ruling 2026-09-21: recipes
//            produced by Food Studio AI are public). Middleware lets only
//            non-UUID single-segment /recipes/<slug> through anon. Data comes
//            from the SECURITY DEFINER RPC public_recipe_by_slug, which only
//            returns canonical rows that are is_public AND reviewed by Boris.

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PublicRecipe = {
  slug: string; name: string; tagline: string | null; story: string | null; description: string | null;
  method: string | null; category: string | null; cuisine: string | null; difficulty: number | null;
  prep_minutes: number | null; cook_minutes: number | null; yield_qty: number | null; yield_unit: string | null;
  servings: number | null; hero_image_url: string | null; allergens: string[] | null; updated_at: string | null;
  ingredients: { name: string; quantity: string | null; unit: string | null; notes: string | null; optional: boolean | null }[];
};

async function load(slug: string): Promise<PublicRecipe | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 120) return null;
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("public_recipe_by_slug", { p_slug: slug });
  if (error || !data) return null;
  return data as PublicRecipe;
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  if (UUID.test(params.id)) return { title: "Recipe · Food Studios" };
  const r = await load(params.id);
  if (!r) return { title: "Recipe not found · Food Studio" };
  return {
    title: `${r.name} · Boris Buono · Food Studio`,
    description: r.tagline || r.story || undefined,
    openGraph: { title: r.name, description: r.tagline || undefined, images: r.hero_image_url ? [r.hero_image_url] : undefined },
  };
}

const DIFF = ["", "Basic", "Easy", "Intermediate", "Advanced", "Expert"];
const fmtMin = (m: number | null) => (m == null ? null : m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`);

export default async function Page({ params }: { params: { id: string } }) {
  if (UUID.test(params.id)) redirect(`/develop/menu/${params.id}`);
  const r = await load(params.id);
  if (!r) notFound();

  const meta = [
    r.prep_minutes != null ? `Prep ${fmtMin(r.prep_minutes)}` : null,
    r.cook_minutes ? `Cook ${fmtMin(r.cook_minutes)}` : null,
    r.yield_qty != null ? `Makes ${Number(r.yield_qty)} ${r.yield_unit || ""}`.trim() : null,
    r.servings ? `Serves ${r.servings}` : null,
    r.difficulty ? DIFF[r.difficulty] || null : null,
  ].filter(Boolean) as string[];

  return (
    <main className="min-h-screen bg-paper text-ink print:bg-white">
      <style>{`@media print { .no-print { display: none !important } body { background: #fff } }`}</style>
      <article className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-tomato">
          {[r.category?.replace(/-/g, " "), r.cuisine].filter(Boolean).join(" · ") || "Recipe"}
        </p>
        <h1 className="mt-3 font-serif text-4xl font-light leading-tight sm:text-5xl">{r.name}</h1>
        {r.tagline ? <p className="mt-3 font-serif text-[19px] italic text-ink-soft">{r.tagline}</p> : null}
        <p className="mt-4 font-sans text-[13px] text-clay">By Boris Buono · Food Studio AI</p>

        {r.hero_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={r.hero_image_url} alt={r.name} className="mt-8 w-full rounded-sm object-cover print:max-h-72" />
        ) : null}

        {r.story ? <p className="mt-8 max-w-2xl font-serif text-[18px] font-light leading-relaxed">{r.story}</p> : null}

        {meta.length ? (
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 border-y border-line py-4 font-mono text-[11px] uppercase tracking-[0.18em] text-clay">
            {meta.map((m) => <li key={m}>{m}</li>)}
          </ul>
        ) : null}

        <div className="mt-10 grid gap-10 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] print:grid-cols-[2fr_3fr]">
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.28em] text-clay">Ingredients</h2>
            <ul className="mt-4 divide-y divide-line">
              {r.ingredients.map((i, k) => (
                <li key={k} className="flex items-baseline justify-between gap-4 py-2 font-sans text-[15px]">
                  <span>
                    {i.name}
                    {i.optional ? <span className="text-clay"> (optional)</span> : null}
                    {i.notes ? <span className="block text-[12px] text-clay">{i.notes}</span> : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-ink-soft">{[i.quantity, i.unit].filter(Boolean).join(" ")}</span>
                </li>
              ))}
            </ul>
            {r.allergens?.length ? (
              <p className="mt-4 font-sans text-[12px] text-clay">Allergens: {r.allergens.join(", ")}</p>
            ) : null}
          </section>
          <section>
            <h2 className="font-mono text-[11px] uppercase tracking-[0.28em] text-clay">Method</h2>
            <MiniMarkdown source={r.method || r.description} className="font-sans text-[15px] leading-relaxed" />
          </section>
        </div>

        <footer className="mt-16 flex items-center justify-between border-t border-line pt-6 font-sans text-[12px] text-clay">
          <span>Food Studio · Ibiza</span>
          <PrintButton />
        </footer>
      </article>
    </main>
  );
}
