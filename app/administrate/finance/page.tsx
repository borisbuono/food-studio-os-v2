import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverRestaurantId } from "@/lib/serverVenue";

export const dynamic = "force-dynamic";

const eur = (n: number) => "€" + Math.round(n).toLocaleString("en-GB");

export default async function Finance() {
  
  const supabase = supabaseServer();const rid = serverRestaurantId();
  const venues = (await supabase.from("restaurants").select("id,name").order("name")).data || [];
  const reports = (await supabase.from("eod_accounting").select("restaurant_id,report_date,actual_covers,revenue,revenue_food,revenue_wine,revenue_bar").order("report_date", { ascending: false })).data || [];
  const byVenue = venues.map((v: any) => ({ ...v, rs: reports.filter((r: any) => r.restaurant_id === v.id) })).filter((x: any) => x.rs.length);

  // Engine-as-signal: biggest recent cost moves on this venue's purchases
  const since = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString();
  const prices = (await supabase.from("price_history")
    .select("item_id,name,unit,unit_price,supplier,captured_at,item_kind")
    .gte("captured_at", since)
    .order("captured_at", { ascending: false })
    .limit(500)).data || [];
  const byItem: Record<string, any[]> = {};
  prices.forEach((r: any) => {
    const key = r.item_id || r.name;
    if (!byItem[key]) byItem[key] = [];
    byItem[key].push(r);
  });
  const moves = Object.values(byItem).map((rows) => {
    const sorted = rows.sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime());
    const latest = sorted[0], prior = sorted[sorted.length - 1];
    if (!prior || Number(prior.unit_price) === 0) return null;
    const pct = ((Number(latest.unit_price) - Number(prior.unit_price)) / Number(prior.unit_price)) * 100;
    return { name: latest.name, supplier: latest.supplier, kind: latest.item_kind, latest: Number(latest.unit_price), prior: Number(prior.unit_price), unit: latest.unit, pct };
  }).filter((m): m is NonNullable<typeof m> => m !== null && Math.abs(m.pct) >= 5)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, 5);

  return (
    <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-12">
      <nav aria-label="Finance sections" className="mt-4 mb-4 flex flex-wrap gap-x-5 gap-y-2 border-b border-line pb-3 font-mono text-[11px] uppercase tracking-wide"><a href="/administrate/finance/setup" className="text-ink hover:text-clay">⚙ Setup / Connect</a><a href="/administrate/finance/scans" className="text-ink-soft hover:text-clay">Invoices</a><a href="/administrate/finance/reconciliation" className="text-ink-soft hover:text-clay">Bank</a><a href="/administrate/finance/eod" className="text-ink-soft hover:text-clay">EOD</a><a href="/administrate/finance/pos-sync" className="text-ink-soft hover:text-clay">POS sync</a><a href="/administrate/finance/anomalies" className="text-ink-soft hover:text-clay">Anomalies</a><a href="/administrate/finance/integrations" className="text-ink-soft hover:text-clay">Substrate</a><a href="/administrate/chef-log" className="text-ink-soft hover:text-clay">Chef-log</a></nav>
      {/* FINANCE_NAV_INJECTED */}
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>The numbers · what to react to</p>
      <h1 className="mt-2 font-serif text-4xl leading-tight text-ink">How the house is doing</h1>
      <p className="mt-2 font-sans text-[14px] text-ink-soft">The engine runs out of sight. Below are only the signals that actually want a call.</p>
      <Link href="/administrate/finance/dashboard" className="mt-4 inline-block font-mono text-[11px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>Operational dashboard →</Link>

      {/* Signals — react-to */}
      {moves.length > 0 ? (
        <section className="mt-7">
          <p className="font-sans text-xs font-medium text-clay">Costs that moved</p>
          <p className="mt-1 font-sans text-[12px] text-ink-soft">From your invoices, last 30 days. ≥5% move surfaces here.</p>
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {moves.map((m, i) => {
              const up = m.pct > 0;
              return (
                <li key={i} className="py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-sans text-[14px] text-ink">{m.name}</span>
                    <span className={"font-mono text-[12px] " + (up ? "text-tomato" : "text-basil")}>{up ? "+" : "\u2212"}{Math.abs(m.pct).toFixed(1)}%</span>
                  </div>
                  <p className="mt-0.5 font-sans text-[11px] leading-snug text-ink-soft">€{m.prior.toFixed(2)} → €{m.latest.toFixed(2)} per {m.unit} · {m.supplier || ""} · {up && Math.abs(m.pct) >= 10 ? "Worth a call or a switch." : "Within normal."}</p>
                </li>
              );
            })}
          </ul>
          <Link href="/administrate/finance/costs" className="mt-3 inline-block font-sans text-sm" style={{ color: "var(--accent)" }}>All cost trends →</Link>
        </section>
      ) : (
        <p className="mt-7 font-sans text-[13px] text-clay">No notable cost moves in the last 30 days.</p>
      )}

      {/* The EOD topline per venue */}
      {byVenue.map((v: any) => {
        const latest = v.rs[0], prev = v.rs[1];
        const rev = Number(latest.revenue || 0);
        const cov = Number(latest.actual_covers || 0);
        const avg = cov ? rev / cov : 0;
        const prevRev = prev ? Number(prev.revenue || 0) : 0;
        const delta = prevRev ? Math.round((rev / prevRev - 1) * 100) : null;
        const deltaWord = delta === null ? "" : delta >= 0 ? `up ${delta}% vs prior period` : `down ${Math.abs(delta)}% vs prior period`;
        return (
          <section key={v.id} className="mt-8">
            <div className="border-y border-line py-6">
              <div className="flex items-baseline justify-between">
                <h2 className="font-serif text-2xl text-ink">{v.name}</h2>
                <span className="font-mono text-[11px] text-clay">{latest.report_date}</span>
              </div>
              <p className="mt-3 font-serif text-4xl text-ink">{eur(rev)}</p>
              <p className="mt-1 font-sans text-[14px] text-ink-soft">{cov.toLocaleString("en-GB")} covers · {eur(avg)} avg spend{deltaWord ? " · " + deltaWord : ""}</p>
              <div className="mt-4 grid grid-cols-3 gap-3">
                {[["Food", latest.revenue_food], ["Wine", latest.revenue_wine], ["Bar", latest.revenue_bar]].map(([l, n]: any, i: number) => (
                  <div key={i}><p className="font-serif text-xl text-ink">{eur(Number(n || 0))}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">{l}</p></div>
                ))}
              </div>
            </div>
            {v.rs.length > 1 ? (
              <ul className="divide-y divide-line-soft">
                {v.rs.slice(1, 6).map((r: any, i: number) => (
                  <li key={i} className="flex items-baseline justify-between py-2">
                    <span className="font-mono text-[12px] text-clay">{r.report_date}</span>
                    <span className="font-sans text-[14px] text-ink-soft">{eur(Number(r.revenue || 0))} · {Number(r.actual_covers || 0).toLocaleString("en-GB")} cov</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
      {!byVenue.length ? <p className="mt-8 font-sans text-[14px] text-clay">No end-of-day reports yet.</p> : null}

      {/* The Numbers tiles — promoted (Boris 2026-06-01) from a footer strip to proper tiles */}
      <section className="mt-10">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Go deeper</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link href="/administrate/finance/costs" className="block border-t border-line py-5 pr-4 transition hover:border-ink/40">
            <h3 className="font-serif text-xl text-ink">Cost trends</h3>
            <p className="mt-1 font-sans text-[13px] text-ink-soft">Every product you buy, charted from your invoices — dearer or cheaper, at a glance.</p>
          </Link>
          <Link href="/administrate/finance/eod" className="block border-t border-line py-5 pr-4 transition hover:border-ink/40">
            <h3 className="font-serif text-xl text-ink">EOD reports</h3>
            <p className="mt-1 font-sans text-[13px] text-ink-soft">Each night's close — covers, revenue, food/wine/bar split. The trace of the house.</p>
          </Link>
          <Link href="/administrate/finance/variance" className="block border-t border-line py-5 pr-4 transition hover:border-ink/40">
            <h3 className="font-serif text-xl text-ink">Variance</h3>
            <p className="mt-1 font-sans text-[13px] text-ink-soft">What the recipes said you should use vs what stock actually moved — by recipe and by ingredient.</p>
          </Link>
          <Link href="/administrate/finance/forecast" className="block border-t border-line py-5 pr-4 transition hover:border-ink/40">
            <h3 className="font-serif text-xl text-ink">Forecast</h3>
            <p className="mt-1 font-sans text-[13px] text-ink-soft">Where the next month likely lands, fused with how the last month actually went.</p>
          </Link>
          <Link href="/administrate/invoices" className="block border-t border-line py-5 pr-4 transition hover:border-ink/40">
            <h3 className="font-serif text-xl text-ink">Missing invoices &amp; notes</h3>
            <p className="mt-1 font-sans text-[13px] text-ink-soft">What we delivered without paper — and what to chase, with status of the conversation.</p>
          </Link>
        </div>
      </section>
    </main>
  );
}
