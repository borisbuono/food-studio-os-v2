import Link from "next/link";
import Order from "./Order";
import Receiving from "./Receiving";
import Picker from "./Picker";
import TabNav, { pickTab } from "@/components/nav/TabNav";

// /execute/orders — the Supplies landing (slim OS slice 3, audit #20 "goods
// arriving"). Orders · Receiving · Picker as tabs; Scans is the capture
// funnel's own screen (/administrate/finance/scans) and is only linked —
// never rebuilt here. Inventory, suppliers and HACCP temps are leaves.

export const dynamic = "force-dynamic";

const TABS = [
  { key: "orders", label: "Orders" },
  { key: "receiving", label: "Receiving" },
  { key: "picker", label: "Find a product" },
];

export default function SuppliesPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const tab = pickTab(TABS, searchParams?.tab);
  return (
    <div>
      <div className="mx-auto max-w-xl lg:max-w-4xl px-6 pt-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay">Supplies</p>
        <div className="mt-1 flex items-baseline justify-between gap-4">
          <h1 className="font-serif text-3xl text-ink">{tab === "receiving" ? "Receiving" : tab === "picker" ? "Find a product" : "Orders"}</h1>
          <Link href="/administrate/finance/scans" className="font-mono text-[11px] uppercase tracking-wide text-ink-soft hover:text-ink">Scans →</Link>
        </div>
        <TabNav base="/execute/orders" tabs={TABS} active={tab} className="mt-5" />
      </div>
      <div className="[&>main]:pt-4">
        {tab === "receiving" ? <Receiving /> : tab === "picker" ? <Picker /> : <Order />}
      </div>
    </div>
  );
}
