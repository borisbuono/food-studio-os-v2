import { redirect } from "next/navigation";
import { entityForHouseSlug, houseNameForSlug } from "@/lib/houses";
import IngredientAliasesAdmin from "@/components/IngredientAliasesAdmin";

// /h/<slug>/kitchen/ingredients — manage ingredient_aliases. Boris links
// purchase_lines product variants to a canonical name so the recipe
// cost calculator can resolve every ingredient.

export const dynamic = "force-dynamic";

export default function KitchenIngredientsPage({ params, searchParams }: { params: { house: string; room: string }; searchParams?: { prefill?: string } }) {
  const entity = entityForHouseSlug(params.house);
  if (!entity) redirect("/studio");
  if (params.room !== "kitchen") redirect(`/h/${params.house}`);
  return <IngredientAliasesAdmin entityId={entity} houseSlug={params.house} prefill={searchParams?.prefill ?? null} />;
}

export function generateMetadata({ params }: { params: { house: string; room: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Kitchen · Ingredients · Food Studios` };
}
