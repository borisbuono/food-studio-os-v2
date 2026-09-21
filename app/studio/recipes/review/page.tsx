import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { getMyMembershipContext } from "@/lib/memberships";
import ReviewQueue, { type ReviewCard } from "./ReviewQueue";

export const dynamic = "force-dynamic";

// /studio/recipes/review — Boris's queue for the Food Studio AI seed library
// (and any other canonical recipe flagged metadata.needs_boris_review).
// Nothing reaches /recipes/<slug> until it is approved here. Owner-only.

const PAGE = 40;

export default async function RecipeReviewPage({ searchParams }: { searchParams: { cat?: string; q?: string; page?: string } }) {
  const ctx = await getMyMembershipContext();
  if (!ctx.isOwner) redirect("/studio");
  const sb = supabaseServer();

  const cat = (searchParams.cat || "").trim();
  const q = (searchParams.q || "").trim().slice(0, 80);
  const page = Math.max(0, Number(searchParams.page || 0) || 0);

  const base = () => sb.from("recipes")
    .select("id, name, category", { count: "exact" })
    .is("origin_recipe_id", null)
    .eq("is_archived", false)
    .filter("metadata->>needs_boris_review", "eq", "true");

  const { data: allRows, count: total } = await base().limit(2000);
  const byCat = new Map<string, number>();
  for (const r of (allRows || []) as any[]) byCat.set(r.category || "other", (byCat.get(r.category || "other") || 0) + 1);

  let list = sb.from("recipes")
    .select("id, name, category, cuisine, difficulty, prep_minutes, cook_minutes, yield_qty, yield_unit, servings, tagline, story, method, public_slug, allergens, metadata")
    .is("origin_recipe_id", null)
    .eq("is_archived", false)
    .filter("metadata->>needs_boris_review", "eq", "true")
    .order("category", { ascending: true })
    .order("name", { ascending: true })
    .range(page * PAGE, page * PAGE + PAGE - 1);
  if (cat) list = list.eq("category", cat);
  if (q) list = list.ilike("name", `%${q}%`);
  const { data: rows, error } = await list;

  const ids = ((rows || []) as any[]).map((r) => r.id);
  const ingBy = new Map<string, any[]>();
  if (ids.length) {
    const { data: ings } = await sb.from("recipe_ingredients")
      .select("recipe_id, name, ingredient_name, quantity, unit, notes, sort_order")
      .in("recipe_id", ids)
      .order("sort_order", { ascending: true });
    for (const i of (ings || []) as any[]) {
      const a = ingBy.get(i.recipe_id) || []; a.push(i); ingBy.set(i.recipe_id, a);
    }
  }
  const cards: ReviewCard[] = ((rows || []) as any[]).map((r) => ({
    id: r.id, name: r.name, category: r.category, cuisine: r.cuisine, difficulty: r.difficulty,
    prep_minutes: r.prep_minutes, cook_minutes: r.cook_minutes, yield_qty: r.yield_qty, yield_unit: r.yield_unit,
    servings: r.servings, tagline: r.tagline, story: r.story, method: r.method, public_slug: r.public_slug,
    allergens: r.allergens || [], public_candidate: !!r.metadata?.public_candidate,
    drafted_by: r.metadata?.drafted_by || null,
    ingredients: (ingBy.get(r.id) || []).map((i) => ({ name: i.ingredient_name || i.name, quantity: i.quantity, unit: i.unit, notes: i.notes })),
  }));

  const cats = Array.from(byCat.entries()).sort((a, b) => b[1] - a[1]);
  const href = (p: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    const m = { cat, q, ...p } as Record<string, any>;
    for (const [k, v] of Object.entries(m)) if (v !== undefined && v !== "" && !(k === "page" && Number(v) === 0)) u.set(k, String(v));
    const s = u.toString();
    return `/studio/recipes/review${s ? `?${s}` : ""}`;
  };
  const filteredTotal = cat ? byCat.get(cat) || 0 : total || 0;

  return (
    <main className="mx-auto max-w-5xl bg-paper px-5 py-10 sm:px-7">
      <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-tomato">Studio · Recipes</p>
      <h1 className="mt-2 font-serif text-4xl font-light leading-tight text-ink">Review queue</h1>
      <p className="mt-3 max-w-2xl font-serif text-[17px] italic text-ink-soft">
        {total || 0} recipes waiting. Drafted by Food Studio AI — quantities and timings are unchecked until you approve them.
        Approve &amp; publish puts a recipe at /recipes/&lt;slug&gt; under your name; Approve private keeps it in the kitchens only.
      </p>
      {error ? <p className="mt-4 text-[13px] text-tomato">{error.message}</p> : null}

      <nav className="mt-6 flex flex-wrap gap-2">
        <Link href={href({ cat: "", page: 0 })} className={`rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-wide ${!cat ? "border-ink bg-ink text-paper" : "border-line text-ink-soft"}`}>all · {total || 0}</Link>
        {cats.map(([c, n]) => (
          <Link key={c} href={href({ cat: c, page: 0 })} className={`rounded-full border px-3 py-1 font-mono text-[11px] uppercase tracking-wide ${cat === c ? "border-ink bg-ink text-paper" : "border-line text-ink-soft"}`}>
            {c.replace(/-/g, " ")} · {n}
          </Link>
        ))}
      </nav>
      <form action="/studio/recipes/review" className="mt-4 flex gap-2">
        {cat ? <input type="hidden" name="cat" value={cat} /> : null}
        <input name="q" defaultValue={q} placeholder="Search name" className="w-64 rounded-md border border-line bg-white px-3 py-2 text-sm" />
        <button className="rounded-md border border-line px-3 py-2 font-mono text-[11px] uppercase tracking-wide">Search</button>
      </form>

      <ReviewQueue cards={cards} />

      <div className="mt-8 flex items-center justify-between font-mono text-[11px] uppercase tracking-wide text-clay">
        {page > 0 ? <Link href={href({ page: page - 1 })}>← Previous</Link> : <span />}
        <span>Page {page + 1} of {Math.max(1, Math.ceil(filteredTotal / PAGE))}</span>
        {(page + 1) * PAGE < filteredTotal ? <Link href={href({ page: page + 1 })}>Next →</Link> : <span />}
      </div>
    </main>
  );
}
