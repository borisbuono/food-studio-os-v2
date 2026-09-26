import { redirect } from "next/navigation";
import { houseNameForSlug } from "@/lib/houses";
import { getHouseBySlug } from "@/lib/houses.server";
import RecipeDetail from "@/components/RecipeDetail";
import RecipeEdit from "@/components/merged/menu/RecipeEdit";
import RecipeCosting from "@/components/merged/menu/RecipeCosting";
import TabNav, { pickTab } from "@/components/nav/TabNav";

// /h/<slug>/menu/recipes/[id] — THE recipe page (slim OS slice 2, audit #4/#5).
//   Recipe  — RecipeDetail: editable header + ingredients + method + explode-to-prep;
//             edits land on the canonical, a mirror shows "Edit origin".
//   Edit    — the full form (was /develop/menu/[id]/edit)
//   Costing — the calculation view (was /develop/menu/[id]/calculation)

export const dynamic = "force-dynamic";

const TABS = [
  { key: "recipe", label: "Recipe" },
  { key: "edit", label: "Edit" },
  { key: "cost", label: "Costing" },
];

export default async function MenuRecipePage({ params, searchParams }: { params: { house: string; id: string }; searchParams?: { tab?: string } }) {
  const house = await getHouseBySlug(params.house);
  if (!house) redirect("/studio");
  const tab = pickTab(TABS, searchParams?.tab);
  const base = `/h/${params.house}/menu/recipes/${params.id}`;
  return (
    <div>
      <div className="mx-auto max-w-xl lg:max-w-4xl px-6 pt-6">
        <TabNav base={base} tabs={TABS} active={tab} />
      </div>
      {tab === "edit" ? <RecipeEdit params={{ id: params.id }} houseSlug={params.house} />
        : tab === "cost" ? <div className="mx-auto max-w-xl lg:max-w-4xl px-6"><RecipeCosting params={{ id: params.id }} houseSlug={params.house} /></div>
        : <RecipeDetail entityId={house.id} houseSlug={params.house} recipeId={params.id} />}
    </div>
  );
}

export function generateMetadata({ params }: { params: { house: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Menu · Recipe · Food Studios` };
}
