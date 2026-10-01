import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { houseMoney, type House } from "@/lib/houses";
import { mondayOf } from "@/lib/rota/server";

// The header strip on /h/<slug>/menu/costing (rota S4, 2026-10-01): this
// week's labour € and % beside the menu's food cost %. Two numbers a chef
// actually runs the place on, read from the same two engines (fn_rota_week_labour,
// the menu costing run). Server component; nothing recomputed here.

function tzToday(tz: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: tz || "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }

export default async function LabourStrip({ house }: { house: House }) {
  const sb = supabaseServer();
  const week = mondayOf(tzToday(house.timezone));
  const [labourRes, menuRes, weekRes] = await Promise.all([
    sb.rpc("fn_rota_week_labour", { p_entity: house.id, p_week_start: week }),
    house.restaurant_id
      ? sb.from("menu_items").select("price, food_cost_percent_actual, computed_cost").eq("restaurant_id", house.restaurant_id).eq("is_active", true).not("food_cost_percent_actual", "is", null).gt("price", 0)
      : Promise.resolve({ data: [] as any[] }),
    sb.from("rota_weeks").select("budget_eur, budget_pct, forecast_revenue").eq("entity_id", house.id).eq("week_start", week).maybeSingle(),
  ]);
  const l = (Array.isArray(labourRes.data) ? labourRes.data[0] : labourRes.data) as any;
  const items = (menuRes.data || []) as any[];
  // price-weighted food cost % across the costed card
  const priceSum = items.reduce((n, r) => n + Number(r.price || 0), 0);
  const costSum = items.reduce((n, r) => n + Number(r.computed_cost || 0), 0);
  const foodPct = priceSum > 0 ? Math.round((costSum / priceSum) * 1000) / 10 : null;
  const labour = l ? Number(l.labour_eur || 0) : 0;
  const labourPct = l?.labour_pct == null ? null : Number(l.labour_pct);
  const pending = Number(l?.pending || 0);
  const w = weekRes.data as any;
  const budget = w?.budget_eur != null ? Number(w.budget_eur) : w?.budget_pct != null && w?.forecast_revenue != null ? (Number(w.budget_pct) / 100) * Number(w.forecast_revenue) : null;
  const prime = foodPct != null && labourPct != null ? Math.round((foodPct + labourPct) * 10) / 10 : null;
  const teamHref = `/h/${house.slug}/team?tab=labour`;

  return (
    <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl border border-line bg-card px-4 py-3">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay">Food cost</p>
        <p className="font-serif text-2xl text-ink">{foodPct != null ? foodPct + " %" : "—"}</p>
        <p className="font-mono text-[10px] text-clay">{items.length ? items.length + " costed lines" : "no costed lines yet"}</p>
      </div>
      <Link href={teamHref} className="block">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay">Labour this week</p>
        <p className="font-serif text-2xl text-ink">{labourPct != null ? labourPct + " %" : houseMoney(house, labour, 0)}</p>
        <p className="font-mono text-[10px] text-clay">
          {labourPct != null ? houseMoney(house, labour, 0) + (budget != null ? " · budget " + houseMoney(house, budget, 0) : "") : budget != null ? "budget " + houseMoney(house, budget, 0) + " · no revenue yet" : "no budget set"}
          {pending > 0 ? <span className="text-ink"> · {pending} overtime to approve</span> : null}
        </p>
      </Link>
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-clay">Prime cost</p>
        <p className="font-serif text-2xl text-ink">{prime != null ? prime + " %" : "—"}</p>
        <p className="font-mono text-[10px] text-clay">food + labour, of revenue</p>
      </div>
    </div>
  );
}
