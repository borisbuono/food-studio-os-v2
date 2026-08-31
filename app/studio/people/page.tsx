import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { getMyMembershipContext } from "@/lib/memberships";
import { houseSlugForEntity } from "@/lib/houses";
import { RESTAURANT_TO_ENTITY } from "@/lib/entities";

export const dynamic = "force-dynamic";

// /studio/people — Studio-scoped portfolio people view.
//
// Boris re-walk 2026-08-31 17:45 CET: the sidebar "People" link used to
// send Boris to /administrate/team, which is a HOUSE-scoped screen (drops
// the user into BM's sidebar + logo and lists that house's roster with
// Onboard / Quick invite / Weekly rota tiles). A Studio-sidebar link must
// stay in Studio scope. This page is the portfolio-level people view:
//
//   1. Directly employed by the holding entity (Boris + any portfolio-
//      level roles) — read from team_members whose default venue maps
//      to no operating house.
//   2. Per-house roster tiles ("Bistro Mondo · 12 people · N invited")
//      that link INTO the house at /h/<slug>/people. Clicking a tile is
//      the boundary crossing.
//   3. Portfolio movements — joined this week, invites pending, across
//      every house at once.
//
// Deliberately NOT rendered here (belongs at HOUSE level, /h/<slug>/people):
//   • Onboard a new hire button
//   • Quick invite
//   • Onboarding pipeline
//   • Weekly rota
// Boris also flagged the hiring funnel (JD → WhatsApp/Telegram post →
// screening → interview → hire). That's tracked as task #64 and is left
// here as a "Hiring funnel coming soon" placeholder link, per push spec.

function madridToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export default async function StudioPeoplePage() {
  const sb = supabaseServer();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) redirect("/welcome");

  const ctx = await getMyMembershipContext();
  if (!ctx.isOwner && !ctx.isMulti && ctx.memberships.length === 1) {
    const m = ctx.memberships[0];
    if (m.room !== "studio") redirect(`/${m.room === "kitchen" ? "boh" : m.room === "dining" ? "foh" : "office"}`);
  }

  // Operating houses only — the tile grid below is per-house.
  const { data: allEnts } = await sb
    .from("entities")
    .select("id, name, entity_type, is_active, status")
    .eq("is_active", true)
    .eq("entity_type", "operating_venue")
    .order("name");
  const houses = (allEnts || []).filter((e: any) => (e.status ?? "active") === "active");

  // Holding entity — for the "directly employed by Food Studios" section.
  const { data: holdingEnts } = await sb
    .from("entities")
    .select("id, name")
    .eq("is_active", true)
    .eq("entity_type", "holding_company");
  const holdingIds = new Set((holdingEnts || []).map((e: any) => e.id));

  // Restaurants — team_members.default_restaurant_id links here.
  const { data: venues } = await sb.from("restaurants").select("id,name");
  const vname = new Map((venues || []).map((v: any) => [String(v.id), String(v.name)]));

  // Full team_members roster — a single small table (< 100 rows in prod).
  const { data: members } = await sb
    .from("team_members")
    .select("id,name,email,default_role,default_restaurant_id,status,first_login_at,invited_at,archived_at")
    .order("name");
  const roster = (members || []).filter((m: any) => !m.archived_at);

  // Per-house counts (roster + pending invites), keyed by restaurant name.
  type Bucket = { total: number; pending: number; joinedThisWeek: number };
  const houseBucketByName = new Map<string, Bucket>();
  for (const h of houses) houseBucketByName.set(String(h.name), { total: 0, pending: 0, joinedThisWeek: 0 });

  // Boundary for "this week": last 7 days.
  const weekAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

  // Directly employed by the holding — anyone whose default venue isn't a
  // known operating-venue restaurant. Prod convention: portfolio-level roles
  // (owner, ops director) sit here.
  const portfolioMembers: any[] = [];

  // Restaurant id → house name lookup (restaurants.id === team_members.default_restaurant_id).
  // Houses use `entities.name` which must equal `restaurants.name` for the tile mapping.
  const houseNames = new Set(houses.map((h: any) => String(h.name)));

  let joinedThisWeekTotal = 0;
  let pendingTotal = 0;

  for (const m of roster) {
    const vn = vname.get(String(m.default_restaurant_id));
    const isPending = (m.status || "invited") === "invited";
    const joinedThisWeek = !!m.first_login_at && new Date(m.first_login_at).getTime() >= weekAgoMs;
    if (isPending) pendingTotal += 1;
    if (joinedThisWeek) joinedThisWeekTotal += 1;

    if (vn && houseNames.has(vn)) {
      const b = houseBucketByName.get(vn)!;
      b.total += 1;
      if (isPending) b.pending += 1;
      if (joinedThisWeek) b.joinedThisWeek += 1;
    } else {
      portfolioMembers.push(m);
    }
  }

  const roleLabel = (r: string | null | undefined) => (r || "").trim() || "team";

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-4">
        <Link href="/studio" className="font-mono text-[10px] uppercase tracking-wide text-clay">← Food Studios</Link>
      </div>
      <h1 className="font-serif text-[34px] leading-[1.05] text-ink">People</h1>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">
        Everyone across the portfolio. Click a house to leave the Studio and enter that house's team.
      </p>

      {/* ─── Portfolio movements strip ─────────────────────────────── */}
      <section className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-black/10 bg-paper/50 p-5">
          <p className="font-serif text-[28px] text-ink leading-none">{roster.length}</p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">Active roster across all houses</p>
        </div>
        <div className="rounded-lg border border-black/10 bg-paper/50 p-5">
          <p className="font-serif text-[28px] text-ink leading-none">{joinedThisWeekTotal}</p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">Joined this week</p>
        </div>
        <div className="rounded-lg border border-black/10 bg-paper/50 p-5">
          <p className="font-serif text-[28px] text-ink leading-none">{pendingTotal}</p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">Invites pending</p>
        </div>
      </section>

      {/* ─── Directly employed by Food Studios / BBH ───────────────── */}
      <section className="mt-10">
        <p className="font-mono text-[11px] uppercase tracking-wide text-clay">Directly employed by Food Studios</p>
        <p className="mt-1 font-serif italic text-[13px] text-ink-soft">
          Portfolio-level roles — Boris, ops, anyone whose contract sits with the holding entity.
        </p>
        {portfolioMembers.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-line p-6 text-center">
            <p className="font-serif italic text-[14px] text-ink-soft">No portfolio-level people on record yet.</p>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-black/10 border-t border-black/10">
            {portfolioMembers.map((m: any) => (
              <li key={m.id} className="flex items-baseline justify-between gap-4 py-3">
                <div>
                  <p className="font-serif text-[18px] text-ink">{m.name}</p>
                  <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
                    {roleLabel(m.default_role)}{m.email ? ` · ${m.email}` : ""}
                  </p>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{m.status || "member"}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ─── Per-house roster tiles ────────────────────────────────── */}
      <section className="mt-10">
        <p className="font-mono text-[11px] uppercase tracking-wide text-clay">By house</p>
        <p className="mt-1 font-serif italic text-[13px] text-ink-soft">
          Tap a house to open its own team page — schedules, invites, onboarding all live there.
        </p>
        <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {houses.map((e: any) => {
            const bucket = houseBucketByName.get(String(e.name)) || { total: 0, pending: 0, joinedThisWeek: 0 };
            // Find restaurant_id via entities.name match, then use existing house-slug lookup.
            // entities.name is the same string as restaurants.name in prod for BM & Taller.
            const rid = (venues || []).find((v: any) => v.name === e.name)?.id;
            const ent = rid ? RESTAURANT_TO_ENTITY[rid] : null;
            const slug = houseSlugForEntity(ent);
            const href = slug ? `/h/${slug}/people` : `/administrate/team`;
            return (
              <li key={e.id}>
                <Link
                  href={href}
                  className="block rounded-lg border border-black/10 bg-paper/50 p-5 transition hover:border-ink/40 hover:bg-paper"
                >
                  <p className="font-serif text-[20px] text-ink leading-tight">{e.name}</p>
                  <p className="mt-3 font-sans text-[13px] text-ink-soft">
                    {bucket.total} {bucket.total === 1 ? "person" : "people"}
                    {bucket.pending ? ` · ${bucket.pending} invited` : ""}
                  </p>
                  <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">
                    {bucket.joinedThisWeek ? `${bucket.joinedThisWeek} new this week` : "No new joiners this week"}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ─── Hiring funnel placeholder (task #64) ──────────────────── */}
      <section className="mt-10 rounded-lg border border-dashed border-line p-6">
        <p className="font-mono text-[11px] uppercase tracking-wide text-clay">Hiring funnel</p>
        <p className="mt-1 font-serif text-[17px] text-ink">Coming soon</p>
        <p className="mt-2 font-serif italic text-[13px] text-ink-soft">
          JD → WhatsApp / Telegram post → screening → interview → hire. Tracked as task #64;
          not built in this push.
        </p>
      </section>
    </main>
  );
}
