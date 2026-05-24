import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Venue = { id: string; name: string };

export default async function Administrate() {
  const venues: Venue[] = (await supabase.from("restaurants").select("id,name").order("name")).data || [];
  const menuRows = (await supabase.from("menu_items").select("restaurant_id").eq("is_active", true)).data || [];
  const invRows = (await supabase.from("inventory_items").select("restaurant_id")).data || [];
  const zoneRows = (await supabase.from("zones").select("id,restaurant_id")).data || [];
  const taskRows = (await supabase.from("tasks").select("zone_id").eq("is_active", true).eq("task_type", "cleaning")).data || [];
  const events = await supabase.from("sales_events").select("*", { count: "exact", head: true });
  const providersCount = await supabase.from("providers").select("*", { count: "exact", head: true });
  const inbox = await supabase.from("inbox_items").select("*", { count: "exact", head: true });

  const zoneToVenue = new Map<string, string>();
  zoneRows.forEach((z: any) => zoneToVenue.set(z.id, z.restaurant_id));
  const count = (rows: any[], key: string, id: string) => rows.filter((r) => r[key] === id).length;

  const venueStats = venues.map((v) => {
    const menu = count(menuRows, "restaurant_id", v.id);
    const inv = count(invRows, "restaurant_id", v.id);
    const zones = count(zoneRows, "restaurant_id", v.id);
    const cleaning = taskRows.filter((t: any) => zoneToVenue.get(t.zone_id) === v.id).length;
    const flag = menu === 0 ? "Menu not loaded yet" : null;
    return { ...v, menu, inv, zones, cleaning, flag };
  });

  const cards: { kicker: string; title: string; blurb: string; href?: string }[] = [
    { kicker: "Finance · CFO", title: "The numbers, explained", blurb: "Revenue, covers, avg spend — in plain language.", href: "/administrate/finance" },
    { kicker: "Events", title: (events.count ?? 0) + " events", blurb: "Catering & private events pipeline.", href: "/administrate/events" },
    { kicker: "Suppliers", title: (providersCount.count ?? 0) + " suppliers", blurb: "Providers, products & ordering.", href: "/administrate/suppliers" },
    { kicker: "Decisions · inbox", title: (inbox.count ?? 0) + " in inbox", blurb: "What needs a call — with stakeholder voting.", href: "/administrate/decisions" },
    { kicker: "Team & schedule", title: "Who’s on, when", blurb: "HR, weekly rota, shift zones — one place.", href: "/administrate/team" },
    { kicker: "Settings", title: "Connections & skills", blurb: "Integrations and the AI skills (admin).", href: "/administrate/settings" },
    { kicker: "Command center", title: "The control room", blurb: "Flags, entities, accounts, skills, activity.", href: "/command" },
  ];

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ochre">Administrate · the house</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Run the business</h1>

      <p className="mt-8 font-sans text-xs font-medium text-ochre">Holdings · temperature check</p>
      <div className="mt-3 space-y-4">
        {venueStats.map((v) => (
          <div key={v.id} className="rounded-2xl border border-black/10 bg-card p-6">
            <div className="flex items-baseline justify-between">
              <h2 className="font-serif text-2xl text-ink">{v.name}</h2>
              {v.flag ? <span className="font-mono text-[10px] uppercase tracking-wide text-ochre">{v.flag}</span> : <span className="font-mono text-[10px] uppercase tracking-wide text-olive">live</span>}
            </div>
            <div className="mt-4 grid grid-cols-4 gap-3">
              {[
                { n: v.menu, l: "menu" },
                { n: v.cleaning, l: "cleaning" },
                { n: v.inv, l: "inventory" },
                { n: v.zones, l: "zones" },
              ].map((s, i) => (
                <div key={i}>
                  <p className="font-serif text-2xl text-ink">{s.n}</p>
                  <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{s.l}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Link href="/administrate/holdings" className="mt-3 inline-block font-sans text-sm text-ochre">Entity map →</Link>

      <div className="mt-8 space-y-4">
        {cards.map((c, n) => c.href ? (
          <Link key={n} href={c.href} className="block rounded-2xl border border-black/10 bg-card p-6 transition hover:border-ochre/40">
            <p className="font-sans text-xs font-medium text-ochre">{c.kicker}</p>
            <h2 className="mt-1 font-serif text-2xl text-ink">{c.title}</h2>
            <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink-soft">{c.blurb}</p>
          </Link>
        ) : (
          <div key={n} className="rounded-2xl border border-black/10 bg-card p-6">
            <div className="flex items-center justify-between">
              <p className="font-sans text-xs font-medium text-ochre">{c.kicker}</p>
              <span className="font-mono text-[10px] uppercase tracking-wide text-clay">building next</span>
            </div>
            <h2 className="mt-1 font-serif text-2xl text-ink">{c.title}</h2>
            <p className="mt-2 font-sans text-[14px] leading-relaxed text-ink-soft">{c.blurb}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
