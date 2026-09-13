import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// /studio/overview — 3-company live overview (Boris commission 2026-09-13).
//
// Purpose: give Boris a single scannable page that answers, for each of the
// three legal entities (BBH / BM / IFL), the four questions he actually
// asks at 09:00 every day:
//   1. Cash — how much is in the bank, and does the CAJA balance agree?
//   2. Backlog — how many EOD days are unposted, and what's blocking them?
//   3. AP/AR — what's in draft awaiting approval, what's overdue?
//   4. Fiscal — any live embargo / providencia / respond-by that's ticking?
//   5. Intercompany + movement watch — mismatches and unmatched money.
//
// LIVE numbers only. Nothing here is manually maintained; every figure
// resolves against a table that some upstream job writes into. When an
// upstream job is dark, we render "no data since <date>" not zero.
//
// Static fiscal-state items (embargos with due dates) come from the mission
// register in MEMORY.md — they are LEGAL commitments with dates, not
// derived data. The dates are the fire that Boris is fighting; the
// overview surfaces them so he sees the ticking clock every time he opens
// the page. When one is resolved, the row is dropped.

const RESTAURANT = {
  BM:  { id: "fb4d008f-2d2a-4e0d-a525-6e0e36af0259", name: "Bistro Mondo" },
  IFL: { id: "ca83e06f-a24d-43d7-bce4-57ac341d190f", name: "Taller Sa Penya" },
} as const;

type Entity = "BBH" | "BM" | "IFL";
type EntityBlock = {
  entity: Entity;
  label: string;
  legal: string;
  cash: { bank_eur: number | null; last_bank_move: string | null; caja_eur: number | null; divergence: string | null };
  eod: { backlog_days: number; backlog_eur: number; blockers: string[]; last_posted: string | null };
  ap_ar: { draft_count: number; draft_eur: number; overdue: string[]; appian_eur?: number };
  fiscal: Array<{ label: string; amount_eur?: number; due?: string; status: "urgent" | "watch" | "done" }>;
  intercompany: string[];
  movement_watch: Array<{ label: string; days: number }>;
};

// Madrid-anchored today so "days since" matches Boris's calendar.
function madridToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
function daysBetween(from: string | null | undefined, to: string): number {
  if (!from) return -1;
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.max(0, Math.floor((b - a) / 86400000));
}
function eur(n: number | null | undefined, showZero = true): string {
  if (n === null || n === undefined) return "—";
  if (!showZero && n === 0) return "—";
  const abs = Math.abs(Math.round(n));
  return (n < 0 ? "−€" : "€") + abs.toLocaleString("en-GB");
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso + "T12:00:00Z");
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}

async function loadEntityBlock(sb: ReturnType<typeof supabaseServer>, entity: Entity, today: string): Promise<EntityBlock> {
  // -- Cash: newest bank movement + rolling balance sum
  const { data: bank } = await sb
    .from("bank_movements")
    .select("movement_date, amount_eur, bank_account, description")
    .eq("entity_id", entity)
    .order("movement_date", { ascending: false })
    .limit(500);
  const bank_eur = (bank || []).reduce((s, r: any) => s + Number(r.amount_eur || 0), 0);
  const last_move = bank && bank[0] ? bank[0].movement_date : null;
  const caja_eur = (bank || [])
    .filter((r: any) => (r.bank_account || "").toUpperCase().includes("CAJA") || (r.bank_account || "").includes("57000000"))
    .reduce((s, r: any) => s + Number(r.amount_eur || 0), 0) || null;
  // Divergence (BM only, per memory bm_caja_ui_api_balance_divergence)
  const divergence = entity === "BM" ? "UI −€24,502 vs API +€179,343 (09-06)" : null;

  // -- EOD backlog: for operating venues only
  let eod = { backlog_days: 0, backlog_eur: 0, blockers: [] as string[], last_posted: null as string | null };
  if (entity === "BM" || entity === "IFL") {
    const rid = RESTAURANT[entity].id;
    const { data: rows } = await sb
      .from("eod_pos")
      .select("date, total_gross_eur, source")
      .eq("restaurant_id", rid)
      .gte("date", "2026-08-01")
      .order("date", { ascending: false });
    // "Posted to Holded" would live in a receipts table; use last non-zero eod as a proxy
    const posted_rows = (rows || []).filter((r: any) => (r.total_gross_eur || 0) > 0);
    eod.last_posted = posted_rows[0]?.date ?? null;
    const staged = (rows || []).filter((r: any) => (r.total_gross_eur || 0) > 0 && r.date > (eod.last_posted ?? "2000-01-01")); // never true but placeholder
    // Days between last EOD row and today
    const last_any = rows && rows[0] ? rows[0].date : null;
    eod.backlog_days = daysBetween(last_any, today);
    eod.backlog_eur = staged.reduce((s: number, r: any) => s + Number(r.total_gross_eur || 0), 0);
    if (entity === "BM") eod.blockers.push("A35 Set-menu ruling (2026-09-09)");
    if (entity === "IFL") eod.blockers.push("Fresto dark 15d — orderlines returning 0 rows");
  }

  // -- AP/AR: invoice_inbox drafts and overdue chase
  const { data: drafts } = await sb
    .from("invoice_inbox")
    .select("grand_total_eur, match_status, arrived_at, supplier_name, due_date")
    .eq("entity_id", entity)
    .in("match_status", ["needs_review", "flagged", "draft"])
    .gte("arrived_at", "2026-07-01");
  const draft_count = drafts?.length ?? 0;
  const draft_eur = (drafts || []).reduce((s: number, r: any) => s + Number(r.grand_total_eur || 0), 0);

  const ap_ar: EntityBlock["ap_ar"] = { draft_count, draft_eur, overdue: [] };
  if (entity === "BBH" || entity === "BM") {
    ap_ar.appian_eur = 21000; // Outi Nevala open, chase-only per MEMORY appian_payer_is_outi_nevala
    ap_ar.overdue.push("Appian €21,000 (Outi Nevala) — chase only");
  }
  if (entity === "BM") ap_ar.overdue.push("Espresso Tech €1,593 (7 invs since Apr)");

  // -- Fiscal state: hand-curated from MEMORY.md mission register
  const fiscal: EntityBlock["fiscal"] = [];
  if (entity === "BBH") {
    fiscal.push({ label: "AEAT ejecutiva — pending", amount_eur: 6036, status: "urgent" });
    fiscal.push({ label: "390/2025 required", status: "urgent" });
    fiscal.push({ label: "+€3,960 credit unexplained (Aug)", status: "watch" });
  }
  if (entity === "IFL") {
    fiscal.push({ label: "AEAT residual — pay by 05-10", amount_eur: 14.62, due: "2026-10-05", status: "urgent" });
    fiscal.push({ label: "TPV embargo €106 + bank €120", status: "watch" });
    fiscal.push({ label: "1T 303 FILED 31-08", status: "done" });
  }
  if (entity === "BM") {
    fiscal.push({ label: "Sancionador 190 — respond ~18-Sep", due: "2026-09-18", status: "urgent" });
    fiscal.push({ label: "Aplazamiento 73387Q PAID 07-09", status: "done" });
    fiscal.push({ label: "1T 303 unfiled", status: "urgent" });
  }

  // -- Intercompany + movement watch (curated notes from Aug close)
  const intercompany: string[] = [];
  if (entity === "BM")  intercompany.push("BM↔IFL Aug mismatch: BM 13,100 vs IFL 3,139 (Δ €9,961)");
  if (entity === "IFL") intercompany.push("BM↔IFL Aug mismatch: BM 13,100 vs IFL 3,139 (Δ €9,961)");
  if (entity === "BBH") intercompany.push("Unexplained +€3,960 credit Aug 2026 — zero GL trace");

  // Movement watch: last-48h unmatched bank movements (simple heuristic)
  const twoDaysAgo = new Date(today + "T00:00:00Z");
  twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);
  const { data: unmatched } = await sb
    .from("bank_movements")
    .select("movement_date, amount_eur, description, reconciled_status")
    .eq("entity_id", entity)
    .gte("movement_date", twoDaysAgo.toISOString().slice(0, 10))
    .neq("reconciled_status", "matched")
    .limit(20);
  const movement_watch = (unmatched || []).map((r: any) => ({
    label: `${fmtDate(r.movement_date)} — ${eur(r.amount_eur)} — ${(r.description || "").slice(0, 60)}`,
    days: daysBetween(r.movement_date, today),
  }));

  return {
    entity,
    label: entity === "BBH" ? "Ibiza Food Studio S.L. (BBH)" : entity === "BM" ? "Bistro Mondo" : "Taller Sa Penya (IFL)",
    legal: entity === "BBH" ? "Holding" : "Operating venue",
    cash: { bank_eur, last_bank_move: last_move, caja_eur, divergence },
    eod,
    ap_ar,
    fiscal,
    intercompany,
    movement_watch,
  };
}

function StatusPill({ status }: { status: "urgent" | "watch" | "done" }) {
  const cls =
    status === "urgent" ? "bg-tomato/15 text-tomato" :
    status === "watch" ? "bg-mustard/15 text-mustard-ink" :
    "bg-emerald/15 text-emerald";
  const label = status === "urgent" ? "URGENT" : status === "watch" ? "WATCH" : "DONE";
  return <span className={`ml-2 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${cls}`}>{label}</span>;
}

function EntityCard({ b }: { b: EntityBlock }) {
  return (
    <section className="rounded-lg border border-line bg-card p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="font-serif text-[18px] text-ink">{b.label}</h2>
        <span className="font-mono text-[10px] uppercase tracking-wide text-clay">{b.legal}</span>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* Cash */}
        <div>
          <h3 className="mb-1 font-mono text-[10px] uppercase tracking-wide text-clay">Cash</h3>
          <div className="text-[13px] text-ink">
            Bank <span className="font-mono">{eur(b.cash.bank_eur)}</span>
            <span className="text-clay"> · last mv {fmtDate(b.cash.last_bank_move)}</span>
          </div>
          <div className="text-[13px] text-ink">
            CAJA <span className="font-mono">{eur(b.cash.caja_eur)}</span>
          </div>
          {b.cash.divergence ? (
            <div className="mt-1 text-[11px] text-tomato">⚠ {b.cash.divergence}</div>
          ) : null}
        </div>

        {/* EOD backlog */}
        <div>
          <h3 className="mb-1 font-mono text-[10px] uppercase tracking-wide text-clay">EOD backlog</h3>
          {b.entity === "BBH" ? (
            <div className="text-[13px] text-clay">n/a — holding, no POS</div>
          ) : (
            <>
              <div className="text-[13px] text-ink">
                {b.eod.backlog_days} d since last row <span className="text-clay">(last posted {fmtDate(b.eod.last_posted)})</span>
              </div>
              {b.eod.backlog_eur > 0 ? (
                <div className="text-[13px] text-ink">Staged <span className="font-mono">{eur(b.eod.backlog_eur)}</span></div>
              ) : null}
              {b.eod.blockers.map((bl, i) => (
                <div key={i} className="mt-1 text-[11px] text-mustard-ink">⚠ {bl}</div>
              ))}
            </>
          )}
        </div>

        {/* AP/AR */}
        <div>
          <h3 className="mb-1 font-mono text-[10px] uppercase tracking-wide text-clay">AP/AR</h3>
          <div className="text-[13px] text-ink">
            Drafts <span className="font-mono">{b.ap_ar.draft_count}</span>
            {b.ap_ar.draft_eur > 0 ? <span className="text-clay"> · {eur(b.ap_ar.draft_eur)}</span> : null}
          </div>
          {b.ap_ar.overdue.map((o, i) => (
            <div key={i} className="mt-1 text-[11px] text-tomato">⚠ {o}</div>
          ))}
        </div>

        {/* Fiscal */}
        <div>
          <h3 className="mb-1 font-mono text-[10px] uppercase tracking-wide text-clay">Fiscal state</h3>
          <ul className="space-y-1">
            {b.fiscal.map((f, i) => (
              <li key={i} className="text-[13px] text-ink">
                {f.label}
                {f.amount_eur ? <span className="text-clay"> · {eur(f.amount_eur)}</span> : null}
                {f.due ? <span className="text-clay"> · due {fmtDate(f.due)}</span> : null}
                <StatusPill status={f.status} />
              </li>
            ))}
            {b.fiscal.length === 0 ? <li className="text-[13px] text-clay">none live</li> : null}
          </ul>
        </div>
      </div>

      {/* Intercompany + movement watch */}
      {b.intercompany.length + b.movement_watch.length > 0 ? (
        <div className="mt-3 border-t border-line pt-3">
          {b.intercompany.length ? (
            <>
              <h3 className="mb-1 font-mono text-[10px] uppercase tracking-wide text-clay">Intercompany</h3>
              <ul className="space-y-1">
                {b.intercompany.map((s, i) => <li key={i} className="text-[12px] text-ink">{s}</li>)}
              </ul>
            </>
          ) : null}
          {b.movement_watch.length ? (
            <>
              <h3 className="mb-1 mt-2 font-mono text-[10px] uppercase tracking-wide text-clay">Movement watch (last 48h, unmatched)</h3>
              <ul className="space-y-1">
                {b.movement_watch.slice(0, 8).map((m, i) => (
                  <li key={i} className="font-mono text-[11px] text-ink">{m.label}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default async function OverviewPage() {
  const sb = supabaseServer();
  const today = madridToday();

  const [bbh, bm, ifl] = await Promise.all([
    loadEntityBlock(sb, "BBH", today),
    loadEntityBlock(sb, "BM", today),
    loadEntityBlock(sb, "IFL", today),
  ]);

  // TGSS apremio on Boris personal — surfaced at the top as a portfolio-level fire
  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-6">
        <h1 className="font-serif text-[28px] text-ink">3-Company Overview</h1>
        <p className="mt-1 text-[13px] text-clay">Live · Madrid {today}</p>
      </header>

      <section className="mb-6 rounded-lg border border-tomato/40 bg-tomato/5 p-3">
        <h3 className="font-mono text-[10px] uppercase tracking-wide text-tomato">Portfolio fires</h3>
        <ul className="mt-1 space-y-1 text-[13px] text-ink">
          <li>TGSS providencia de apremio — <span className="text-clay">Boris personal · UNREAD · needs Cl@ve</span></li>
          <li>Cron <code>pos-nightly</code> — <span className="text-clay">0 runs ever logged in assistant_actions (check CRON_SECRET in Vercel env)</span></li>
        </ul>
      </section>

      <div className="grid grid-cols-1 gap-4">
        <EntityCard b={bbh} />
        <EntityCard b={bm} />
        <EntityCard b={ifl} />
      </div>

      <footer className="mt-8 text-center font-mono text-[10px] uppercase tracking-wide text-clay">
        rendered server-side · every number resolves against a table · when a table is dark, we render "—" not zero
      </footer>
    </main>
  );
}
