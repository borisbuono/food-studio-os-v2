"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";

export const dynamic = "force-dynamic";

type Guest = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  allergies: string | null;
  dietary: string | null;
  birthday: string | null;
  notes: string | null;
  first_visit_at: string | null;
  last_visit_at: string | null;
  lifetime_value_eur: number | null;
  source: string;
};

type SortKey = "name" | "last_visit_at" | "visits" | "lifetime_value_eur";
type ChipKey = "recent" | "wine_club" | "private" | "birthday_month" | "first_timers" | "vip";

const CHIPS: { key: ChipKey; label: string }[] = [
  { key: "recent", label: "Last 30 days" },
  { key: "wine_club", label: "Wine club" },
  { key: "private", label: "Private dining" },
  { key: "birthday_month", label: "Birthday this month" },
  { key: "first_timers", label: "First-timers" },
  { key: "vip", label: "VIPs (LTV > €500)" },
];

const eur = (n: number | null | undefined) => "€" + Math.round(Number(n || 0)).toLocaleString("en-GB");
const shortDate = (s: string | null) => (s ? new Date(s).toISOString().slice(0, 10) : "—");

export default function GrowRelationships() {
  const router = useRouter();
  const [guests, setGuests] = useState<Guest[]>([]);
  const [visitCounts, setVisitCounts] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [chip, setChip] = useState<ChipKey | null>(null);
  const [sort, setSort] = useState<SortKey>("last_visit_at");
  const [dir, setDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    (async () => {
      const ent = ((typeof localStorage !== "undefined" && localStorage.getItem("fs_entity")) as EntityKey | null) || "bistro_mondo";
      const rid = ENTITY_TO_RESTAURANT[ent] || ENTITY_TO_RESTAURANT.bistro_mondo!;
      const { data: gs } = await supabaseBrowser
        .from("guests")
        .select("id,name,email,phone,allergies,dietary,birthday,notes,first_visit_at,last_visit_at,lifetime_value_eur,source")
        .eq("restaurant_id", rid)
        .limit(500);
      const gsArr = (gs || []) as Guest[];
      setGuests(gsArr);
      if (gsArr.length) {
        const ids = gsArr.map((g) => g.id);
        const { data: vs } = await supabaseBrowser
          .from("guest_visits")
          .select("guest_id")
          .in("guest_id", ids);
        const counts: Record<string, number> = {};
        (vs || []).forEach((v: any) => { counts[v.guest_id] = (counts[v.guest_id] || 0) + 1; });
        setVisitCounts(counts);
      }
      setLoaded(true);
    })();
  }, []);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const now = new Date();
    const thirtyAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    const thisMonth = now.getMonth() + 1;
    return guests
      .filter((g) => {
        if (!ql) return true;
        return [g.name, g.email, g.phone, g.notes].filter(Boolean).some((s) => (s as string).toLowerCase().includes(ql));
      })
      .filter((g) => {
        if (!chip) return true;
        if (chip === "recent") return !!g.last_visit_at && new Date(g.last_visit_at) >= thirtyAgo;
        if (chip === "wine_club") return (g.notes || "").toLowerCase().includes("wine club") || (g.dietary || "").toLowerCase().includes("wine club");
        if (chip === "private") return g.source === "private_event";
        if (chip === "birthday_month") return !!g.birthday && Number(g.birthday.slice(5, 7)) === thisMonth;
        if (chip === "first_timers") return (visitCounts[g.id] || 0) <= 1;
        if (chip === "vip") return Number(g.lifetime_value_eur || 0) > 500;
        return true;
      })
      .sort((a, b) => {
        const s = dir === "desc" ? -1 : 1;
        if (sort === "name") return a.name.localeCompare(b.name) * s;
        if (sort === "visits") return ((visitCounts[a.id] || 0) - (visitCounts[b.id] || 0)) * s;
        if (sort === "lifetime_value_eur") return (Number(a.lifetime_value_eur || 0) - Number(b.lifetime_value_eur || 0)) * s;
        const ta = a.last_visit_at ? new Date(a.last_visit_at).getTime() : 0;
        const tb = b.last_visit_at ? new Date(b.last_visit_at).getTime() : 0;
        return (ta - tb) * s;
      });
  }, [guests, visitCounts, q, chip, sort, dir]);

  const flipSort = (k: SortKey) => {
    if (k === sort) { setDir(dir === "asc" ? "desc" : "asc"); }
    else { setSort(k); setDir(k === "name" ? "asc" : "desc"); }
  };
  const SortHead = ({ k, children, className }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <button onClick={() => flipSort(k)} className={"text-left font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink " + (className || "")}>
      {children}{sort === k ? (dir === "desc" ? " ↓" : " ↑") : ""}
    </button>
  );

  return (
    <main className="mx-auto max-w-3xl lg:max-w-5xl px-6 py-12">
      <Link href="/grow" className="font-sans text-sm text-ink-soft">← grow</Link>
      <div className="mt-6 flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Grow · relationships</p>
          <h1 className="mt-1 font-serif text-4xl leading-tight text-ink">Guests.</h1>
        </div>
        <Link href="/grow/relationships/new" className="rounded-xl px-4 py-2.5 font-sans text-[13px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>+ Add guest</Link>
      </div>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">Who they are, when they last came, what they told us.</p>

      <div className="mt-8 border-t border-line pt-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email, phone, notes…"
          className="w-full bg-transparent font-sans text-[15px] text-ink placeholder:text-clay outline-none"
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            onClick={() => setChip(chip === c.key ? null : c.key)}
            className={"rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wide transition " + (chip === c.key ? "border-transparent bg-ink text-paper" : "border-line text-clay hover:text-ink")}
          >
            {c.label}
          </button>
        ))}
      </div>

      <section className="mt-6 border-t border-line">
        <div className="grid grid-cols-[1.6fr_0.9fr_0.5fr_0.7fr_1fr] items-baseline gap-3 border-b border-line py-2">
          <SortHead k="name">Name</SortHead>
          <SortHead k="last_visit_at">Last visit</SortHead>
          <SortHead k="visits" className="text-right">Visits</SortHead>
          <SortHead k="lifetime_value_eur" className="text-right">LTV</SortHead>
          <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Notes</span>
        </div>
        {!loaded ? (
          <p className="py-6 font-mono text-[11px] text-clay">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="py-8 font-serif italic text-[14px] text-clay">
            {guests.length === 0
              ? "No guests yet. Add one, or wait for bookings to populate."
              : "No guests match this filter."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((g) => (
              <li key={g.id}>
                <button
                  onClick={() => router.push(`/grow/relationships/${g.id}`)}
                  className="grid w-full grid-cols-[1.6fr_0.9fr_0.5fr_0.7fr_1fr] items-baseline gap-3 py-3 text-left transition hover:bg-line-soft/40"
                >
                  <span className="font-serif text-[15px] text-ink">{g.name}</span>
                  <span className="font-mono text-[12px] text-clay">{shortDate(g.last_visit_at)}</span>
                  <span className="text-right font-mono text-[12px] text-ink-soft">{visitCounts[g.id] || 0}</span>
                  <span className="text-right font-mono text-[12px] text-ink">{eur(g.lifetime_value_eur)}</span>
                  <span className="flex flex-wrap gap-1 text-[11px]">
                    {g.allergies ? <span className="rounded-full border border-tomato/40 px-1.5 py-[1px] font-mono text-[10px] uppercase text-tomato">allergy</span> : null}
                    {g.dietary ? <span className="rounded-full border border-basil/40 px-1.5 py-[1px] font-mono text-[10px] uppercase text-basil">diet</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">
        {filtered.length} of {guests.length} guest{guests.length === 1 ? "" : "s"}
      </p>
    </main>
  );
}
