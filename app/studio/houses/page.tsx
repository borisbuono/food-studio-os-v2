import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { getMyMembershipContext } from "@/lib/memberships";
import { houseSlugForEntity } from "@/lib/houses";
import { RESTAURANT_TO_ENTITY } from "@/lib/entities";

export const dynamic = "force-dynamic";

// /studio/houses — Studio-scoped portfolio list.
//
// Boris re-walk 2026-08-31 17:40 CET: the sidebar "Houses" link used to
// send Boris into a house (BM), which re-scoped the sidebar to that
// house's tree and swapped the logo to Bistro Mondo. Wrong — a link INSIDE
// the Studio sidebar shouldn't leave the Studio scope. This page renders a
// portfolio list at Studio level (sidebar stays STUDIO, logo stays Food
// Studios). Only when the user clicks a house tile do they leave Studio
// scope and land at /h/<slug>.
//
// Kept intentionally minimal: same tile grammar as /studio (name, badge,
// last close + stale), but ONLY operating venues (Houses). Advisory /
// partners / landlords have their own portfolio pages.

const OPERATING_DEFAULT_ROOM = "/office";
const ENTITY_TO_RID: Record<string, string> = {
  "Bistro Mondo":    "fb4d008f-2d2a-4e0d-a525-6e0e36af0259",
  "Taller Sa Penya": "ca83e06f-a24d-43d7-bce4-57ac341d190f",
};

function madridToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
function eur(n: number): string {
  return "€" + Math.round(n).toLocaleString("en-GB");
}
function humanDate(iso: string, today: string): string {
  if (iso === today) return "today";
  const yest = new Date(today + "T12:00:00Z");
  yest.setUTCDate(yest.getUTCDate() - 1);
  if (iso === yest.toISOString().slice(0, 10)) return "yesterday";
  const d = new Date(iso + "T12:00:00Z");
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}
function isStale(iso: string, today: string): boolean {
  const now = new Date(today + "T12:00:00Z").getTime();
  const rowT = new Date(iso + "T12:00:00Z").getTime();
  return (now - rowT) / 36e5 > 48;
}

export default async function StudioHousesPage() {
  const sb = supabaseServer();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) redirect("/welcome");

  const ctx = await getMyMembershipContext();
  if (!ctx.isOwner && !ctx.isMulti && ctx.memberships.length === 1) {
    const m = ctx.memberships[0];
    if (m.room !== "studio") redirect(`/${m.room === "kitchen" ? "boh" : m.room === "dining" ? "foh" : "office"}`);
  }

  const { data: allEnts } = await sb
    .from("entities")
    .select("id, name, entity_type, is_active, status")
    .eq("is_active", true)
    .eq("entity_type", "operating_venue")
    .order("name");
  const ents = (allEnts || []).filter((e: any) => (e.status ?? "active") === "active");

  const memberEntityIds = new Set(ctx.memberships.map((m) => m.entity_id));
  const houses = ents.filter((e: any) => ctx.isOwner || memberEntityIds.has(e.id));

  const today = madridToday();
  const rids = houses.map((e: any) => ENTITY_TO_RID[e.name]).filter(Boolean);

  let posByRid = new Map<string, { date: string; gross: number; covers: number }>();
  if (rids.length) {
    const { data: posRows } = await sb
      .from("eod_pos")
      .select("restaurant_id,date,total_gross_eur,covers")
      .in("restaurant_id", rids)
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

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-4">
        <Link href="/studio" className="font-mono text-[10px] uppercase tracking-wide text-clay">← Food Studios</Link>
      </div>
      <h1 className="font-serif text-[34px] leading-[1.05] text-ink">Houses</h1>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">
        The portfolio of operating venues. Click a house to leave the Studio and enter its rooms.
      </p>

      {houses.length === 0 ? (
        <section className="mt-10 rounded-2xl border border-dashed border-line p-8 text-center">
          <p className="font-serif italic text-[15px] text-ink-soft">No operating houses yet.</p>
        </section>
      ) : (
        <ul className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {houses.map((e: any) => {
            const rid = ENTITY_TO_RID[e.name];
            const ent = rid ? RESTAURANT_TO_ENTITY[rid] : null;
            const slug = houseSlugForEntity(ent);
            const href = slug ? `/h/${slug}` : OPERATING_DEFAULT_ROOM;
            const pos = rid ? posByRid.get(rid) : null;
            const stale = pos ? isStale(pos.date, today) : false;
            return (
              <li key={e.id}>
                <Link
                  href={href}
                  className="block rounded-lg border border-black/10 bg-paper/50 p-5 transition hover:border-ink/40 hover:bg-paper"
                >
                  <p className="font-serif text-[20px] text-ink leading-tight">{e.name}</p>
                  {pos ? (
                    <>
                      <p className="mt-3 font-sans text-[13px] text-ink-soft">{eur(pos.gross)} · {pos.covers} covers</p>
                      <p className="mt-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wide text-clay">
                        <span>{pos.date === today ? "Today" : `Last close ${humanDate(pos.date, today)}`}</span>
                        {stale ? (
                          <span
                            className="inline-flex items-center rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide"
                            style={{ borderColor: "#B85C1E66", color: "#B85C1E", background: "#B85C1E14" }}
                          >
                            Stale
                          </span>
                        ) : null}
                      </p>
                    </>
                  ) : (
                    <p className="mt-3 font-sans text-[13px] text-ink-soft">No closes yet</p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
