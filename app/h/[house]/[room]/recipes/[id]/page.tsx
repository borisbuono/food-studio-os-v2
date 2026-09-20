import { redirect } from "next/navigation";
import { houseNameForSlug } from "@/lib/houses";
import { getHouseBySlug } from "@/lib/houses.server";
import RecipeDetail from "@/components/RecipeDetail";

// /h/<slug>/kitchen/recipes/[id] — recipe detail, editable, with the
// "explode to prep" action that materialises tomorrow's prep list from
// this recipe scaled to a covers forecast.

export const dynamic = "force-dynamic";

export default async function KitchenRecipeDetailPage({ params }: { params: { house: string; room: string; id: string } }) {
  const house = await getHouseBySlug(params.house);
  if (!house) redirect("/studio");
  if (params.room !== "kitchen") redirect(`/h/${params.house}`);
  return <RecipeDetail entityId={house.id} houseSlug={params.house} recipeId={params.id} />;
}

export function generateMetadata({ params }: { params: { house: string; room: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Kitchen · Recipe · Food Studios` };
}
