import { redirect } from "next/navigation";
import { houseNameForSlug } from "@/lib/houses";
import { getHouseBySlug } from "@/lib/houses.server";
import IngredientAliasesAdmin from "@/components/IngredientAliasesAdmin";

// /h/<slug>/kitchen/ingredients — manage ingredient_aliases. Boris links
// purchase_lines product variants to a canonical name so the recipe
// cost calculator can resolve every ingredient.

export const dynamic = "force-dynamic";

export default async function KitchenIngredientsPage({ params, searchParams }: { params: { house: string; room: string }; searchParams?: { prefill?: string } }) {
  const house = await getHouseBySlug(params.house);
  if (!house) redirect("/studio");
  if (params.room !== "kitchen") redirect(`/h/${params.house}`);
  return <IngredientAliasesAdmin entityId={house.id} houseSlug={params.house} prefill={searchParams?.prefill ?? null} />;
}

export function generateMetadata({ params }: { params: { house: string; room: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Kitchen · Ingredients · Food Studios` };
}
