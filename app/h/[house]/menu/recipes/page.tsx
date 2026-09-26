import { redirect } from "next/navigation";
import { houseNameForSlug } from "@/lib/houses";
import { getHouseBySlug } from "@/lib/houses.server";
import RecipesList from "@/components/RecipesList";

// /h/<slug>/menu/recipes — THE recipe list for a house (slim OS slice 2).
// The four lists of the IA audit (#3) collapse here: filters all / mine /
// shared / public / draft, mirror badges from the shared recipe layer.
// Studio keeps only /studio/recipes/review (the owner queue).

export const dynamic = "force-dynamic";

export default async function MenuRecipesPage({ params }: { params: { house: string } }) {
  const house = await getHouseBySlug(params.house);
  if (!house) redirect("/studio");
  return <RecipesList entityId={house.id} houseSlug={params.house} />;
}

export function generateMetadata({ params }: { params: { house: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Menu · Recipes · Food Studios` };
}
