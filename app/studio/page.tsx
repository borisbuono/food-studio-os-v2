import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { getMyMembershipContext } from "@/lib/memberships";
import { publicNameForEntity } from "@/lib/entities";
import { isOperating } from "@/lib/access/tenantScope";
import { getHouseSnapshots, type PosSnap } from "@/lib/studio/houseSnapshots.server";
import { todayInTz } from "@/lib/studio/closeStatus";
import { HousePosBlock } from "./HousePosBlock";

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

const ADVISORY_DEFAULT_ROOM = "/administrate/advisor";
const PARTNER_DEFAULT_ROOM = "/administrate/partner";
const LANDLORD_DEFAULT_ROOM = "/administrate/landlord";

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

// Task #58 (2026-09-21): operating tiles render the shared HousePosBlock —
// "Last close DD MMM" always (never "today"/"yesterday"), orange STALE pill
// when the newest eod_pos row is > 48h old. Houses and their restaurant rows
// resolve from entities.slug + restaurants.entity_id (houseSnapshots), not
// the old name->UUID map.
type Tile = {
  id: string;
  name: string;
  type: string;
  href: string;
  status: string;               // non-operating houses: one-line state
  operating: boolean;
  pos: PosSnap | null;
  restaurant_id: string | null;
  today: string;
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

  // Tenant filter (2026-09-21): the Studio lists ctx.entities — the houses
  // this user holds a membership on, plus (for owners) their holding's
  // advisory / partner / landlord children. "Owner -> every row in the
  // table" leaked Bistro Mondo + Taller to Utopia's owner.
  const ents = ctx.entities.filter((e) => e.status === "active");
  const houses = ents.filter((e) => e.entity_type !== "holding_company");
  const opIds = houses.filter((e) => isOperating(e.entity_type)).map((e) => e.id);
  const snaps = await getHouseSnapshots(opIds);

  const tiles: Tile[] = houses
    .slice()
    .sort((a, b) => a.entity_type.localeCompare(b.entity_type) || a.name.localeCompare(b.name))
    .map((e): Tile => {
      const base = {
        id: e.id, name: e.name, type: e.entity_type,
        pos: null, restaurant_id: null,
        today: todayInTz(e.timezone || "Europe/Madrid"),
      };
      if (isOperating(e.entity_type)) {
        // /h/<slug> — the house landing; crossing into the house's chrome.
        const snap = snaps.get(e.id);
        return {
          ...base,
          type: "operating_venue",
          operating: true,
          href: e.slug ? `/h/${e.slug}` : "/studio/houses",
          status: snap?.pos ? "" : "No closes yet",
          pos: snap?.pos ?? null,
          restaurant_id: snap?.restaurant_id ?? null,
        };
      }
      if (e.entity_type === "advisory_client") {
        return { ...base, operating: false, href: ADVISORY_DEFAULT_ROOM,
          status: (e.status || "active").toLowerCase() === "dormant" ? "dormant" : "engagement active" };
      }
      if (e.entity_type === "partner") return { ...base, operating: false, href: PARTNER_DEFAULT_ROOM, status: "licence active" };
      if (e.entity_type === "landlord") return { ...base, operating: false, href: LANDLORD_DEFAULT_ROOM, status: "lease live" };
      return { ...base, operating: false, href: "/studio", status: "—" };
    });

  // The holding row (BBH) — surfaced as its own quiet chip in the top strip
  // (Food Studios is the STUDIO label; BBH is the legal roll-up).
  const bbh = ents.find((e) => e.entity_type === "holding_company");
  const studioName = "Food Studios";
  const dateLabel = madridDateLabel();
  const clock = madridClock();

  // Owner label — read from the signed-in user's profile so the strip below
  // reads "Owner · <them>" instead of a hardcoded "Boris Buono". Falls back
  // to the email prefix if the profile.name isn't set (fresh onboard).
  // Boris walk 2026-09-20: first paying customer is not Boris; this strip
  // was leaking his name into every operator's Studio hero. Dynamic now.
  const { data: prof } = await sb
    .from("profiles")
    .select("name")
    .eq("id", userRes.user.id)
    .maybeSingle();
  const ownerName = (prof?.name && String(prof.name).trim()) || (userRes.user.email?.split("@")[0]) || "Owner";
  const legalEntityName = bbh?.name ? publicNameForEntity(bbh.name) : null;

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
            {/* Boris walk 2026-08-31: the old "BBH · HOLDING" tag read as a
                type badge and confused the relationship. Spell it out
                instead — Food Studios (the trading name) is legally BBH,
                owned by Boris. */}
            {/* Boris walk 2026-09-10 — public trading name only. The DB
                still stores "BBH" / "Boris Buono Holdings SL" as the
                internal shorthand; publicNameForEntity() maps it at the
                render surface so we never leak the holding company name
                to guests, partners or team members. */}
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">
              {legalEntityName ? <>Legal entity · {legalEntityName} · </> : null}Owner · {ownerName}
            </p>
          </div>
          <div className="text-right">
            <p className="font-serif text-[17px] text-ink-soft">{dateLabel}</p>
            <p className="font-mono text-[11px] text-clay">Madrid · {clock}</p>
          </div>
        </div>
        {/* Capture on the Studio landing was removed 2026-08-31 (Boris
            re-walk 17:40 CET). The Studio is not a receiving surface;
            a floating +Capture on this page contradicted the "no
            operating actions at the Studio level" rule. Capture now
            lives inside Chef (composer row → +Capture icon), which
            can route by scope (Studio → house picker, House → direct). */}
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
                  {t.operating ? (
                    <HousePosBlock pos={t.pos} restaurantId={t.restaurant_id} today={t.today} />
                  ) : (
                    <p className="mt-3 font-sans text-[13px] text-ink-soft">{t.status}</p>
                  )}
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
