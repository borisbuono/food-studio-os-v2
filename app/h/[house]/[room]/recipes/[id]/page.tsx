import { redirect } from "next/navigation";
import { entityForHouseSlug, houseNameForSlug } from "@/lib/houses";
import RecipeDetail from "@/components/RecipeDetail";

// /h/<slug>/kitchen/recipes/[id] — recipe detail, editable, with the
// "explode to prep" action that materialises tomorrow's prep list from
// this recipe scaled to a covers forecast.

export const dynamic = "force-dynamic";

export default function KitchenRecipeDetailPage({ params }: { params: { house: string; room: string; id: string } }) {
  const entity = entityForHouseSlug(params.house);
  if (!entity) redirect("/studio");
  if (params.room !== "kitchen") redirect(`/h/${params.house}`);
  return <RecipeDetail entityId={entity} houseSlug={params.house} recipeId={params.id} />;
}

export function generateMetadata({ params }: { params: { house: string; room: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Kitchen · Recipe · Food Studios` };
}
