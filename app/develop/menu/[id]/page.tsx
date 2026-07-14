import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";
import { serverEntity } from "@/lib/serverVenue";
import { ENTITY_ACCENT } from "@/lib/entities";
import AssistantContext from "@/components/AssistantContext";
import RecipeCoverHero from "@/components/recipes/RecipeCoverHero";
import IngredientTable from "@/components/recipes/IngredientTable";
import StepsProse from "@/components/recipes/StepsProse";
import ServingsDrawer from "@/components/recipes/ServingsDrawer";

export const dynamic = "force-dynamic";

// Detail = Creativity face. Two-column magazine spread.
// Left: RecipeCoverHero at spread size.
// Right: eyebrow → 48px headline → italic subhead → prose intro with drop-cap
//        → IngredientTable → StepsProse (with optional asides).
// Floating "Scale" button opens ServingsScaler in a drawer.
export default async function RecipePage({ params }: { params: { id: string } }) {
  const supabase = supabaseServer();
  const entity = serverEntity();
  const accent = ENTITY_ACCENT[entity];

  const r: any = (await supabase.from("recipes").select("*").eq("id", params.id).maybeSingle()).data;
  if (!r) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <Link href="/develop/menu" className="font-sans text-sm text-ink-soft">← the repertoire</Link>
        <p className="mt-8 font-serif text-2xl text-ink">Recipe not found.</p>
      </main>
    );
  }

  const allLines: any[] = (await supabase
    .from("recipe_ingredients")
    .select("name,quantity,unit,sort_order,sub_recipe_id,line_cost")
    .eq("recipe_id", r.id)
    .order("sort_order")).data || [];
  const ings = allLines.filter((i: any) => !i.sub_recipe_id);
  const lex: any = (await supabase.from("lexicon_dishes").select("*").eq("recipe_id", r.id).maybeSingle()).data;
  const dish: any = (await supabase.from("menu_items").select("id,price").eq("recipe_id", r.id).maybeSingle()).data;

  const sec = (r.section || "").toString();
  const category = (r.category || sec).toString();
  const eyebrow = [category ? category.charAt(0).toUpperCase() + category.slice(1) : "Recipe", r.style || null, r.season || null]
    .filter(Boolean).join(" · ");
  const subhead = r.voice_statement || "";
  const story = lex?.cultural_inspiration || lex?.history || lex?.technique_narrative || "";
  const methodSrc = (r.description || "").trim();

  // Steps split by newline first; falls back to sentence-boundary. Each step is a plain
  // paragraph — .aside blocks are opt-in via a "[aside] ..." prefix on any step line.
  let steps: { text: string; aside?: string | null }[] = [];
  if (methodSrc) {
    const raw = methodSrc.includes("\n") ? methodSrc.split(/\n+/) : methodSrc.split(/(?<=[.!?])\s+/);
    let current: { text: string; aside?: string | null } | null = null;
    for (const line of raw.map((s: string) => s.trim()).filter(Boolean)) {
      if (/^\[aside\]/i.test(line)) {
        const text = line.replace(/^\[aside\]\s*/i, "");
        if (current) current.aside = current.aside ? current.aside + " " + text : text;
        continue;
      }
      current = { text: line };
      steps.push(current);
    }
  }
  const allergens: string[] = (r.allergens as string[]) || [];
  const portions = Number(r.portions) > 0 ? Number(r.portions) : null;
  const costPerPortion = r.cost_per_portion != null ? Number(r.cost_per_portion) : null;
  const menuPrice = dish?.price != null ? Number(dish.price) : (r.menu_price != null ? Number(r.menu_price) : null);

  return (
    <main className="bg-paper" style={{ ["--fs-accent" as any]: accent }}>
      <AssistantContext context={{ kind: "recipe", id: r.id, name: r.name, entity, portions, cost_per_portion: costPerPortion }} />

      <div className="mx-auto max-w-[1400px] px-8 pt-6">
        <Link href="/develop/menu" className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay hover:text-ink">← the repertoire</Link>
      </div>

      <section className="mx-auto grid max-w-[1400px] grid-cols-1 gap-14 px-8 pb-24 pt-10 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <RecipeCoverHero recipe={r} venue={entity} size="spread" />
        </div>
        <div className="pt-4">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: accent }}>{eyebrow}</p>
          <h1 className="mb-5 font-serif text-[clamp(36px,5vw,48px)] font-normal leading-[1.05] tracking-[-1px] text-ink">{noEmoji(r.name)}</h1>
          {subhead ? (
            <p className="mb-8 max-w-[90%] font-serif italic text-[20px] leading-[1.4] text-clay">{subhead}</p>
          ) : null}
          {story ? (
            <p className="mb-10 font-serif text-[17px] leading-[1.7] text-ink-soft [&::first-letter]:mr-3 [&::first-letter]:float-left [&::first-letter]:font-serif [&::first-letter]:text-[68px] [&::first-letter]:font-medium [&::first-letter]:leading-[0.9]" style={{ ["--tw-first-letter-color" as any]: accent }}>
              <span style={{ color: "inherit" }}>{story}</span>
            </p>
          ) : null}

          <IngredientTable
            items={ings}
            label={portions ? `Ingredients · for ${portions}` : "Ingredients"}
          />

          {steps.length ? (
            <div className="mt-14">
              <p className="mb-5 border-b border-line pb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-clay">The method</p>
              <StepsProse steps={steps} accent={accent} />
            </div>
          ) : null}

          {allergens.length ? (
            <p className="pt-10 font-mono text-[10px] uppercase tracking-[0.18em] text-clay">Contains · {allergens.join(" · ")}</p>
          ) : null}

          <div className="mt-14 flex flex-wrap items-stretch gap-3 border-t border-line pt-8">
            <Link href={`/execute/cook/${r.id}`} className="flex-1 rounded-sm border border-ink py-4 text-center font-serif italic text-[18px] font-light text-ink transition hover:bg-ink hover:text-paper">Begin Cook Mode</Link>
            <Link href={`/develop/menu/${r.id}/calculation`} className="flex items-center rounded-sm bg-ink px-5 font-mono text-[10px] uppercase tracking-[0.2em] text-paper">Calculation</Link>
            <Link href={`/develop/menu/${r.id}/edit`} className="flex items-center rounded-sm border border-ink/30 px-5 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-soft transition hover:border-ink/60">Edit</Link>
          </div>
        </div>
      </section>

      <ServingsDrawer
        recipeId={r.id}
        recipeName={r.name}
        ingredients={ings.map((i: any) => ({ name: i.name, quantity: i.quantity, unit: i.unit }))}
        baseCovers={portions || 4}
        costPerPax={costPerPortion}
      />
    </main>
  );
}
