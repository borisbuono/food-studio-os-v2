import { redirect } from "next/navigation";
import { houseNameForSlug } from "@/lib/houses";
import { getHouseBySlug } from "@/lib/houses.server";
import Engineering from "@/components/merged/menu/Engineering";
import Repricing from "@/components/merged/menu/Repricing";
import Margin from "@/components/merged/menu/Margin";
import LabourStrip from "@/components/merged/menu/LabourStrip";
import TabNav, { pickTab, MergedShell } from "@/components/nav/TabNav";
import { verbWord } from "@/lib/nav/labels";
import { serverLang } from "@/lib/i18nServer";

// /h/<slug>/menu/costing — ONE price screen for a house (slim OS slice 2,
// audit #5 "cost / price a dish"). Menu engineering + repricing as tabs;
// a single dish is costed on its own recipe page (?tab=cost). The
// cross-house view stays in Studio (/studio/money/menu-margin).
// Menu-first loop (2026-10-01): the Margin tab is the default — every line of
// the printed menu, bound to its recipe, costed, worst first.

export const dynamic = "force-dynamic";

const TABS = [
  { key: "margin", label: "Margin" },
  { key: "engineering", label: "Engineering" },
  { key: "repricing", label: "Repricing" },
];

export default async function MenuCostingPage({ params, searchParams }: { params: { house: string }; searchParams?: { tab?: string } }) {
  const house = await getHouseBySlug(params.house);
  if (!house) redirect("/studio");
  const tab = pickTab(TABS, searchParams?.tab);
  const base = `/h/${params.house}/menu/costing`;
  return (
    <MergedShell eyebrow={verbWord("cook", serverLang())} title="Costing" wide tabs={<TabNav base={base} tabs={TABS} active={tab} />}>
      {/* rota S4 (2026-10-01): labour % sits beside food cost % — the margin page carries both */}
      <LabourStrip house={house} />
      {tab === "repricing" ? <Repricing /> : tab === "engineering" ? <Engineering houseSlug={params.house} /> : <Margin entityId={house.id} houseSlug={params.house} />}
    </MergedShell>
  );
}

export function generateMetadata({ params }: { params: { house: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Menu · Costing · Food Studios` };
}
