import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Execute() {
  const tasks = await supabase.from("tasks").select("*", { count: "exact", head: true }).eq("is_active", true).eq("task_type", "cleaning");
  const mep = await supabase.from("mep_dishes").select("*", { count: "exact", head: true }).eq("is_active", true);
  const sops = await supabase.from("haccp_plans").select("*", { count: "exact", head: true });
  const hubs = [
    { title: "Service", items: [
      { href: "/execute/today", label: "Today", blurb: "Clock-in, priority preps, covers, cleaning due." },
      { href: "/execute/briefing", label: "Briefing", blurb: "Who's doing what before service." },
      { href: "/execute/handover", label: "Handover", blurb: "Pass-down for the next shift." },
    ]},
    { title: "Kitchen", items: [
      { href: "/execute/prep", label: "Prep · " + (mep.count ?? 0) + " dishes", blurb: "Mise en place by station, with components." },
      { href: "/execute/cleaning", label: "Cleaning · " + (tasks.count ?? 0), blurb: "Daily & weekly schedule, by station." },
      { href: "/execute/sops", label: "Libro Azul · " + (sops.count ?? 0) + " SOPs", blurb: "HACCP plans that ground the tasks." },
    ]},
    { title: "Stock", items: [
      { href: "/execute/inventory", label: "Inventory", blurb: "What's on hand, what's below reorder." },
      { href: "/execute/receiving", label: "Receiving", blurb: "Recent deliveries and usage." },
      { href: "/order", label: "Order", blurb: "Place an order to a supplier." },
    ]},
    { title: "Front", items: [
      { href: "/execute/bookings", label: "Bookings", blurb: "The book — covers, times, diets." },
      { href: "/schedule", label: "Schedule", blurb: "Weekly rota, FOH / BOH." },
    ]},
  ];
  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <Link href="/" className="font-sans text-sm text-ink-soft">← home</Link>
      <p className="mt-6 font-sans text-xs font-medium text-basil">Execute · service</p>
      <h1 className="mt-2 font-serif text-3xl text-ink">The daily loop</h1>
      <div className="mt-8 space-y-8">
        {hubs.map((h) => (
          <section key={h.title}>
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-basil">{h.title}</p>
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
