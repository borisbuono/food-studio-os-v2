import { noEmoji } from "@/lib/text";

// The precision face — hairline table, tabular-nums throughout, sticky
// right-column summary with a big-number cost per portion. Green/red alert
// depending on FC% vs target. Allergen + dietary chips underneath.
type Line = {
  name: string;
  quantity?: string | number | null;
  unit?: string | null;
  unit_cost?: number | null;
  unit_cost_basis?: string | null; // e.g. "€8.50 / kg"
  line_cost: number;
};

export default function CalculationBreakdown({
  title,
  subtitle,
  lines,
  totalCost,
  menuPrice,
  targetFcPct,
  allergens,
  dietary,
  accent,
}: {
  title: string;
  subtitle?: string | null;
  lines: Line[];
  totalCost: number;
  menuPrice: number | null;
  targetFcPct?: number | null; // e.g. 28
  allergens?: string[];
  dietary?: string[];
  accent?: string;
}) {
  const acc = accent || "var(--fs-accent, #9A3122)";
  const target = targetFcPct ?? 28;
  const fcPct = menuPrice && menuPrice > 0 ? (totalCost / menuPrice) * 100 : null;
  const margin = menuPrice && menuPrice > 0 ? menuPrice - totalCost : null;
  const linesTotal = lines.reduce((a, l) => a + Number(l.line_cost || 0), 0) || totalCost;

  return (
    <div>
      <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.08em] text-clay">Develop · Menu · Calculation</p>
      <h1 className="mb-10 font-serif text-[32px] font-normal tracking-[-0.5px] text-ink">
        {title}
        {subtitle ? <em className="ml-2 font-serif italic text-[20px] font-normal text-clay">— {subtitle}</em> : null}
      </h1>

      <div className="grid grid-cols-1 gap-14 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <table className="w-full border-collapse font-sans text-[14px] tabular-nums">
            <thead>
              <tr>
                <th className="border-b border-ink py-2 pr-2 text-left font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-clay">Ingredient</th>
                <th className="border-b border-ink py-2 pl-2 text-right font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-clay">Qty</th>
                <th className="border-b border-ink py-2 pl-2 text-right font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-clay">Unit cost</th>
                <th className="border-b border-ink py-2 pl-2 text-right font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-clay">Line cost</th>
                <th className="border-b border-ink py-2 pl-2 text-right font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-clay">% of total</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, k) => {
                const pct = linesTotal > 0 ? (l.line_cost / linesTotal) * 100 : 0;
                const qtyText = [l.quantity, l.unit].filter(Boolean).join(" ");
                return (
                  <tr key={k}>
                    <td className="border-b border-line py-2.5 pr-2 font-serif text-[15px] text-ink-soft">{noEmoji(l.name)}</td>
                    <td className="border-b border-line py-2.5 pl-2 text-right text-ink-soft">{qtyText || "—"}</td>
                    <td className="border-b border-line py-2.5 pl-2 text-right text-ink-soft">{l.unit_cost_basis || (l.unit_cost != null ? `€${Number(l.unit_cost).toFixed(2)}` : "—")}</td>
                    <td className="border-b border-line py-2.5 pl-2 text-right text-ink-soft">€{Number(l.line_cost).toFixed(2)}</td>
                    <td className="border-b border-line py-2.5 pl-2 text-right text-ink-soft">{pct.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="border-t border-ink py-3.5 pr-2 font-medium text-ink">Total cost per portion</td>
                <td className="border-t border-ink py-3.5 pl-2 text-right font-medium text-ink">€{Number(totalCost).toFixed(2)}</td>
                <td className="border-t border-ink py-3.5 pl-2 text-right font-medium text-ink">100.0%</td>
              </tr>
            </tfoot>
          </table>

          {(allergens?.length || dietary?.length) ? (
            <div className="mt-10">
              <p className="mb-3 border-b border-line pb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-clay">Allergens · dietary</p>
              <div className="flex flex-wrap gap-2 pt-3">
                {(allergens || []).map((a) => (
                  <span key={"a-" + a} className="border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-clay">{a}</span>
                ))}
                {(dietary || []).map((d) => (
                  <span key={"d-" + d} className="border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-clay">{d}</span>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <aside className="self-start bg-paper-deep p-8 lg:sticky lg:top-24">
          <div className="flex items-baseline justify-between border-b border-line py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-clay">Cost / portion</span>
            <span className="font-serif text-[36px] tabular-nums text-ink">€{Number(totalCost).toFixed(2)}</span>
          </div>
          <div className="flex items-baseline justify-between border-b border-line py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-clay">Menu price</span>
            <span className="font-serif text-[24px] tabular-nums text-ink">{menuPrice != null ? `€${Number(menuPrice).toFixed(2)}` : "—"}</span>
          </div>
          <div className="flex items-baseline justify-between border-b border-line py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-clay">Food cost %</span>
            <span className="font-serif text-[24px] tabular-nums" style={{ color: acc }}>{fcPct != null ? `${fcPct.toFixed(1)}%` : "—"}</span>
          </div>
          <div className="flex items-baseline justify-between border-b border-line py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-clay">Target FC%</span>
            <span className="font-serif text-[18px] tabular-nums text-clay">{target}%</span>
          </div>
          <div className="flex items-baseline justify-between py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-clay">Gross margin</span>
            <span className="font-serif text-[24px] tabular-nums text-olive">{margin != null ? `€${margin.toFixed(2)}` : "—"}</span>
          </div>
          {fcPct != null ? (
            fcPct <= target ? (
              <div className="mt-4 border border-olive/60 bg-olive/5 px-4 py-3 font-serif italic text-[14px] text-olive">
                Running {(target - fcPct).toFixed(1)} pp under target. This is a winner. Consider promoting.
              </div>
            ) : (
              <div className="mt-4 border border-tomato/60 bg-tomato/5 px-4 py-3 font-serif italic text-[14px] text-tomato">
                Running {(fcPct - target).toFixed(1)} pp over target. Trim cost or nudge the price.
              </div>
            )
          ) : null}
        </aside>
      </div>
    </div>
  );
}
