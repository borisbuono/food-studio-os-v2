import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";
import { ENTITY_ACCENT, ENTITY_LABEL } from "@/lib/entities";
import RecipeList from "@/components/recipes/RecipeList";

export const dynamic = "force-dynamic";

// The repertoire — recipe list on the develop side. 3-column grid using
// RecipeCard, filter chips by category and venue accent-aware. Ordering:
// has_photo desc → has_tagline desc → title asc (so the strongest visuals lead).
export default async function RepertoirePage() {
  const supabase = supabaseServer();
  const entity = serverEntity();
  const accent = ENTITY_ACCENT[entity];

  const { data } = await supabase
    .from("recipes")
    .select("*")
    .order("name", { ascending: true });
  const recipes = (data || []) as any[];

  // Sort: photo first, tagline second, then alphabetical.
  const ranked = recipes.slice().sort((a, b) => {
    const aPhoto = !!(a.cover_photo_url || a.hero_image_url);
    const bPhoto = !!(b.cover_photo_url || b.hero_image_url);
    if (aPhoto !== bPhoto) return aPhoto ? -1 : 1;
    const aTag = !!a.tagline;
    const bTag = !!b.tagline;
    if (aTag !== bTag) return aTag ? -1 : 1;
    return (a.name || "").localeCompare(b.name || "");
  });

  return (
    <main className="mx-auto max-w-[1400px] bg-paper px-8 py-16" style={{ ["--fs-accent" as any]: accent }}>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.08em] text-clay">Develop · Menu · {ENTITY_LABEL[entity]}</p>
      <h1 className="mb-12 font-serif text-[32px] font-normal tracking-[-0.5px] text-ink">The Repertoire</h1>

      {ranked.length === 0 ? (
        <div className="border-t border-line pt-10 font-serif italic text-[17px] text-clay">
          No recipes recorded yet. Start one from the Chef FAB, or import a set from Drive.
        </div>
      ) : (
        <RecipeList recipes={ranked} venue={entity} />
      )}
    </main>
  );
}
