import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { getMyMembershipContext } from "@/lib/memberships";

export const dynamic = "force-dynamic";

// /studio/command — Studio-scoped portfolio settings & control.
//
// Boris re-walk 2026-08-31 17:45 CET: the sidebar "Command" link used to
// send Boris to /command, which surfaced a "Control room · 12 entities ·
// 29 accounts · 20 skills" jumble — everything from every house in one
// bucket. Quote flagged the whole page as the wrong scope. This page is
// the portfolio-level replacement.
//
// Sections:
//   1. Members — everyone with any active membership on a Food Studios
//      entity, with a per-house access matrix.
//   2. Integrations at portfolio level — Fresto, Holded (BM + IFL),
//      CaixaBank, WhatsApp channels. NOT per-house feed config; that
//      still lives at /h/<slug>/command.
//   3. Billing — Food Studios subscription tier, storage, API usage
//      across the OS. Placeholder for now; wired to real data next push.
//   4. System — dev tools, feature flags, environment info, visible
//      to owners only.
//
// Deliberately NOT rendered here (belongs at HOUSE level, /h/<slug>/command):
//   • Per-house Fresto feed switch
//   • Per-house Holded API key
//   • Per-house scanner routing (admin@bistro-mondo, admin@ibzfoodstudio)
//   • Per-house cost centres, tax rates, printer config

type Membership = {
  entity_id: string;
  entity_name: string;
  role: string;
  area: string | null;
};

export default async function StudioCommandPage() {
  const sb = supabaseServer();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) redirect("/welcome");

  const ctx = await getMyMembershipContext();
  if (!ctx.isOwner && !ctx.isMulti && ctx.memberships.length === 1) {
    const m = ctx.memberships[0];
    if (m.room !== "studio") redirect(`/${m.room === "kitchen" ? "boh" : m.room === "dining" ? "foh" : "office"}`);
  }

  // ── Members across every Food Studios entity ──
  // Read from `memberships` joined with team_members + entities. Kept small:
  // pull the raw rows, group in memory. In prod this is < 100 rows.
  const { data: ents } = await sb
    .from("entities")
    .select("id, name, entity_type, is_active, status")
    .eq("is_active", true);
  const activeEnts = (ents || []).filter((e: any) => (e.status ?? "active") === "active");
  const entityNameById = new Map<string, string>();
  const entityTypeById = new Map<string, string>();
  for (const e of activeEnts) {
    entityNameById.set(String(e.id), String(e.name));
    entityTypeById.set(String(e.id), String(e.entity_type));
  }

  const { data: mships } = await sb
    .from("memberships")
    .select("entity_id, person_id, role, area, status")
    .eq("status", "active");
  const activeMships = (mships || []).filter((m: any) => entityNameById.has(String(m.entity_id)));

  // team_members: id → name (person_id joins on team_members.id).
  const personIds = Array.from(new Set(activeMships.map((m: any) => String(m.person_id))));
  const { data: tms } = personIds.length
    ? await sb.from("team_members").select("id, name, email").in("id", personIds)
    : { data: [] as any[] };
  const personById = new Map<string, { name: string; email: string | null }>();
  for (const t of (tms || []) as any[]) personById.set(String(t.id), { name: t.name, email: t.email });

  // Group memberships by person.
  const byPerson = new Map<string, Membership[]>();
  for (const m of activeMships as any[]) {
    const pid = String(m.person_id);
    const list = byPerson.get(pid) || [];
    list.push({
      entity_id: String(m.entity_id),
      entity_name: entityNameById.get(String(m.entity_id)) || "—",
      role: String(m.role || "member"),
      area: (m.area as string) || null,
    });
    byPerson.set(pid, list);
  }

  const memberRows = Array.from(byPerson.entries())
    .map(([pid, ms]) => ({
      pid,
      person: personById.get(pid),
      houses: ms.filter((m) => entityTypeById.get(m.entity_id) === "operating_venue"),
      holdings: ms.filter((m) => entityTypeById.get(m.entity_id) === "holding_company"),
      isOwner: ms.some((m) => (m.role || "").toLowerCase() === "owner"),
    }))
    .filter((r) => r.person)
    .sort((a, b) => {
      if (a.isOwner !== b.isOwner) return a.isOwner ? -1 : 1;
      return (a.person!.name || "").localeCompare(b.person!.name || "");
    });

  // Boris fallback: even if the memberships query is empty (early envs
  // where the table hasn't been backfilled), the owner is at least visible.
  if (memberRows.length === 0) {
    memberRows.push({
      pid: "self",
      person: { name: userRes.user.email?.split("@")[0] || "Boris", email: userRes.user.email || null },
      houses: [],
      holdings: [],
      isOwner: ctx.isOwner,
    });
  }

  // ── Portfolio integrations ──
  // Names + one-line status. Real health checks belong to a separate push;
  // today the row states are hard-coded from what we know works in prod
  // (Fresto pulls, Holded API keys live, CaixaBank via Chift, WhatsApp Web).
  const integrations = [
    { name: "Fresto (POS)",         detail: "data.fresto.io — nightly Z-report + orderlines pull", state: "connected" },
    { name: "Holded — BM",          detail: "API key · draft/approve/attach + bank reconcile",     state: "connected" },
    { name: "Holded — IFL / Taller", detail: "API key · draft/approve/attach + bank reconcile",     state: "connected" },
    { name: "CaixaBank feed",       detail: "Chift / Apideck — CSB43 pull, sign convention fixed", state: "connected" },
    { name: "WhatsApp Web",         detail: "READ-only triage; never sends on Boris's behalf",     state: "read-only" },
    { name: "Wix (public site)",    detail: "Menu upload sink for consumer surfaces",              state: "connected" },
  ];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-4">
        <Link href="/studio" className="font-mono text-[10px] uppercase tracking-wide text-clay">← Food Studios</Link>
      </div>
      <h1 className="font-serif text-[34px] leading-[1.05] text-ink">Command</h1>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">
        Portfolio-level control room — members, integrations, billing, system. Per-house feed
        configuration lives inside each house's own Command.
      </p>

      {/* ─── Members with per-house access matrix ─────────────────── */}
      <section className="mt-10">
        <p className="font-mono text-[11px] uppercase tracking-wide text-clay">Members · {memberRows.length}</p>
        <p className="mt-1 font-serif italic text-[13px] text-ink-soft">
          Anyone with an active membership on any Food Studios entity, with the houses they
          can access.
        </p>
        <ul className="mt-4 divide-y divide-black/10 border-t border-black/10">
          {memberRows.map((r) => (
            <li key={r.pid} className="py-3">
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <p className="font-serif text-[17px] text-ink">
                    {r.person?.name}
                    {r.isOwner ? <span className="ml-2 font-mono text-[9px] uppercase tracking-wide text-clay">Owner</span> : null}
                  </p>
                  {r.person?.email ? (
                    <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{r.person.email}</p>
                  ) : null}
                </div>
                <p className="text-right font-mono text-[10px] uppercase tracking-wide text-clay">
                  {r.holdings.length ? "Holding · " : ""}
                  {r.houses.length === 0
                    ? (r.isOwner ? "All houses" : "No houses")
                    : r.houses.map((h) => h.entity_name).join(" · ")}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ─── Portfolio integrations ───────────────────────────────── */}
      <section className="mt-10">
        <p className="font-mono text-[11px] uppercase tracking-wide text-clay">Integrations · portfolio</p>
        <p className="mt-1 font-serif italic text-[13px] text-ink-soft">
          Data feeds Boris pays for once for the whole studio. Per-house configuration
          (which supplier maps to which cost centre, printer routing, tax rates) still
          lives inside each house.
        </p>
        <ul className="mt-4 divide-y divide-black/10 border-t border-black/10">
          {integrations.map((i) => (
            <li key={i.name} className="flex items-baseline justify-between gap-4 py-3">
              <div>
                <p className="font-serif text-[16px] text-ink">{i.name}</p>
                <p className="mt-1 font-serif italic text-[13px] text-ink-soft">{i.detail}</p>
              </div>
              <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{i.state}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ─── Billing (placeholder) ────────────────────────────────── */}
      <section className="mt-10 rounded-lg border border-dashed border-line p-6">
        <p className="font-mono text-[11px] uppercase tracking-wide text-clay">Billing</p>
        <p className="mt-1 font-serif text-[17px] text-ink">Coming soon</p>
        <p className="mt-2 font-serif italic text-[13px] text-ink-soft">
          Food Studios subscription tier, storage usage, LLM/API spend across the OS.
          Placeholder until the billing surface is wired.
        </p>
      </section>

      {/* ─── System · owner-only ──────────────────────────────────── */}
      {ctx.isOwner ? (
        <section className="mt-10">
          <p className="font-mono text-[11px] uppercase tracking-wide text-clay">System · owner-only</p>
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link href="/administrate/settings" className="rounded-lg border border-black/10 bg-paper/50 p-4 transition hover:border-ink/40 hover:bg-paper">
              <p className="font-serif text-[16px] text-ink">Global settings</p>
              <p className="mt-1 font-serif italic text-[13px] text-ink-soft">Feature flags, defaults, agent skills.</p>
            </Link>
            <Link href="/api/health" className="rounded-lg border border-black/10 bg-paper/50 p-4 transition hover:border-ink/40 hover:bg-paper">
              <p className="font-serif text-[16px] text-ink">Health probe</p>
              <p className="mt-1 font-serif italic text-[13px] text-ink-soft">/api/health · env sanity.</p>
            </Link>
            <Link href="/administrate/holdings" className="rounded-lg border border-black/10 bg-paper/50 p-4 transition hover:border-ink/40 hover:bg-paper">
              <p className="font-serif text-[16px] text-ink">Entity model</p>
              <p className="mt-1 font-serif italic text-[13px] text-ink-soft">Group console · legal entities · intercompany.</p>
            </Link>
            <Link href="/command" className="rounded-lg border border-black/10 bg-paper/50 p-4 transition hover:border-ink/40 hover:bg-paper">
              <p className="font-serif text-[16px] text-ink">Legacy control room</p>
              <p className="mt-1 font-serif italic text-[13px] text-ink-soft">Review flags, agent skills, chart-of-accounts count.</p>
            </Link>
          </ul>
        </section>
      ) : null}
    </main>
  );
}
