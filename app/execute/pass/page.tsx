import ThePass from "./ThePass";
import Metrics from "./Metrics";
import TabNav, { pickTab } from "@/components/nav/TabNav";

// /execute/pass — the pass board (a Service leaf; the wall screen is
// /h/<slug>/pass). Slim OS slice 4 (audit #6): /execute/pass/metrics folded
// in as the Metrics tab.
export const dynamic = "force-dynamic";

const TABS = [{ key: "board", label: "Board" }, { key: "metrics", label: "Metrics" }];

export default function PassPage({ searchParams }: { searchParams?: { tab?: string } }) {
  const tab = pickTab(TABS, searchParams?.tab);
  return (
    <div>
      <div className="mx-auto max-w-xl lg:max-w-4xl px-6 pt-8">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay">Service</p>
        <h1 className="mt-1 font-serif text-3xl text-ink">The Pass</h1>
        <TabNav base="/execute/pass" tabs={TABS} active={tab} className="mt-5" />
      </div>
      <div className="[&>main]:pt-4">{tab === "metrics" ? <Metrics /> : <ThePass />}</div>
    </div>
  );
}
