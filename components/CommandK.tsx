"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const ROUTES: { label: string; href: string }[] = [
  { label: "Home", href: "/" }, { label: "Menu", href: "/menu" }, { label: "Guest menu", href: "/m" },
  { label: "Recipes", href: "/menu" }, { label: "Lexicon", href: "/develop/lexicon" }, { label: "Repricing", href: "/develop/repricing" },
  { label: "Today", href: "/execute/today" }, { label: "Prep", href: "/execute/prep" }, { label: "Cleaning", href: "/execute/cleaning" },
  { label: "SOPs", href: "/execute/sops" }, { label: "Briefing", href: "/execute/briefing" }, { label: "Inventory", href: "/execute/inventory" },
  { label: "Receiving", href: "/execute/receiving" }, { label: "Bookings", href: "/execute/bookings" }, { label: "The Pass", href: "/execute/pass" },
  { label: "Schedule", href: "/administrate/team/schedule" }, { label: "Finance", href: "/administrate/finance" }, { label: "Cash flow", href: "/administrate/cashflow" },
  { label: "Missing invoices", href: "/administrate/invoices" }, { label: "EOD reports", href: "/administrate/finance/eod" },
  { label: "Events", href: "/administrate/events" }, { label: "Suppliers", href: "/administrate/suppliers" }, { label: "Place an order", href: "/execute/orders" },
  { label: "Decisions", href: "/administrate/decisions" }, { label: "Team", href: "/administrate/team" }, { label: "Holdings", href: "/administrate/holdings" },
  { label: "Settings", href: "/administrate/settings" }, { label: "Command center", href: "/command" }, { label: "Onboarding", href: "/onboard" },
  { label: "Profile", href: "/account" },
];

export default function CommandK() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = ROUTES.filter((r) => r.label.toLowerCase().includes(q.toLowerCase()));
  const go = (href: string) => { setOpen(false); setQ(""); router.push(href); };

  return (
    <>
      <button onClick={() => setOpen(true)} className="font-mono text-[11px] uppercase tracking-wide text-clay hover:text-ink-soft">search</button>
      {open ? (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/20 px-6 pt-24" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Go to…" className="w-full border-b border-black/10 bg-card px-4 py-3 font-sans text-[15px] text-ink outline-none" />
            <ul className="max-h-72 overflow-y-auto py-1">
              {results.map((r) => (
                <li key={r.href}>
                  <button onClick={() => go(r.href)} className="block w-full px-4 py-2 text-left font-sans text-[14px] text-ink-soft hover:bg-paper hover:text-ink">{r.label}</button>
                </li>
              ))}
              {!results.length ? <li className="px-4 py-3 font-sans text-[13px] text-clay">No matches.</li> : null}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
