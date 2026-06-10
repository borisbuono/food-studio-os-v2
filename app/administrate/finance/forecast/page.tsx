import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverRestaurantId } from "@/lib/serverVenue";

export const dynamic = "force-dynamic";
const eur = (n: number) => "€" + Math.round(n).toLocaleString("en-GB");
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

type Point = { date: string; rev: number; kind: "actual" | "forecast" };

export default async function Forecast() {
  
  const supabase = supabaseServer();const rid = serverRestaurantId();
  const eod = (await supabase.from("eod_reports").select("report_date,revenue,actual_covers,revenue_labour").eq("restaurant_id", rid).order("report_date", { ascending: true })).data || [];

  if (!eod.length) {
    return (
      <main className="mx-auto max-w-xl px-6 py-12">
        <Link href="/administrate/finance" className="font-sans text-sm text-ink-soft">← the numbers</Link>
        <h1 className="mt-6 font-serif text-3xl text-ink">Forecast</h1>
        <p className="mt-3 font-sans text-[15px] text-clay">No end-of-day reports yet to forecast from.</p>
      </main>
    );
  }

  const venueName = (await supabase.from("restaurants").select("name").eq("id", rid).maybeSingle()).data?.name || "the venue";

  // Past 28 days actuals
  const days28 = 28;
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const cutoff = new Date(today); cutoff.setUTCDate(cutoff.getUTCDate() - days28);
  const past = eod.filter((e: any) => new Date(e.report_date) >= cutoff).map((e: any) => ({ date: e.report_date, rev: Number(e.revenue || 0), kind: "actual" as const }));

  // Day-of-week seasonality: average revenue per weekday across the available history
  const dowAvg = new Map<number, { sum: number; n: number }>();
  eod.forEach((e: any) => {
    const dow = new Date(e.report_date).getUTCDay();
    const cur = dowAvg.get(dow) || { sum: 0, n: 0 };
    cur.sum += Number(e.revenue || 0); cur.n += 1;
    dowAvg.set(dow, cur);
  });
  const baseByDow = (d: number) => { const v = dowAvg.get(d); return v && v.n ? v.sum / v.n : 0; };

  // Recent trend: last 14d vs prior 14d
  const last14 = eod.slice(-14).reduce((a, e: any) => a + Number(e.revenue || 0), 0);
  const prior14 = eod.slice(-28, -14).reduce((a, e: any) => a + Number(e.revenue || 0), 0);
  const trend = prior14 ? clamp((last14 / prior14 - 1), -0.2, 0.2) : 0;

  // Forecast next 28 days
  const forecast: Point[] = [];
  for (let i = 1; i <= 28; i++) {
    const d = new Date(today); d.setUTCDate(d.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const base = baseByDow(d.getUTCDay());
    forecast.push({ date: iso, rev: base * (1 + trend), kind: "forecast" });
  }

  const series: Point[] = [...past, ...forecast];
  const maxRev = Math.max(...series.map((p) => p.rev), 1);
  const w = 700, h = 200, padL = 36, padR = 12, padT = 16, padB = 26;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const xFor = (i: number) => padL + (i / (series.length - 1)) * innerW;
  const yFor = (v: number) => padT + innerH - (v / maxRev) * innerH;

  // Build paths for actual and forecast portions separately so we can render different strokes
  const actuals = past.map((p, i) => ({ p, i }));
  const fxStart = past.length; // index of first forecast point
  const path = (pts: { p: Point; i: number }[]) => pts.length ? pts.map((x, k) => (k === 0 ? "M" : "L") + xFor(x.i).toFixed(1) + " " + yFor(x.p.rev).toFixed(1)).join(" ") : "";
  const actualPath = path(actuals);
  const forecastPath = path(forecast.map((p, k) => ({ p, i: fxStart + k })));

  // Totals
  const last28Actual = past.reduce((a, p) => a + p.rev, 0);
  const next28Forecast = forecast.reduce((a, p) => a + p.rev, 0);
  const change = last28Actual ? Math.round((next28Forecast / last28Actual - 1) * 100) : 0;
  const labourBudget = next28Forecast * 0.30;

  // y-axis tick marks (4 ticks)
  const ticks = [0.25, 0.5, 0.75, 1].map((f) => maxRev * f);
  // dim every Monday for visual rhythm
  const mondayIdx: number[] = [];
  series.forEach((p, i) => { if (new Date(p.date).getUTCDay() === 1) mondayIdx.push(i); });

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/administrate/finance" className="font-sans text-sm text-ink-soft">← the numbers</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ink-soft">Forecast · last 28d ↔ next 28d</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">{venueName}</h1>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-black/10 bg-card p-5">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Last 28 days · actual</p>
          <p className="mt-1 font-serif text-3xl text-ink">{eur(last28Actual)}</p>
        </div>
        <div className="rounded-2xl border border-black/10 bg-card p-5">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Next 28 days · projected</p>
          <p className="mt-1 font-serif text-3xl text-ink">{eur(next28Forecast)}</p>
          <p className="mt-1 font-mono text-[11px]" style={{ color: change >= 0 ? "#5A6B3B" : "#B8552E" }}>{change >= 0 ? "▲" : "▼"} {Math.abs(change)}% vs the 28 just past</p>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-black/10 bg-card p-4">
        <svg viewBox={"0 0 " + w + " " + h} width="100%" height={h}>
          {/* y grid */}
          {ticks.map((tv, i) => (
            <g key={i}>
              <line x1={padL} x2={w - padR} y1={yFor(tv)} y2={yFor(tv)} stroke="rgba(0,0,0,0.06)" strokeWidth="1" />
              <text x={padL - 6} y={yFor(tv) + 3} textAnchor="end" className="fill-clay" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "9px" }}>{"€" + Math.round(tv).toLocaleString("en-GB")}</text>
            </g>
          ))}
          {/* monday markers */}
          {mondayIdx.map((i, k) => (
            <line key={"m" + k} x1={xFor(i)} x2={xFor(i)} y1={padT} y2={h - padB} stroke="rgba(0,0,0,0.04)" strokeDasharray="2 3" />
          ))}
          {/* today divider */}
          <line x1={xFor(fxStart - 0.5)} x2={xFor(fxStart - 0.5)} y1={padT} y2={h - padB} stroke="var(--accent)" strokeOpacity="0.45" strokeDasharray="3 3" />
          <text x={xFor(fxStart - 0.5)} y={padT - 4} textAnchor="middle" className="fill-clay" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "9px" }}>today</text>
          {/* actual line */}
          <path d={actualPath} stroke="var(--accent)" strokeWidth="1.8" fill="none" />
          {/* forecast line */}
          <path d={forecastPath} stroke="var(--accent)" strokeWidth="1.5" fill="none" strokeDasharray="4 3" strokeOpacity="0.7" />
          {/* day labels - sparse */}
          {series.filter((_, i) => i % 7 === 0).map((p, k) => {
            const i = k * 7;
            const lbl = new Date(p.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
            return <text key={"x" + k} x={xFor(i)} y={h - 8} textAnchor="middle" className="fill-clay" style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "9px" }}>{lbl}</text>;
          })}
        </svg>
        <p className="mt-2 font-mono text-[10px] text-clay">solid = actual EOD revenue · dashed = projection from weekday seasonality × recent trend ({trend >= 0 ? "+" : ""}{Math.round(trend * 100)}%)</p>
      </div>

      <div className="mt-6 rounded-2xl border border-black/10 bg-card p-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Labour budget · next 28 days @ 30%</p>
        <p className="mt-1 font-serif text-2xl text-ink">{eur(labourBudget)}</p>
        <p className="mt-1 font-sans text-[13px] text-ink-soft">Hold the schedule to this and margin stays where it should.</p>
      </div>

      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Trend = last 14d revenue vs prior 14d, clamped ±20% · seasonality = average revenue by weekday across all EOD on file</p>
    </main>
  );
}
