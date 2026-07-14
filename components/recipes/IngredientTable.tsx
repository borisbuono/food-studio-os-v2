import { noEmoji } from "@/lib/text";

// The editorial serif + mono ingredient list. Serif names on the left, mono
// quantities on the right, hairline between every row. Used by the detail
// spread AND the scaler view — it just takes the current-scale list.
type Ing = { name: string; quantity?: string | number | null; unit?: string | null };

function fmtQty(q: string | number | null | undefined, unit?: string | null) {
  if (q === null || q === undefined || q === "") return unit || "";
  const n = typeof q === "number" ? q : Number(q);
  if (isFinite(n)) {
    // Whole numbers stay whole; decimals rounded to 1
    const clean = Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n).toString() : (Math.round(n * 10) / 10).toString();
    return unit ? `${clean} ${unit}` : clean;
  }
  return unit ? `${q} ${unit}` : String(q);
}

export default function IngredientTable({ items, label }: { items: Ing[]; label?: string }) {
  if (!items?.length) {
    return (
      <div>
        {label ? <p className="pb-2 border-b border-line font-mono text-[10px] uppercase tracking-[0.1em] text-clay">{label}</p> : null}
        <p className="pt-6 font-serif italic text-[15px] text-clay">No ingredients recorded yet.</p>
      </div>
    );
  }
  return (
    <div>
      {label ? <p className="mb-5 pb-2 border-b border-line font-mono text-[10px] uppercase tracking-[0.1em] text-clay">{label}</p> : null}
      <ul className="font-serif text-[16px] leading-[1.9]">
        {items.map((i, k) => (
          <li key={k} className="flex items-baseline justify-between gap-4 border-b border-line py-1.5">
            <span className="flex-1 text-ink-soft">{noEmoji(i.name)}</span>
            <span className="font-mono text-[12px] tabular-nums tracking-[0.02em] text-clay">{fmtQty(i.quantity, i.unit)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
