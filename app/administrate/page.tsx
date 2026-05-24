import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
type Venue = { id: string; name: string };

export default async function Administrate() {
  const venues: Venue[] = (await supabase.from("restaurants").select("id,name").order("name")).data || [];
  const invCounts: Record<string, number> = {};
  for (const v of venues) { invCounts[v.id] = (await supabase.from("inventory_items").select("*", { count: "exact", head: true }).eq("restaurant_id", v.id)).count ?? 0; }
  const menuRows = (await supabase.from("menu_items").select("restaurant_id").eq("is_active", true)).data || [];
  const zoneRows = (await supabase.from("zones").select("id,restaurant_id")).data || [];
  const taskRows = (await supabase.from("tasks").select("zone_id").eq("is_active", true).eq("task_type", "cleaning")).data || [];
  const events = await supabase.from("sales_events").select("*", { count: "exact", head: true });
  const providersCount = await supabase.from("providers").select("*", { count: "exact", head: true });
  const inbox = await supabase.from("inbox_items").select("*", { count: "exact", head: true });

  const zoneToVenue = new Map<string, string>();
  zoneRows.forEach((z: any) => zoneToVenue.set(z.id, z.restaurant_id));
  const count = (rows: any[], key: string, id: string) => rows.filter((r) => r[key] === id).length;
  const venueStats = venues.map((v) => ({
    ...v,
    menu: count(menuRows, "restaurant_id", v.id),
    inv: invCounts[v.id] ?? 0,
    zones: count(zoneRows, "restaurant_id", v.id),
    cleaning: taskRows.filter((t: any) => zoneToVenue.get(t.zone_id) === v.id).length,
    flag: count(menuRows, "restaurant_id", v.id) === 0 ? "Menu not loaded yet" : null,
  }));

  const hubs = [
    { title: "Money", items: [
      { href: "/administrate/finance", label: "Finance · CFO", blurb: "Revenue, cashflow, invoices, EOD, variance, forecast." },
      { href: "/trial", label: "The engine · Restaurant Utopia", blurb: "Live costing + theoretical-vs-actual variance." },
    ]},
    { title: "Sales", items: [
      { href: "/administrate/events", label: "Events · " + (events.count ?? 0), blurb: "Catering & private events pipeline." },
      { href: "/administrate/suppliers", label: "Suppliers · " + (providersCount.count ?? 0), blurb: "Providers & products." },
      { href: "/order", label: "Place an order", blurb: "Build and send a supplier order." },
    ]},
    { title: "People", items: [
      { href: "/administrate/team", label: "Team", blurb: "HR roster and roles." },
      { href: "/schedule", label: "Schedule", blurb: "Weekly rota, FOH / BOH." },
    ]},
    { title: "The group", items: [
      { href: "/administrate/holdings", label: "Holdings · entity map", blurb: "The structure, venue by venue." },
      { href: "/command", label: "Command centre", blurb: "Flags, accounts, skills, activity." },
      { href: "/administrate/decisions", label: "Decisions · " + (inbox.count ?? 0) + " in inbox", blurb: "What needs a call." },
      { href: "/administrate/settings", label: "Settings", blurb: "Connections and AI skills." },
    ]},
  ];

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-ochre">Administrate · the house</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">Run the business</h1>

      <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.18em] text-ochre">Holdings · temperature check</p>
      <div className="mt-2 space-y-3">
        {venueStats.map((v) => (
          <div key={v.id} className="rounded-2xl border border-black/10 bg-card p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-serif text-xl text-ink">{v.name}</h2>
              {v.flag ? <span className="font-mono text-[10px] uppercase tracking-wide text-ochre">{v.flag}</span> : <span className="font-mono text-[10px] uppercase tracking-wide text-olive">live</span>}
            </div>
            <div className="mt-3 grid grid-cols-4 gap-3">
              {[{ n: v.menu, l: "menu" }, { n: v.cleaning, l: "cleaning" }, { n: v.inv, l: "inventory" }, { n: v.zones, l: "zones" }].map((s, i) => (
                <div key={i}><p className="font-serif text-xl text-ink">{s.n}</p><p className="font-mono text-[10px] uppercase tracking-wide text-clay">{s.l}</p></div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 space-y-8">
        {hubs.map((h) => (
          <section key={h.title}>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-ochre">{h.title}</p>
            <div className="mt-2 divide-y divide-black/10 overflow-hidden rounded-2xl border border-black/10 bg-card">
              {h.items.map((i) => (
                <Link key={i.href} href={i.href} className="block px-5 py-4 transition hover:bg-paper-deep">
                  <h2 className="font-serif text-[19px] text-ink">{i.label}</h2>
                  <p className="mt-0.5 font-sans text-[13px] text-ink-soft">{i.blurb}</p>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
