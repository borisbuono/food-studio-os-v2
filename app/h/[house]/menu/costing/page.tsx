import { redirect } from "next/navigation";
import { houseNameForSlug } from "@/lib/houses";
import { getHouseBySlug } from "@/lib/houses.server";
import Engineering from "@/components/merged/menu/Engineering";
import Repricing from "@/components/merged/menu/Repricing";
import TabNav, { pickTab, MergedShell } from "@/components/nav/TabNav";

// /h/<slug>/menu/costing — ONE price screen for a house (slim OS slice 2,
// audit #5 "cost / price a dish"). Menu engineering + repricing as tabs;
// a single dish is costed on its own recipe page (?tab=cost). The
// cross-house view stays in Studio (/studio/money/menu-margin).

export const dynamic = "force-dynamic";

const TABS = [
  { key: "engineering", label: "Engineering" },
  { key: "repricing", label: "Repricing" },
];

export default async function MenuCostingPage({ params, searchParams }: { params: { house: string }; searchParams?: { tab?: string } }) {
  const house = await getHouseBySlug(params.house);
  if (!house) redirect("/studio");
  const tab = pickTab(TABS, searchParams?.tab);
  const base = `/h/${params.house}/menu/costing`;
  return (
    <MergedShell eyebrow="Menu" title="Costing" wide tabs={<TabNav base={base} tabs={TABS} active={tab} />}>
      {tab === "repricing" ? <Repricing /> : <Engineering houseSlug={params.house} />}
    </MergedShell>
  );
}

export function generateMetadata({ params }: { params: { house: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Menu · Costing · Food Studios` };
}
