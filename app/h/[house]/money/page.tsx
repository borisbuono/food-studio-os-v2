import Link from "next/link";
import { redirect } from "next/navigation";
import { houseNameForSlug } from "@/lib/houses";
import { getHouseBySlug } from "@/lib/houses.server";
import TabNav, { pickTab } from "@/components/nav/TabNav";
import Close from "./Close";
import Reports from "@/components/merged/money/Reports";
import Finance from "@/components/merged/money/Finance";
import Costs from "@/components/merged/money/Costs";
import Variance from "@/components/merged/money/Variance";
import Forecast from "@/components/merged/money/Forecast";
import Payments from "@/components/merged/money/payments/Payments";
import PosSync from "@/components/merged/money/pos-sync/PosSync";
import Integrations from "@/components/merged/money/Integrations";
import FilesInbox from "@/components/merged/money/files-inbox/FilesInbox";
import Invoices from "@/components/merged/money/Invoices";
import { verbWord } from "@/lib/nav/labels";
import { serverLang } from "@/lib/i18nServer";

// /h/<slug>/money — ONE Money landing per house (slim OS slice 3).
//
// The critic's table (#7, #8, #9 + the Money / Integrations / Paper singles)
// folds the office finance screens into tabs here:
//   Close        enter yesterday's close        (was /h/<slug>/office/eod)
//   Reports      EOD reports                    (was /administrate/finance/eod)
//   Finance      how the house is doing         (was /administrate/finance)
//   Costs · Variance · Forecast                 (were /administrate/finance/{costs,variance,forecast})
//   Integrations payments + POS sync + substrate (were …/{payments,pos-sync,integrations})
//   Paper        one document inbox: files triage + missing invoices, linking
//                to the capture funnel's Scans screen (never rebuilt here)
// Reconciliation, anomalies, setup and scans stay as leaves — real screens.
// Studio's portfolio view (/studio/money) is unchanged.
//
// Middleware binds the fs_entity cookie from the slug on every /h/<slug>/*
// request, so the cookie-scoped finance components read THIS house.

export const dynamic = "force-dynamic";

const TABS = [
  { key: "close", label: "Close" },
  { key: "reports", label: "Reports" },
  { key: "finance", label: "Finance" },
  { key: "costs", label: "Costs" },
  { key: "variance", label: "Variance" },
  { key: "forecast", label: "Forecast" },
  { key: "integrations", label: "Integrations" },
  { key: "paper", label: "Paper" },
];

type SP = { tab?: string; by?: string; entity?: string };

export default async function MoneyPage({ params, searchParams }: { params: { house: string }; searchParams?: SP }) {
  const house = await getHouseBySlug(params.house);
  if (!house) redirect("/studio");
  const tab = pickTab(TABS, searchParams?.tab);
  const base = `/h/${params.house}/money`;
  const wide = tab === "integrations" || tab === "paper";
  return (
    <div>
      <div className={`mx-auto ${wide ? "max-w-5xl lg:max-w-6xl xl:max-w-7xl" : "max-w-3xl lg:max-w-4xl"} px-6 pt-8`}>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay">{houseNameForSlug(params.house)} · {verbWord("close", serverLang())}</p>
        <div className="mt-1 flex items-baseline justify-between gap-4">
          <h1 className="font-serif text-3xl text-ink">{TABS.find((t) => t.key === tab)?.label}</h1>
          <span className="flex gap-4 font-mono text-[11px] uppercase tracking-wide text-ink-soft">
            <Link href="/administrate/finance/reconciliation" className="hover:text-ink">Reconciliation</Link>
            <Link href="/administrate/finance/scans" className="hover:text-ink">Scans →</Link>
          </span>
        </div>
        <TabNav base={base} tabs={TABS} active={tab} className="mt-5" />
      </div>
      <div className="[&>main]:pt-4">
        {tab === "reports" ? <Reports />
          : tab === "finance" ? <Finance />
          : tab === "costs" ? <Costs />
          : tab === "variance" ? <Variance searchParams={{ by: searchParams?.by }} base={base} />
          : tab === "forecast" ? <Forecast />
          : tab === "integrations" ? (
            <div className="divide-y divide-black/10">
              <Payments />
              <PosSync searchParams={{ entity: searchParams?.entity }} />
              <Integrations />
            </div>
          )
          : tab === "paper" ? (
            <div>
              <div className="mx-auto max-w-3xl lg:max-w-5xl px-6 pt-4">
                <p className="font-sans text-[14px] text-ink-soft">
                  Invoices and delivery notes arrive through <Link href="/administrate/finance/scans" className="font-semibold text-ink underline">Scans</Link> — one tick per document, pushed to Holded from there. Below: everything else on paper, and what is still missing.
                </p>
              </div>
              <div className="divide-y divide-black/10">
                <FilesInbox />
                <Invoices />
              </div>
            </div>
          )
          : <Close params={{ house: params.house }} />}
      </div>
    </div>
  );
}

export function generateMetadata({ params }: { params: { house: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Money · Food Studios` };
}
