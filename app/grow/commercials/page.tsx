"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";

export const dynamic = "force-dynamic";

type Commercial = {
  id: string;
  type: string;
  title: string;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
  created_at: string;
};

const TYPE_LABEL: Record<string, string> = {
  happy_hour: "Happy hour",
  package: "Package",
  seasonal: "Seasonal",
  wine_club: "Wine club",
  private_event_menu: "Private event menu",
};

const shortDate = (s: string | null) => (s ? new Date(s).toISOString().slice(0, 10) : "—");

type Status = "active" | "upcoming" | "expired" | "draft";
function statusOf(c: Commercial): Status {
  const now = new Date();
  const start = c.starts_at ? new Date(c.starts_at) : null;
  const end = c.ends_at ? new Date(c.ends_at) : null;
  if (!c.active) return "draft";
  if (start && start > now) return "upcoming";
  if (end && end < now) return "expired";
  return "active";
}

export default function GrowCommercials() {
  const router = useRouter();
  const [rows, setRows] = useState<Commercial[]>([]);
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const ent = ((typeof localStorage !== "undefined" && localStorage.getItem("fs_entity")) as EntityKey | null) || "utopia";
      const rid = ENTITY_TO_RESTAURANT[ent] || ENTITY_TO_RESTAURANT.utopia!;
      const { data: cs } = await supabaseBrowser
        .from("commercials")
        .select("id,type,title,description,starts_at,ends_at,active,created_at")
        .eq("restaurant_id", rid)
        .order("created_at", { ascending: false })
        .limit(200);
      const arr = (cs || []) as Commercial[];
      setRows(arr);
      if (arr.length) {
        const ids = arr.map((c) => c.id);
        const { data: ci } = await supabaseBrowser
          .from("commercial_items")
          .select("commercial_id")
          .in("commercial_id", ids);
        const counts: Record<string, number> = {};
        (ci || []).forEach((r: any) => { counts[r.commercial_id] = (counts[r.commercial_id] || 0) + 1; });
        setItemCounts(counts);
      }
      setLoaded(true);
    })();
  }, []);

  const grouped = useMemo(() => {
    const g: Record<Status, Commercial[]> = { active: [], upcoming: [], expired: [], draft: [] };
    rows.forEach((c) => g[statusOf(c)].push(c));
    return g;
  }, [rows]);

  const lbl = "font-mono text-[10px] uppercase tracking-wide text-clay";

  const Section = ({ title, list, statusTag }: { title: string; list: Commercial[]; statusTag: Status }) => (
    <section className="mt-8">
      <p className={lbl}>{title} · {list.length}</p>
      {list.length === 0 ? (
        <p className="mt-3 py-3 font-serif italic text-[13px] text-clay border-y border-line">Nothing here.</p>
      ) : (
        <div className="mt-3 divide-y divide-line border-y border-line">
          {list.map((c) => (
            <button
              key={c.id}
              onClick={() => router.push(`/grow/commercials/${c.id}`)}
              className="block w-full py-4 text-left transition hover:bg-line-soft/40"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-serif text-[17px] text-ink">{c.title}</h3>
                <span className={"font-mono text-[10px] uppercase tracking-wide " + (statusTag === "active" ? "text-basil" : statusTag === "upcoming" ? "text-ochre" : statusTag === "expired" ? "text-clay" : "text-clay")}>
                  {statusTag}
                </span>
              </div>
              <p className="mt-1 font-mono text-[11px] text-clay">
                {TYPE_LABEL[c.type] || c.type} · {shortDate(c.starts_at)} → {shortDate(c.ends_at)} · {itemCounts[c.id] || 0} item{itemCounts[c.id] === 1 ? "" : "s"}
              </p>
              {c.description ? <p className="mt-2 font-sans text-[13px] text-ink-soft leading-snug">{c.description.slice(0, 140)}{c.description.length > 140 ? "…" : ""}</p> : null}
            </button>
          ))}
        </div>
      )}
    </section>
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/grow" className="font-sans text-sm text-ink-soft">← grow</Link>
      <div className="mt-6 flex items-baseline justify-between gap-4">
        <div>
          <p className={lbl}>Grow · commercials</p>
          <h1 className="mt-1 font-serif text-4xl leading-tight text-ink">Offers.</h1>
        </div>
        <Link href="/grow/commercials/new" className="rounded-xl px-4 py-2.5 font-sans text-[13px] font-medium text-[#F7F7F4]" style={{ background: "var(--accent)" }}>+ New commercial</Link>
      </div>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">Happy hours, packages, seasonal specials, wine-club, private-event menus. Build the offer, publish everywhere.</p>

      {!loaded ? (
        <p className="mt-8 font-mono text-[11px] text-clay">Loading…</p>
      ) : rows.length === 0 ? (
        <section className="mt-10 border-t border-line pt-6">
          <p className="font-serif italic text-[15px] text-clay">No commercials yet. Build your first offer.</p>
          <Link href="/grow/commercials/new" className="mt-3 inline-block font-mono text-[11px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>Start →</Link>
        </section>
      ) : (
        <>
          <Section title="Active" list={grouped.active} statusTag="active" />
          <Section title="Upcoming" list={grouped.upcoming} statusTag="upcoming" />
          <Section title="Drafts" list={grouped.draft} statusTag="draft" />
          <Section title="Expired" list={grouped.expired} statusTag="expired" />
        </>
      )}
    </main>
  );
}
