import { redirect } from "next/navigation";
import { entityForHouseSlug, houseNameForSlug } from "@/lib/houses";
import RecipesList from "@/components/RecipesList";

// /h/<slug>/kitchen/recipes — recipes for a house's kitchen. Grouped by
// station, phone-first, matches the prep list surface.

export const dynamic = "force-dynamic";

export default function KitchenRecipesPage({ params }: { params: { house: string; room: string } }) {
  const entity = entityForHouseSlug(params.house);
  if (!entity) redirect("/studio");
  if (params.room !== "kitchen") redirect(`/h/${params.house}`);
  return <RecipesList entityId={entity} houseSlug={params.house} />;
}

export function generateMetadata({ params }: { params: { house: string; room: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Kitchen · Recipes · Food Studios` };
}
