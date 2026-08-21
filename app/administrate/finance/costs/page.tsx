"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile } from "@/lib/profile";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";
import { noEmoji } from "@/lib/text";

type P = { name: string; item_kind: string; unit_price: number; captured_at: string; supplier: string | null };
type Series = { name: string; kind: string; pts: { d: string; v: number }[]; first: number; last: number; chg: number };
const KIND_LABEL: Record<string, string> = { wine: "Wine", food: "Food & produce", cleaning: "Cleaning & supplies", other: "Other" };
const KIND_ORDER = ["wine", "food", "cleaning", "other"];
const eur = (n: number) => "€" + n.toFixed(2);

function Spark({ pts, w = 120, h = 34 }: { pts: number[]; w?: number; h?: number }) {
  if (pts.length < 2) return <span className="font-mono text-[10px] text-clay">—</span>;
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const step = w / (pts.length - 1);
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 4) - 2).toFixed(1)}`).join(" ");
  const up = pts[pts.length - 1] >= pts[0];
  return <svg width={w} height={h} className={`overflow-visible ${up ? "text-tomato" : "text-basil"}`}><path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" /></svg>;
}

export default function Costs() {
  const [rows, setRows] = useState<P[]>([]);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const p = await getMyProfile();
      const ent = (p && !p.isAdmin ? p.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "bistro_mondo")) || "bistro_mondo";
      const rid = p?.restaurantId || ENTITY_TO_RESTAURANT[ent as EntityKey] || ENTITY_TO_RESTAURANT.bistro_mondo!;
      const { data } = await supabaseBrowser.from("price_history").select("name,item_kind,unit_price,captured_at,supplier").eq("restaurant_id", rid).order("captured_at", { ascending: true });
      setRows((data || []) as P[]); setReady(true);
    })();
  }, []);

  const series = useMemo<Series[]>(() => {
    const by = new Map<string, P[]>();
    rows.forEach((r) => { const k = r.item_kind + "::" + r.name; (by.get(k) || by.set(k, []).get(k)!).push(r); });
    const out: Series[] = [];
    by.forEach((ps, k) => {
      const sorted = ps.slice().sort((a, b) => a.captured_at.localeCompare(b.captured_at));
      const pts = sorted.map((r) => ({ d: r.captured_at, v: Number(r.unit_price) }));
      const first = pts[0].v, last = pts[pts.length - 1].v;
      out.push({ name: sorted[0].name, kind: sorted[0].item_kind, pts, first, last, chg: first ? (last / first - 1) : 0 });
    });
    return out.sort((a, b) => Math.abs(b.chg) - Math.abs(a.chg));
  }, [rows]);

  if (!ready) return <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-12"><p className="font-serif text-2xl text-ink">Loading cost trends…</p></main>;

  return (
    <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-12">
      <Link href="/administrate/finance" className="font-sans text-sm text-ink-soft">← finance</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ink-soft">Costs · price trends</p>
      <h1 className="mt-2 font-serif text-4xl leading-[1.05] text-ink">What we pay, over time</h1>
      <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink-soft">Every cost logged from a delivery note lands here — wine, food, cleaning. Red climbs, green eases. Tap a line to see the points.</p>

      {!series.length ? <p className="mt-8 font-sans text-[14px] text-clay">No price history yet — update costs from a delivery note and the trends build here.</p> : null}

      {KIND_ORDER.filter((k) => series.some((s) => s.kind === k)).map((k) => (
        <section key={k} className="mt-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ink-soft">{KIND_LABEL[k] || k}</p>
          <ul className="mt-2 border-t border-line">
            {series.filter((s) => s.kind === k).map((s) => {
              const up = s.chg >= 0;
              return (
                <li key={s.kind + s.name} className="border-b border-line py-3">
                  <button onClick={() => setOpen(open === s.kind + s.name ? null : s.kind + s.name)} className="flex w-full items-center justify-between gap-3 text-left">
                    <span className="min-w-0"><span className="block truncate font-sans text-[15px] text-ink">{noEmoji(s.name)}</span><span className="font-mono text-[11px] text-clay">{eur(s.last)} · now</span></span>
                    <span className="flex items-center gap-3">
                      <Spark pts={s.pts.map((p) => p.v)} />
                      <span className={`w-14 shrink-0 text-right font-mono text-[12px] tabular-nums ${up ? "text-tomato" : "text-basil"}`}>{up ? "+" : "\u2212"}{Math.abs(Math.round(s.chg * 100))}%</span>
                    </span>
                  </button>
                  {open === s.kind + s.name ? (
                    <div className="mt-3 border-t border-line-soft pt-3">
                      <ul className="space-y-1">
                        {s.pts.slice().reverse().map((p, i) => (
                          <li key={i} className="flex items-baseline justify-between font-mono text-[11px] text-ink-soft"><span>{p.d}</span><span>{eur(p.v)}</span></li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
