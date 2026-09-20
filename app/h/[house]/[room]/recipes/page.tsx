import { redirect } from "next/navigation";
import { houseNameForSlug } from "@/lib/houses";
import { getHouseBySlug } from "@/lib/houses.server";
import RecipesList from "@/components/RecipesList";

// /h/<slug>/kitchen/recipes — recipes for a house's kitchen. Grouped by
// station, phone-first, matches the prep list surface.

export const dynamic = "force-dynamic";

export default async function KitchenRecipesPage({ params }: { params: { house: string; room: string } }) {
  const house = await getHouseBySlug(params.house);
  if (!house) redirect("/studio");
  if (params.room !== "kitchen") redirect(`/h/${params.house}`);
  return <RecipesList entityId={house.id} houseSlug={params.house} />;
}

export function generateMetadata({ params }: { params: { house: string; room: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Kitchen · Recipes · Food Studios` };
}
