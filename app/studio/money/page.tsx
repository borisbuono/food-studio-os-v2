import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { getMyMembershipContext } from "@/lib/memberships";
import { houseSlugForEntity } from "@/lib/houses";
import { RESTAURANT_TO_ENTITY, ENTITY_TO_RESTAURANT } from "@/lib/entities";

export const dynamic = "force-dynamic";

// /studio/money — Studio-scoped portfolio finance.
//
// Boris re-walk 2026-08-31 17:45 CET: the sidebar "Money" link used to
// send Boris to /administrate/finance = BM Office (with Taller data
// mixed in). Quote: "I asked for the money in food studios. Not in Mondo
// and Taller." This page is the portfolio-level answer.
//
// Sections:
//   1. Portfolio P&L — revenue MTD summed across every house, using
//      eod_pos (BRUTO POS truth) and eod_accounting (VERIFIED via Holded)
//      side-by-side, NEVER merged (respects revenue_duality_bruto_vs_holded).
//   2. Per-house cards — BM, Taller each get revenue MTD + covers, link
//      into /h/<slug>/money. Cards are the boundary crossing.
//   3. Intercompany — BBH ↔ BM loan balance + flagged mismatches. Live
//      figures where present; otherwise the two known August 2026 flags
//      surfaced from memory (IC MISMATCH €9,961, BBH +€3,960 blind).
//      Marked "context" so it reads as a known-unknown, not a live delta.
//   4. Cash across entities — bank balance per entity, latest row from
//      bank_movements (running total fallback when bank_accounts is empty).
//
// Deliberately NOT rendered here (belongs at HOUSE level, /h/<slug>/money):
//   • P&L line items
//   • Chart of accounts entries
//   • Reconciliation queue
//   • Scan queue
//   • Missing invoices
//
// Owners can still reach every legacy admin route via the House scope; this
// page only shows the portfolio summary.

function madridToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
function monthStartISO(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
function eur(n: number): string {
  const sign = n < 0 ? "-" : "";
  return sign + "€" + Math.round(Math.abs(n)).toLocaleString("en-GB");
}
function monthLabel(): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", month: "long", year: "numeric" }).format(new Date());
}

export default async function StudioMoneyPage() {
  const sb = supabaseServer();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) redirect("/welcome");

  const ctx = await getMyMembershipContext();
  if (!ctx.isOwner && !ctx.isMulti && ctx.memberships.length === 1) {
    const m = ctx.memberships[0];
    if (m.room !== "studio") redirect(`/${m.room === "kitchen" ? "boh" : m.room === "dining" ? "foh" : "office"}`);
  }

  // Houses (operating venues).
  const { data: allEnts } = await sb
    .from("entities")
    .select("id, name, entity_type, is_active, status")
    .eq("is_active", true)
    .eq("entity_type", "operating_venue")
    .order("name");
  const houses = (allEnts || []).filter((e: any) => (e.status ?? "active") === "active");

  const since = monthStartISO();
  const today = madridToday();

  // ── BRUTO revenue MTD from eod_pos, keyed by restaurant_id ──
  const rids = houses
    .map((e: any) => {
      const ent = RESTAURANT_TO_ENTITY;
      const found = Object.entries(ent).find(([, v]) => {
        if (v === "bistro_mondo" && e.name === "Bistro Mondo") return true;
        if (v === "taller" && e.name === "Taller Sa Penya") return true;
        return false;
      });
      return found?.[0];
    })
    .filter(Boolean) as string[];

  const posByRid = new Map<string, { gross: number; covers: number; latestDate: string | null }>();
  for (const r of rids) posByRid.set(r, { gross: 0, covers: 0, latestDate: null });
  if (rids.length) {
    const { data: pos } = await sb
      .from("eod_pos")
      .select("restaurant_id,date,total_gross_eur,covers")
      .in("restaurant_id", rids)
      .gte("date", since)
      .order("date", { ascending: false });
    for (const row of pos || []) {
      const rid = String(row.restaurant_id);
      const b = posByRid.get(rid);
      if (!b) continue;
      b.gross += Number(row.total_gross_eur || 0);
      b.covers += Number(row.covers || 0);
      if (!b.latestDate || String(row.date) > b.latestDate) b.latestDate = String(row.date);
    }
  }

  // ── VERIFIED revenue MTD from eod_accounting (Holded truth) ──
  const accByRid = new Map<string, number>();
  for (const r of rids) accByRid.set(r, 0);
  if (rids.length) {
    const { data: acc } = await sb
      .from("eod_accounting")
      .select("restaurant_id,report_date,total_gross_eur")
      .in("restaurant_id", rids)
      .gte("report_date", since);
    for (const row of acc || []) {
      const rid = String(row.restaurant_id);
      if (!accByRid.has(rid)) continue;
      accByRid.set(rid, (accByRid.get(rid) || 0) + Number(row.total_gross_eur || 0));
    }
  }

  const totalPos = Array.from(posByRid.values()).reduce((s, b) => s + b.gross, 0);
  const totalAcc = Array.from(accByRid.values()).reduce((s, n) => s + n, 0);
  const totalCovers = Array.from(posByRid.values()).reduce((s, b) => s + b.covers, 0);

  // ── Cash across entities (bank_accounts if populated, else bank_movements) ──
  type EntityCash = { code: string; label: string; balance: number | null; source: "bank_accounts" | "bank_movements" | "empty" };
  const cashRows: EntityCash[] = [
    { code: "BM",  label: "Bistro Mondo",   balance: null, source: "empty" },
    { code: "IFL", label: "Taller / Studio", balance: null, source: "empty" },
    { code: "BBH", label: "Holding (BBH)",  balance: null, source: "empty" },
  ];

  const { data: bal } = await sb.from("bank_accounts").select("entity_id,balance_eur");
  if (bal && bal.length) {
    for (const row of bal as any[]) {
      const code = String(row.entity_id || "").toUpperCase();
      const t = cashRows.find((c) => c.code === code);
      if (t) {
        t.balance = (t.balance || 0) + Number(row.balance_eur || 0);
        t.source = "bank_accounts";
      }
    }
  }
  if (cashRows.every((r) => r.balance === null)) {
    const { data: mv } = await sb.from("bank_movements").select("entity_id,amount_eur");
    if (mv && mv.length) {
      for (const row of mv as any[]) {
        const code = String(row.entity_id || "").toUpperCase();
        const t = cashRows.find((c) => c.code === code);
        if (t) {
          t.balance = (t.balance || 0) + Number(row.amount_eur || 0);
          t.source = "bank_movements";
        }
      }
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-4">
        <Link href="/studio" className="font-mono text-[10px] uppercase tracking-wide text-clay">← Food Studios</Link>
      </div>
      <h1 className="font-serif text-[34px] leading-[1.05] text-ink">Money</h1>
      <p className="mt-2 font-serif italic text-[14px] text-ink-soft">
        Portfolio finance — Food Studios as a whole. Click a house card to drop into its own books.
      </p>

      {/* ─── Portfolio P&L (BRUTO vs VERIFIED, never merged) ─────── */}
      <section className="mt-10">
        <p className="font-mono text-[11px] uppercase tracking-wide text-clay">Portfolio revenue · {monthLabel()} MTD</p>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border border-black/10 bg-paper/50 p-5">
            <p className="font-serif text-[28px] text-ink leading-none">{eur(totalPos)}</p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">POS BRUTO (eod_pos)</p>
          </div>
          <div className="rounded-lg border border-black/10 bg-paper/50 p-5">
            <p className="font-serif text-[28px] text-ink leading-none">{eur(totalAcc)}</p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">Verified (Holded)</p>
          </div>
          <div className="rounded-lg border border-black/10 bg-paper/50 p-5">
            <p className="font-serif text-[28px] text-ink leading-none">{totalCovers.toLocaleString("en-GB")}</p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">Covers MTD</p>
          </div>
        </div>
        <p className="mt-3 font-serif italic text-[12px] text-ink-soft">
          BRUTO and Verified are shown side-by-side and never merged — POS is what happened
          in the room, Holded is what settled. Gaps between them are the reconciliation queue.
        </p>
      </section>

      {/* ─── Per-house cards ───────────────────────────────────────── */}
      <section className="mt-10">
        <p className="font-mono text-[11px] uppercase tracking-wide text-clay">By house</p>
        <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {houses.map((e: any) => {
            const rid = ENTITY_TO_RESTAURANT[e.name === "Bistro Mondo" ? "bistro_mondo" : "taller"];
            const pos = rid ? posByRid.get(rid) : null;
            const accGross = rid ? accByRid.get(rid) || 0 : 0;
            const ent = rid ? RESTAURANT_TO_ENTITY[rid] : null;
            const slug = houseSlugForEntity(ent);
            const href = slug ? `/h/${slug}/money` : `/administrate/finance`;
            return (
              <li key={e.id}>
                <Link
                  href={href}
                  className="block rounded-lg border border-black/10 bg-paper/50 p-5 transition hover:border-ink/40 hover:bg-paper"
                >
                  <p className="font-serif text-[20px] text-ink leading-tight">{e.name}</p>
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
                    <p className="font-sans text-[13px] text-ink-soft">BRUTO MTD</p>
                    <p className="text-right font-mono text-[13px] text-ink">{eur(pos?.gross || 0)}</p>
                    <p className="font-sans text-[13px] text-ink-soft">Verified MTD</p>
                    <p className="text-right font-mono text-[13px] text-ink">{eur(accGross)}</p>
                    <p className="font-sans text-[13px] text-ink-soft">Covers</p>
                    <p className="text-right font-mono text-[13px] text-ink">{(pos?.covers || 0).toLocaleString("en-GB")}</p>
                  </div>
                  <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-clay">
                    Open this house →
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ─── Intercompany ──────────────────────────────────────────── */}
      <section className="mt-10">
        <p className="font-mono text-[11px] uppercase tracking-wide text-clay">Intercompany · known context</p>
        <ul className="mt-3 divide-y divide-black/10 border-t border-black/10">
          <li className="py-3">
            <p className="font-serif text-[16px] text-ink">BM ↔ IFL — Aug 2026 mismatch €9,961</p>
            <p className="mt-1 font-serif italic text-[13px] text-ink-soft">
              BM books 13,100; IFL books 3,139. Sourced from memory
              (bm_ifl_intercompany_mismatch_aug2026). Route to reconciliation before close.
            </p>
          </li>
          <li className="py-3">
            <p className="font-serif text-[16px] text-ink">BBH — €3,960 credit unexplained (Aug 2026)</p>
            <p className="mt-1 font-serif italic text-[13px] text-ink-soft">
              No GL entries all August (bbh_unexplained_3960_credit_aug2026). Blind bank
              movement waiting on documentation.
            </p>
          </li>
        </ul>
        <p className="mt-3 font-serif italic text-[12px] text-ink-soft">
          Live intercompany ledger — coming to a future push. Today the deltas above are
          surfaced from the crisis register so this page never lies about IC being clean.
        </p>
      </section>

      {/* ─── Cash across entities ──────────────────────────────────── */}
      <section className="mt-10">
        <p className="font-mono text-[11px] uppercase tracking-wide text-clay">Cash across entities</p>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {cashRows.map((c) => (
            <div key={c.code} className="rounded-lg border border-black/10 bg-paper/50 p-5">
              <p className="font-serif text-[22px] text-ink leading-none">
                {c.balance === null ? "—" : eur(c.balance)}
              </p>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">
                {c.label}
              </p>
              <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay/70">
                {c.source === "bank_accounts" ? "latest balance" : c.source === "bank_movements" ? "sum of movements" : "no data"}
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
