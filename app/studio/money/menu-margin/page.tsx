import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { getMyMembershipContext } from "@/lib/memberships";

export const dynamic = "force-dynamic";

// /studio/money/menu-margin — overnight 09-11 build.
//
// Boris asked for a menu-to-recipe cost matcher against the LIVE menus
// (BM_Menu_2026-08-22 + Taller_Menu_2026-08-22) with per-dish margin.
// The source table `menu_dish_costing` is populated from a parse of those
// two markdown files plus fuzzy-matching against the `recipes` catalogue.
//
// Everything on this page tells the honest truth: most dishes on the
// current menu have no ingredient-level cost data yet (cf. memory
// catalogue_has_no_unit_contract, holded_no_ingredient_prices,
// bm_food_draft_lag_explains_month_not_year). Rows without a cost keep
// their sell price but flag "low" confidence and enter the "problem
// dishes" list rather than the margin totals.
//
// Sortable via ?sort=margin (default), ?sort=price, ?sort=name.
// Grouped by venue; per-section subheads within each venue.

type Row = {
  id: string;
  venue: "bm" | "taller";
  section: string | null;
  dish_slug: string;
  dish_name: string;
  sell_price_eur: number | null;
  matched_recipe_id: string | null;
  matched_recipe_name: string | null;
  match_score: number | null;
  component_count: number | null;
  cost_per_portion_eur: number | null;
  gross_margin_eur: number | null;
  gross_margin_pct: number | null;
  cost_confidence: "high" | "medium" | "low";
  missing_components: any;
  computed_at: string;
};

const VENUE_LABEL: Record<string, string> = { bm: "Bistro Mondo", taller: "Taller Sa Penya" };

function eur(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return "€" + n.toFixed(2);
}
function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toFixed(1) + "%";
}

function confidenceBadge(conf: "high" | "medium" | "low") {
  const styles: Record<string, string> = {
    high: "border-emerald-600 text-emerald-800 bg-emerald-50",
    medium: "border-amber-600 text-amber-800 bg-amber-50",
    low: "border-red-600 text-red-800 bg-red-50",
  };
  return (
    <span className={"inline-block rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide " + styles[conf]}>
      {conf}
    </span>
  );
}

function rowClass(r: Row) {
  const hasCost = r.cost_per_portion_eur != null;
  const margin = r.gross_margin_pct;
  if (r.cost_confidence === "low" || !hasCost) return "bg-red-50/60";
  if (margin != null && margin < 60) return "bg-amber-50/60";
  return "";
}

export default async function MenuMarginPage({
  searchParams,
}: {
  searchParams?: { sort?: string; venue?: string };
}) {
  const sb = supabaseServer();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) redirect("/welcome");

  const ctx = await getMyMembershipContext();
  if (!ctx.isOwner && !ctx.isMulti && ctx.memberships.length === 1) {
    const m = ctx.memberships[0];
    if (m.room !== "studio") {
      redirect(`/${m.room === "kitchen" ? "boh" : m.room === "dining" ? "foh" : "office"}`);
    }
  }

  const sort = searchParams?.sort ?? "margin";

  const { data: raw, error } = await sb
    .from("menu_dish_costing")
    .select(
      "id, venue, section, dish_slug, dish_name, sell_price_eur, matched_recipe_id, matched_recipe_name, match_score, component_count, cost_per_portion_eur, gross_margin_eur, gross_margin_pct, cost_confidence, missing_components, computed_at"
    );

  const rows: Row[] = ((raw as Row[] | null) || []).slice();

  // Sort helper — keeps rows without a margin at the bottom regardless of order.
  rows.sort((a, b) => {
    if (a.venue !== b.venue) return a.venue.localeCompare(b.venue);
    if (sort === "price") {
      return (b.sell_price_eur ?? -Infinity) - (a.sell_price_eur ?? -Infinity);
    }
    if (sort === "name") {
      return a.dish_name.localeCompare(b.dish_name);
    }
    // margin: rows without margin sink
    const am = a.gross_margin_pct;
    const bm = b.gross_margin_pct;
    if (am == null && bm == null) return a.dish_name.localeCompare(b.dish_name);
    if (am == null) return 1;
    if (bm == null) return -1;
    return bm - am;
  });

  const byVenue = new Map<string, Row[]>();
  for (const r of rows) {
    const arr = byVenue.get(r.venue) || [];
    arr.push(r);
    byVenue.set(r.venue, arr);
  }

  // Menu-mix weighted margin — weight by sell price when both cost and price
  // are known. Rows without cost are skipped from the numerator and
  // denominator (they contribute nothing but the flag count).
  function venueWeightedMargin(rs: Row[]): { pct: number | null; costedCount: number; total: number } {
    let num = 0;
    let den = 0;
    let costedCount = 0;
    for (const r of rs) {
      if (r.cost_per_portion_eur != null && r.sell_price_eur != null && r.sell_price_eur > 0) {
        const marginEur = r.sell_price_eur - r.cost_per_portion_eur;
        num += marginEur;
        den += r.sell_price_eur;
        costedCount++;
      }
    }
    return { pct: den > 0 ? (100 * num) / den : null, costedCount, total: rs.length };
  }

  const anyComputed = rows[0]?.computed_at ?? null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-4">
        <Link href="/studio/money" className="font-mono text-[10px] uppercase tracking-wide text-clay">
          ← Money
        </Link>
      </div>
      <h1 className="font-serif text-[34px] leading-[1.05] text-ink">Menu margin</h1>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">
        Every dish on the current cards, matched to a recipe in the catalogue, priced
        against Boris's food cost. Amber below 60% margin, red where cost data is
        missing or the recipe hasn't been linked.
      </p>
      {anyComputed && (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">
          Computed {new Date(anyComputed).toLocaleString("en-GB", { timeZone: "Europe/Madrid" })}
        </p>
      )}

      {/* Sort controls */}
      <nav className="mt-6 flex gap-3">
        {[
          { k: "margin", label: "Margin" },
          { k: "price", label: "Price" },
          { k: "name", label: "Name" },
        ].map((s) => (
          <Link
            key={s.k}
            href={`?sort=${s.k}`}
            className={
              "rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-wide " +
              (sort === s.k
                ? "border-ink bg-ink text-paper"
                : "border-black/20 text-ink hover:border-ink/60")
            }
          >
            {s.label}
          </Link>
        ))}
      </nav>

      {error && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 p-3 font-mono text-[11px] text-red-800">
          menu_dish_costing read failed: {error.message}
        </p>
      )}

      {Array.from(byVenue.entries()).map(([venue, vRows]) => {
        const w = venueWeightedMargin(vRows);
        const flagged = vRows.filter(
          (r) => r.cost_confidence === "low" || (r.missing_components && Array.isArray(r.missing_components) && r.missing_components.length > 0)
        ).length;

        return (
          <section key={venue} className="mt-10">
            <div className="flex items-baseline justify-between">
              <h2 className="font-serif text-[22px] text-ink">{VENUE_LABEL[venue] ?? venue}</h2>
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
                {vRows.length} dishes · {w.costedCount} costed · {flagged} flagged
              </p>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-black/20 text-left">
                    <th className="py-2 pr-3 font-mono text-[10px] uppercase tracking-wide text-clay">Section</th>
                    <th className="py-2 pr-3 font-mono text-[10px] uppercase tracking-wide text-clay">Dish</th>
                    <th className="py-2 pr-3 text-right font-mono text-[10px] uppercase tracking-wide text-clay">Sell €</th>
                    <th className="py-2 pr-3 text-right font-mono text-[10px] uppercase tracking-wide text-clay">Cost €</th>
                    <th className="py-2 pr-3 text-right font-mono text-[10px] uppercase tracking-wide text-clay">Margin €</th>
                    <th className="py-2 pr-3 text-right font-mono text-[10px] uppercase tracking-wide text-clay">Margin %</th>
                    <th className="py-2 pr-3 font-mono text-[10px] uppercase tracking-wide text-clay">Recipe</th>
                    <th className="py-2 pr-3 font-mono text-[10px] uppercase tracking-wide text-clay">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {vRows.map((r) => {
                    const missing = Array.isArray(r.missing_components) ? r.missing_components : [];
                    return (
                      <tr key={r.id} className={"border-b border-black/5 align-top " + rowClass(r)}>
                        <td className="py-2 pr-3 font-mono text-[10px] uppercase tracking-wide text-clay">{r.section ?? ""}</td>
                        <td className="py-2 pr-3">
                          <p className="font-serif text-[14px] text-ink">{r.dish_name}</p>
                          {missing.length > 0 && (
                            <p className="mt-1 font-serif italic text-[11px] text-red-700">
                              {missing.map((m: any) => m.note ?? JSON.stringify(m)).join(" · ")}
                            </p>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono text-[13px] text-ink">{eur(r.sell_price_eur)}</td>
                        <td className="py-2 pr-3 text-right font-mono text-[13px] text-ink">{eur(r.cost_per_portion_eur)}</td>
                        <td className="py-2 pr-3 text-right font-mono text-[13px] text-ink">{eur(r.gross_margin_eur)}</td>
                        <td className="py-2 pr-3 text-right font-mono text-[13px] text-ink">{pct(r.gross_margin_pct)}</td>
                        <td className="py-2 pr-3">
                          {r.matched_recipe_name ? (
                            <span className="font-serif text-[12px] text-ink-soft">
                              {r.matched_recipe_name}
                              {r.component_count ? ` · ${r.component_count} comp.` : ""}
                            </span>
                          ) : (
                            <span className="font-mono text-[10px] uppercase tracking-wide text-red-700">no match</span>
                          )}
                        </td>
                        <td className="py-2 pr-3">{confidenceBadge(r.cost_confidence)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-black/30">
                    <td colSpan={5} className="pt-3 font-mono text-[10px] uppercase tracking-wide text-clay">
                      Menu-mix weighted margin (costed dishes only)
                    </td>
                    <td className="pt-3 text-right font-mono text-[14px] text-ink">{pct(w.pct)}</td>
                    <td colSpan={2} className="pt-3 font-mono text-[10px] uppercase tracking-wide text-clay">
                      {w.costedCount} of {w.total} dishes carry a cost
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        );
      })}

      <section className="mt-10 rounded-lg border border-black/10 bg-paper/50 p-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Reading the table</p>
        <ul className="mt-2 list-disc pl-5 font-serif text-[13px] leading-relaxed text-ink-soft">
          <li>
            <b>red row</b> — the dish sits on the menu but there is no matched recipe with a
            usable cost. That is the &quot;62% Aug rev lacks specs&quot; gap, dish by dish.
          </li>
          <li>
            <b>amber row</b> — margin is below 60%. Restaurant benchmarks want 65–75%; below 60% is
            eating into staff and rent.
          </li>
          <li>
            <b>confidence</b> — <i>high</i> means the recipe has costed components with recent
            purchase-line prices; <i>medium</i> leans on hand-entered cost_per_portion; <i>low</i> means
            no reliable cost at all.
          </li>
          <li>
            The Taller tasting menu prints one price for the whole flight, not per course. Rows here
            are the individual courses so cost can be added later — the sell price is blank on
            purpose.
          </li>
          <li>
            Source: <code>menu_dish_costing</code>. Rebuild with the overnight script; the page is
            server-rendered and always shows the current row set.
          </li>
        </ul>
      </section>
    </main>
  );
}
