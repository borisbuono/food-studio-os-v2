import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { getBindings } from "@/lib/integrations/registry";

export const dynamic = "force-dynamic";

const ENTITIES = [
  { code: "IFL", brand: "Ibiza Food Studios", fiscal: "Ibiza Food Lab SL", restaurant_id: "a0000000-0000-4000-8000-000000000001" },
  { code: "BM",  brand: "Bistro Mondo",       fiscal: "Bistrot Mondo SL",  restaurant_id: "fb4d008f-2d2a-4e0d-a525-6e0e36af0259" },
  { code: "BBH", brand: "Holdings",           fiscal: "Boris Buono Holdings SL", restaurant_id: null },
];

export default async function SetupIndex() {
  const sb = supabaseServer();
  const bindings = getBindings();
  const stats = await Promise.all(ENTITIES.map(async (e) => {
    const [{ count: invoices }, { count: bank }, { count: eods }] = await Promise.all([
      sb.from("invoice_inbox").select("id", { count: "exact", head: true }).eq("entity_id", e.code),
      sb.from("bank_movements").select("id", { count: "exact", head: true }).eq("entity_id", e.code),
      e.restaurant_id ? sb.from("eod_reports").select("id", { count: "exact", head: true }).eq("restaurant_id", e.restaurant_id) : Promise.resolve({ count: 0 } as any),
    ]);
    return { ...e, invoices: invoices || 0, bank: bank || 0, eods: eods || 0 };
  }));

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/administrate/finance/dashboard" className="font-mono text-[10px] uppercase tracking-wide text-clay">← finance</Link>
      <h1 className="mt-3 font-serif text-[34px] leading-[1.05] text-ink">Onboard the three companies</h1>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">One readiness page per entity. Open each to see what's wired, what's missing, and how to feed the backlog in.</p>

      <div className="mt-8 space-y-3">
        {stats.map((e) => {
          const b = bindings.find((x) => x.entity === e.code);
          const acctStatus = b?.accounting?.status || "off";
          return (
            <Link key={e.code} href={`/administrate/finance/setup/${e.code}`} className="block rounded-2xl border border-line bg-paper p-5 hover:border-ink-soft">
              <div className="flex items-baseline justify-between">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{e.code}</p>
                  <p className="mt-1 font-serif text-[20px] text-ink">{e.brand}</p>
                  <p className="font-serif italic text-[13px] text-muted">{e.fiscal}</p>
                </div>
                <div className="text-right">
                  <span className={`inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${acctStatus === "connected" ? "border-basil/40 bg-basil/10 text-basil" : "border-tomato/40 bg-tomato/10 text-tomato"}`}>{acctStatus === "connected" ? "Holded live" : "Holded off"}</span>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4">
                <Stat n={e.invoices} label="invoices" />
                <Stat n={e.bank} label="bank rows" />
                <Stat n={e.eods} label="EODs" />
              </div>
            </Link>
          );
        })}
      </div>
    </main>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <p className="font-serif text-[22px] text-ink">{n}</p>
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{label}</p>
    </div>
  );
}
