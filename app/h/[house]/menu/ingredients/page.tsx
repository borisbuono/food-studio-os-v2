import { redirect } from "next/navigation";
import { houseNameForSlug } from "@/lib/houses";
import { getHouseBySlug } from "@/lib/houses.server";
import IngredientAliasesAdmin from "@/components/IngredientAliasesAdmin";

// /h/<slug>/menu/ingredients — manage ingredient_aliases. Boris links
// purchase_lines product variants to a canonical name so the recipe
// cost calculator can resolve every ingredient. (Moved from
// /h/<slug>/kitchen/ingredients in slim OS slice 2 — rooms left the URL.)

export const dynamic = "force-dynamic";

export default async function MenuIngredientsPage({ params, searchParams }: { params: { house: string }; searchParams?: { prefill?: string } }) {
  const house = await getHouseBySlug(params.house);
  if (!house) redirect("/studio");
  return <IngredientAliasesAdmin entityId={house.id} houseSlug={params.house} prefill={searchParams?.prefill ?? null} />;
}

export function generateMetadata({ params }: { params: { house: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Menu · Ingredients · Food Studios` };
}
