import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { getMyMembershipContext } from "@/lib/memberships";
import { houseSlugForEntity } from "@/lib/houses";
import { isOperating } from "@/lib/access/tenantScope";
import { getRestaurantIdsByEntity } from "@/lib/studio/houseSnapshots.server";

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

  // Houses + holding — tenant-filtered (2026-09-21). This page used to read
  // every entity row and the FULL team_members table, so a second tenant's
  // owner got Boris's roster (names, emails, roles). Both now come from the
  // entities this user may see.
  const accessible = ctx.entities.filter((e) => e.status === "active");
  const houses = accessible
    .filter((e) => isOperating(e.entity_type))
    .sort((a, b) => a.name.localeCompare(b.name));
  const holdingIds = new Set(accessible.filter((e) => e.entity_type === "holding_company").map((e) => e.id));
  const accessibleIds = new Set(accessible.map((e) => e.id));

  // Restaurants of MY houses — team_members.default_restaurant_id links here.
  const ridByEntity = await getRestaurantIdsByEntity(houses.map((h) => h.id));
  const entityByRid = new Map<string, string>();
  for (const [eid, rid] of ridByEntity) entityByRid.set(rid, eid);

  // Roster, scoped: a member counts when their default restaurant belongs to
  // one of my houses, or their operator entity is one I can see. Status
  // carries archived state (fn_person_merge sets 'removed' when folding
  // duplicates from task #35 into one canonical person); no archived_at
  // column exists on team_members.
  const { data: members } = await sb
    .from("team_members")
    .select("id,name,email,default_role,default_restaurant_id,operator_entity_id,status,first_login_at,invited_at")
    .order("name");
  const roster = (members || []).filter((m: any) => {
    if (["removed", "archived"].includes(String(m.status || ""))) return false;
    const rid = m.default_restaurant_id ? String(m.default_restaurant_id) : null;
    if (rid && entityByRid.has(rid)) return true;
    const oe = m.operator_entity_id ? String(m.operator_entity_id) : null;
    return !!oe && accessibleIds.has(oe);
  });

  // Per-house counts (roster + pending invites), keyed by restaurant name.
  type Bucket = { total: number; pending: number; joinedThisWeek: number };
  const houseBucketById = new Map<string, Bucket>();
  for (const h of houses) houseBucketById.set(h.id, { total: 0, pending: 0, joinedThisWeek: 0 });

  // Boundary for "this week": last 7 days.
  const weekAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;

  // Directly employed by the holding — anyone whose default venue isn't a
  // known operating-venue restaurant. Prod convention: portfolio-level roles
  // (owner, ops director) sit here.
  const portfolioMembers: any[] = [];

  let joinedThisWeekTotal = 0;
  let pendingTotal = 0;

  for (const m of roster) {
    const rid = m.default_restaurant_id ? String(m.default_restaurant_id) : null;
    const houseId = rid ? entityByRid.get(rid) : undefined;
    const isPending = (m.status || "invited") === "invited";
    const joinedThisWeek = !!m.first_login_at && new Date(m.first_login_at).getTime() >= weekAgoMs;
    if (isPending) pendingTotal += 1;
    if (joinedThisWeek) joinedThisWeekTotal += 1;

    if (houseId && houseBucketById.has(houseId)) {
      const b = houseBucketById.get(houseId)!;
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
      <h1 className="font-serif text-[34px] leading-[1.05] text-ink">Team</h1>
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
          {houses.map((e) => {
            const bucket = houseBucketById.get(e.id) || { total: 0, pending: 0, joinedThisWeek: 0 };
            const href = e.slug ? `/h/${e.slug}/people` : `/administrate/team`;
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
