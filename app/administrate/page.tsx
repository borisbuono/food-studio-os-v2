import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Administrate() {
  const venues = await supabase.from("restaurants").select("id,name");
  const events = await supabase.from("sales_events").select("*", { count: "exact", head: true });
  const venueList: any[] = venues.data || [];
  const cards = [
    { kicker: "Finance · CFO", title: "The numbers, explained", blurb: "Bank, invoices, food cost — in plain language, when you need it.", soon: true },
    { kicker: "Decisions", title: (events.count ?? 0) + " events in pipeline", blurb: "Surfaced decisions and the events pipeline.", soon: true },
    { kicker: "Team & schedule", title: "Who’s on, when", blurb: "HR, weekly rota, shift zones — one place.", soon: true },
  ];
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ember">Administrate · the house</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Run the business</h1>

      <div className="mt-8 rounded-2xl border border-black/10 bg-card p-6">
        <p className="font-sans text-xs font-medium text-ember">Holdings · temperature check</p>
        <h2 className="mt-1 font-serif text-2xl text-ink">{venueList.length} venues</h2>
        <ul className="mt-3 space-y-1">
          {venueList.map((v: any) => (
            <li key={v.id} className="font-sans text-[15px] text-ink-soft">{v.name}</li>
          ))}
        </ul>
      </div>

      <div className="mt-4 space-y-4">
        {cards.map((c, n) => (
          <div key={n} className="rounded-2xl border border-black/10 bg-card p-6">
            <div className="flex items-center justify-between">
              <p className="font-sans text-xs font-medium text-ember">{c.kicker}</p>
              {c.soon ? <span className="font-mono text-[10px] uppercase tracking-wide text-clay">building next</span> : null}
            </div>
            <h2 className="mt-1 font-serif text-2xl text-ink">{c.title}</h2>
            <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink-soft">{c.blurb}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
