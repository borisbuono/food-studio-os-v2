import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { isScopeAwaitingCopy } from "@/content/funnel/config";
import GrowthBoard from "./GrowthBoard";

export const dynamic = "force-dynamic";

// /studio/growth — Studio-scope sales funnel dashboard.
//
// Overnight 2026-09-11 scaffolding. Kanban of leads across every venue in
// the portfolio: New → Contacted → Qualified → Converted/Lost. Cards show
// name + entity + intent + requested date + source + created at. Click a
// card to open the drawer with the full lead, the touch timeline, and
// state/touch actions.
//
// Studio-scope only — this is the portfolio view. Per-venue views come
// later once we know what filters the operators actually want.

type LeadRow = {
  id: string;
  entity_id: string | null;
  source: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  party_size: number | null;
  intent: string | null;
  requested_date: string | null;
  message: string | null;
  state: string;
  created_at: string;
  updated_at: string;
  assigned_to: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  landing_url: string | null;
  referrer_url: string | null;
};

type EntityRow = { id: string; name: string; entity_type: string | null };

function madridToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function startOfWeekIso(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun
  const diff = (day + 6) % 7; // days since Monday
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString();
}

export default async function StudioGrowthPage() {
  const sb = supabaseServer();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) redirect("/welcome");

  // Load entities so we can name each lead's venue in the UI.
  const { data: entitiesRaw } = await sb
    .from("entities")
    .select("id, name, entity_type, is_active, status")
    .eq("is_active", true);
  const entities: EntityRow[] = ((entitiesRaw as any[]) || [])
    .filter((r) => (r.status ?? "active") !== "ended")
    .map((r) => ({ id: r.id, name: r.name, entity_type: r.entity_type }));

  // All leads — capped at the most recent 500 so the initial paint doesn't
  // ever punish us. Filter / paging comes later.
  const { data: leadsRaw, error: leadsErr } = await sb
    .from("leads")
    .select("id, entity_id, source, name, email, phone, party_size, intent, requested_date, message, state, created_at, updated_at, assigned_to, utm_source, utm_medium, utm_campaign, landing_url, referrer_url")
    .order("created_at", { ascending: false })
    .limit(500);
  const leads: LeadRow[] = (leadsRaw as LeadRow[]) || [];

  // If the table isn't there yet (migration not applied on this env), don't
  // 500 the page — show a soft placeholder so /studio/growth renders and
  // the operator can see the shape.
  const tableMissing = !!(leadsErr && /leads.*does not exist/i.test(leadsErr.message || ""));

  // Overview counts — this-week + all-time by state.
  const weekStart = startOfWeekIso();
  const thisWeek = leads.filter((l) => l.created_at >= weekStart);
  const overview = {
    new_week: thisWeek.filter((l) => l.state === "new").length,
    contacted_week: thisWeek.filter((l) => l.state === "contacted").length,
    qualified_week: thisWeek.filter((l) => l.state === "qualified").length,
    converted_week: thisWeek.filter((l) => l.state === "converted").length,
    lost_week: thisWeek.filter((l) => l.state === "lost").length,
    total_week: thisWeek.length,
    total_all: leads.length,
  };
  const convRateWeek =
    thisWeek.length > 0
      ? Math.round((overview.converted_week / thisWeek.length) * 100)
      : null;

  const copyPending = ["studio", "bm", "taller"].some((s) => isScopeAwaitingCopy(s as any));

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 px-6 py-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <div className="text-xs uppercase tracking-[0.18em] text-slate-500 mb-1">Studio · Growth</div>
            <h1 className="text-2xl font-serif">Sales funnel</h1>
          </div>
          <div className="text-xs text-slate-500">
            <Link href="/leads/capture?entity=studio" className="underline">Test the capture form</Link>
          </div>
        </div>

        {copyPending ? (
          <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Funnel copy is still placeholder in <code>content/funnel/config.ts</code>. The comm/design agent lands brand strings next.
          </div>
        ) : null}

        {tableMissing ? (
          <div className="mb-6 rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
            The <code>leads</code> table has not been applied on this environment yet. Run the migration and refresh.
          </div>
        ) : null}

        <section className="mb-8 grid grid-cols-2 sm:grid-cols-6 gap-3">
          <StatCard label="New (wk)" value={overview.new_week} />
          <StatCard label="Contacted (wk)" value={overview.contacted_week} />
          <StatCard label="Qualified (wk)" value={overview.qualified_week} />
          <StatCard label="Converted (wk)" value={overview.converted_week} />
          <StatCard label="Lost (wk)" value={overview.lost_week} />
          <StatCard label="Conv. rate (wk)" value={convRateWeek == null ? "—" : `${convRateWeek}%`} />
        </section>

        <GrowthBoard leads={leads} entities={entities} />
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md bg-white border border-slate-200 px-3 py-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      <div className="text-lg font-serif">{value}</div>
    </div>
  );
}
