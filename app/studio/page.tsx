import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { getMyMembershipContext } from "@/lib/memberships";

export const dynamic = "force-dynamic";

// The Studio — Push 1 (2026-08-23).
//
// Owner + multi-role landing surface. A tile grid: one tile per HOUSE the
// user has access to. Each tile shows a one-line live status pulled from
// Supabase (today's revenue for operating venues, licence/project state for
// partners and advisory clients).
//
// This is the OWNER'S orientation surface, not an analytics dashboard.
// Deliberately quiet: name, badge, one live number, click to enter the house.
//
// STUDIO   ← the group (Food Studios — the strip at the top)
//   └── HOUSE   ← the tiles below
//         └── ROOM   ← revealed when the owner clicks a tile (default: Office)
//               └── STATION   ← Push 2

const OPERATING_DEFAULT_ROOM = "/office"; // owner enters an operating venue via its Office
const ADVISORY_DEFAULT_ROOM = "/administrate/advisor";
const PARTNER_DEFAULT_ROOM = "/administrate/partner";
const LANDLORD_DEFAULT_ROOM = "/administrate/landlord";
const HOLDING_DEFAULT_ROOM = "/administrate/holdings";

// Restaurant UUIDs — mirrors app/page.tsx. Small enough to inline (three rows
// today, once); if the mapping grows we'll pull it into `lib/entities.ts`.
const ENTITY_TO_RID: Record<string, string> = {
  "Bistro Mondo":      "fb4d008f-2d2a-4e0d-a525-6e0e36af0259",
  "Taller Sa Penya":   "ca83e06f-a24d-43d7-bce4-57ac341d190f",
};

function madridDateLabel(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long",
  }).format(new Date());
}
function madridClock(): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date());
}
function madridToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
function eur(n: number): string {
  return "€" + Math.round(n).toLocaleString("en-GB");
}

type Tile = {
  id: string;
  name: string;
  type: string;
  href: string;
  status: string;
};

const TYPE_BADGE_ACCENT: Record<string, string> = {
  operating_venue: "#3F4C28", // olive
  advisory_client: "#0E7C86", // teal
  partner:         "#B8552E", // rust
  landlord:        "#7A7A75", // stone
  holding_company: "#2B3A45", // slate
};

export default async function StudioPage() {
  const sb = supabaseServer();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) redirect("/welcome");

  const ctx = await getMyMembershipContext();

  // Studio is reserved for owner OR multi-role. A single-role non-owner who
  // navigates here directly gets bounced to their room.
  if (!ctx.isOwner && !ctx.isMulti && ctx.memberships.length === 1) {
    const m = ctx.memberships[0];
    if (m.room !== "studio") redirect(`/${m.room === "kitchen" ? "boh" : m.room === "dining" ? "foh" : "office"}`);
  }

  // Owners see every operating venue + every advisory/partner/landlord + the
  // holding. Non-owner multi-role users see only the entities they belong to.
  //
  // We fetch ALL entities and filter — this is a small table (< 20 rows).
  const { data: allEnts } = await sb
    .from("entities")
    .select("id, name, entity_type, is_active, status")
    .eq("is_active", true)
    .order("entity_type")
    .order("name");
  const ents = (allEnts || []).filter((e: any) => (e.status ?? "active") === "active");

  // Membership-scope filter.
  const memberEntityIds = new Set(ctx.memberships.map((m) => m.entity_id));
  const houses = ents.filter((e: any) => {
    if (ctx.isOwner) return e.entity_type !== "holding_company"; // holding lives in its own strip
    return memberEntityIds.has(e.id);
  });

  // Live status per operating venue: today's POS gross (or yesterday's if no
  // POS row exists yet for today — matches the compass semantics).
  const today = madridToday();
  const opRids = houses
    .filter((e: any) => e.entity_type === "operating_venue")
    .map((e: any) => ENTITY_TO_RID[e.name])
    .filter(Boolean);

  let posByRid = new Map<string, { date: string; gross: number; covers: number }>();
  if (opRids.length) {
    const { data: posRows } = await sb
      .from("eod_pos")
      .select("restaurant_id,date,total_gross_eur,covers")
      .in("restaurant_id", opRids)
      .order("date", { ascending: false })
      .limit(60);
    for (const r of posRows || []) {
      const rid = r.restaurant_id as string;
      if (!posByRid.has(rid)) {
        posByRid.set(rid, {
          date: String(r.date),
          gross: Number(r.total_gross_eur || 0),
          covers: Number(r.covers || 0),
        });
      }
    }
  }

  const tiles: Tile[] = houses.map((e: any): Tile => {
    let href = OPERATING_DEFAULT_ROOM;
    let status = "—";
    if (e.entity_type === "operating_venue") {
      href = OPERATING_DEFAULT_ROOM;
      const rid = ENTITY_TO_RID[e.name];
      const pos = rid ? posByRid.get(rid) : null;
      if (pos) {
        const dateNote = pos.date === today ? "today" : "last close";
        status = `${eur(pos.gross)} · ${pos.covers} covers · ${dateNote}`;
      } else {
        status = "no POS data yet";
      }
    } else if (e.entity_type === "advisory_client") {
      href = ADVISORY_DEFAULT_ROOM;
      status = (e.status || "active").toLowerCase() === "dormant" ? "dormant" : "engagement active";
    } else if (e.entity_type === "partner") {
      href = PARTNER_DEFAULT_ROOM;
      status = "licence active";
    } else if (e.entity_type === "landlord") {
      href = LANDLORD_DEFAULT_ROOM;
      status = "lease live";
    }
    return { id: e.id, name: e.name, type: e.entity_type, href, status };
  });

  // The holding row (BBH) — surfaced as its own quiet chip in the top strip
  // (Food Studios is the STUDIO label; BBH is the legal roll-up).
  const bbh = ents.find((e: any) => e.entity_type === "holding_company");
  const studioName = "Food Studios";
  const dateLabel = madridDateLabel();
  const clock = madridClock();

  // Group tiles by entity_type for the section headers.
  const groups: { key: string; label: string; tiles: Tile[] }[] = [
    { key: "operating_venue", label: "Venues",    tiles: tiles.filter((t) => t.type === "operating_venue") },
    { key: "advisory_client", label: "Advisory",  tiles: tiles.filter((t) => t.type === "advisory_client") },
    { key: "partner",         label: "Partners",  tiles: tiles.filter((t) => t.type === "partner") },
    { key: "landlord",        label: "Landlords", tiles: tiles.filter((t) => t.type === "landlord") },
  ].filter((g) => g.tiles.length > 0);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      {/* Top strip — Studio identity, date, Madrid time, cross-house signal
          placeholder (handover surface doesn't exist yet — leave a hairline). */}
      <section className="border-b border-black/10 pb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">The Studio</p>
            <h1 className="mt-1 font-serif text-4xl text-ink">{studioName}</h1>
            {bbh ? (
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">
                {bbh.name} · holding
              </p>
            ) : null}
          </div>
          <div className="text-right">
            <p className="font-serif text-[17px] text-ink-soft">{dateLabel}</p>
            <p className="font-mono text-[11px] text-clay">Madrid · {clock}</p>
          </div>
        </div>
        {/* Cross-house handover placeholder — Push 2 lights this up. */}
        <p className="mt-4 font-mono text-[10px] uppercase tracking-wide text-clay">
          Handover · no active handover across houses
        </p>
      </section>

      {/* Houses — grouped tile grid. */}
      {groups.map((g) => (
        <section key={g.key} className="mt-10">
          <h2 className="font-mono text-[10px] uppercase tracking-wide text-clay">{g.label}</h2>
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {g.tiles.map((t) => (
              <li key={t.id}>
                <Link
                  href={t.href}
                  className="block rounded-lg border border-black/10 bg-paper/50 p-5 transition hover:border-ink/40 hover:bg-paper"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-serif text-[20px] text-ink leading-tight">{t.name}</p>
                    <span
                      className="mt-1 inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide"
                      style={{
                        borderColor: TYPE_BADGE_ACCENT[t.type] + "66",
                        color: TYPE_BADGE_ACCENT[t.type],
                      }}
                    >
                      {t.type.replace("_", " ")}
                    </span>
                  </div>
                  <p className="mt-3 font-sans text-[13px] text-ink-soft">{t.status}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* Empty state — user is owner/multi-role but no entities match. */}
      {groups.length === 0 ? (
        <section className="mt-16 text-center">
          <p className="font-serif text-[17px] text-ink-soft">
            No houses yet. Add an entity in the Office to see it here.
          </p>
        </section>
      ) : null}
    </main>
  );
}
