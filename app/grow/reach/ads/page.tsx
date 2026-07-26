import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { getAccountState as metaGetAccountState } from "@/lib/integrations/marketing/meta-ads";
import { REACTIVATION_STEPS, computeReadiness } from "@/lib/social/reactivation";
import type { EntityCode } from "@/lib/integrations/types";
import type { MetaAccountState } from "@/lib/integrations/marketing/meta-ads";
import AdsReactivationChecklist from "./AdsReactivationChecklist";
import AdsInsightsChart from "./AdsInsightsChart";

export const dynamic = "force-dynamic";

type EntityOpt = "IFL" | "BM";
const ENTITIES: { code: EntityOpt; brand: string }[] = [
  { code: "IFL", brand: "Ibiza Food Studios" },
  { code: "BM",  brand: "Bistro Mondo" },
];

// Grow · Reach · Ads.
//
// Read-only Meta ads surface, purpose-built around the BM situation:
//   · account has been DISABLED since 2026-04-04 (payment method failed)
//   · Marie's email exists as a draft, card rotation task is elsewhere
//   · Boris needs one page where he can see the status, tick off the
//     reactivation steps, and know when he's ready to flip it back on
//
// The historic performance chart lands once the Meta token is live — until
// then it renders an empty state ("Not connected yet"). The status pill and
// checklist work with or without the token.

async function isConnected(entity: EntityCode, vendor: string): Promise<boolean> {
  try {
    const sb = supabaseServer();
    const { data } = await sb.from("entity_integrations")
      .select("id").eq("entity_code", entity).eq("platform", vendor)
      .is("revoked_at", null).limit(1).maybeSingle();
    return !!data?.id;
  } catch { return false; }
}

async function loadState(entity: EntityCode, connected: boolean): Promise<MetaAccountState | null> {
  if (!connected) return null;
  try { return await metaGetAccountState(entity); } catch { return null; }
}

async function loadReactivation(entity: EntityCode) {
  try {
    const sb = supabaseServer();
    const { data } = await sb.from("platform_reactivation_state")
      .select("step_key,done,done_at,notes")
      .eq("entity_code", entity).eq("platform", "meta-ads");
    return (data || []) as Array<{ step_key: string; done: boolean; done_at: string | null; notes: string | null }>;
  } catch {
    return [];
  }
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso; }
}

const DISABLED_LABEL: Record<number, { label: string; blurb: string }> = {
  2: { label: "Disabled", blurb: "Payment method failed 2026-04-04. Restart blocked until card rotated + budget set." },
  3: { label: "Unsettled", blurb: "Outstanding balance on the account." },
  7: { label: "Under review", blurb: "Meta is reviewing the account." },
  8: { label: "Pending settlement", blurb: "Waiting for a payment to settle." },
  9: { label: "Grace period", blurb: "In grace after a failed charge." },
  100: { label: "Pending closure", blurb: "Scheduled to close." },
  101: { label: "Closed", blurb: "Account closed by Meta." },
};

export default async function AdsPage({ searchParams }: { searchParams: { entity?: string } }) {
  const raw = (searchParams?.entity || "BM").toUpperCase();
  const entity: EntityOpt = (raw === "IFL" ? "IFL" : "BM");
  const brand = ENTITIES.find((e) => e.code === entity)!.brand;
  const accent = entity === "BM" ? "#9A3122" : "#3F4C28";

  const connected = await isConnected(entity, "meta-ads");
  const [state, checklist] = await Promise.all([
    loadState(entity, connected),
    loadReactivation(entity),
  ]);

  const doneMap = new Map(checklist.map((r) => [r.step_key, r]));
  const readiness = computeReadiness(REACTIVATION_STEPS.map((s) => ({ step_key: s.key, done: !!doneMap.get(s.key)?.done })));

  const statusCode = state?.status_code ?? null;
  const isDisabled = statusCode !== null && statusCode !== 1;
  const disabledInfo = statusCode != null ? DISABLED_LABEL[statusCode] : null;

  return (
    <main className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl px-6 py-12" style={{ ["--accent" as any]: accent }}>
      <Link href="/grow/reach" className="font-sans text-sm text-ink-soft">← Reach</Link>
      <div className="mt-6 flex items-baseline justify-between gap-6">
        <div>
          <p className="font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Grow · reach · ads</p>
          <h1 className="mt-2 font-serif text-3xl text-ink">Meta ads</h1>
          <p className="mt-2 max-w-2xl lg:max-w-5xl font-sans text-[13px] leading-relaxed text-ink-soft">
            Read-only view of the {brand} ad account. When it's ready to reactivate, the checklist below marks it green.
          </p>
        </div>
        <nav className="flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-wide">
          {ENTITIES.map((e) => (
            <Link
              key={e.code}
              href={`/grow/reach/ads?entity=${e.code}`}
              className={`rounded-full border px-3 py-1 ${entity === e.code ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:border-ink-soft"}`}
            >
              {e.brand}
            </Link>
          ))}
        </nav>
      </div>

      {/* -------- STATUS -------- */}
      <section className="mt-8 rounded-2xl border border-line bg-paper p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">account status</p>
            <h2 className="mt-1 font-serif text-xl text-ink">{state?.name || `Ad account ${state?.account_id || (entity === "BM" ? "605781129956113" : "—")}`}</h2>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted">
              act_{state?.account_id || (entity === "BM" ? "605781129956113" : "—")}
            </p>
          </div>
          <span
            className={`inline-block rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wide ${
              statusCode === 1 ? "border-basil/40 bg-basil/10 text-basil"
              : isDisabled ? "border-tomato/40 bg-tomato/10 text-tomato"
              : "border-line bg-paper-deep text-muted"
            }`}
          >
            {state?.status_label || (connected ? "Unknown" : "Not connected")}
            {isDisabled && statusCode === 2 ? " · since 2026-04-04" : ""}
          </span>
        </div>
        {disabledInfo && isDisabled ? (
          <p className="mt-3 rounded border border-tomato/40 bg-tomato/10 px-2 py-1 font-mono text-[10px] text-tomato">
            {disabledInfo.blurb}
          </p>
        ) : null}
        {!connected ? (
          <p className="mt-3 font-sans text-[12px] italic text-ink-soft">
            Meta ad access isn't connected on {brand} yet. Once Boris pastes the ads_read token, this tile shows live status, and the chart below back-fills.
          </p>
        ) : null}
      </section>

      {/* -------- REACTIVATION -------- */}
      <section className="mt-6 rounded-2xl border border-line bg-paper p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">reactivation checklist</p>
            <h2 className="mt-1 font-serif text-xl text-ink">Get it back on</h2>
          </div>
          <span
            className={`inline-block rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wide ${
              readiness.ready ? "border-basil/40 bg-basil/10 text-basil" : "border-line bg-paper-deep text-muted"
            }`}
          >
            {readiness.done}/{readiness.total} · {readiness.ready ? "reactivate ready" : "not ready"}
          </span>
        </div>

        {/* Guidance banner — where the wet-work lives. */}
        <div className="mt-4 rounded border border-line bg-paper-deep p-3 font-sans text-[12px] leading-relaxed text-ink-soft">
          Marie's handoff email is a draft in the assistant inbox. Card rotation is tracked with the payment_method_rotation memo — look for the task
          {" "}<Link href="/administrate/tasks?tag=payment_method_rotation" className="underline">in Admin · Tasks</Link>.
          When both are done, tick them below and the pill flips green.
        </div>

        <AdsReactivationChecklist
          entity={entity}
          initial={REACTIVATION_STEPS.map((s) => ({
            key: s.key,
            label: s.label,
            hint: s.hint,
            done: !!doneMap.get(s.key)?.done,
            done_at: doneMap.get(s.key)?.done_at || null,
            notes: doneMap.get(s.key)?.notes || "",
          }))}
        />
      </section>

      {/* -------- INSIGHTS -------- */}
      <section className="mt-6 rounded-2xl border border-line bg-paper p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-clay">performance · last 90 days</p>
            <h2 className="mt-1 font-serif text-xl text-ink">Spend & reach</h2>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted">
            {state?.spend_last_30d != null ? `€${Math.round(state.spend_last_30d)} · 30d` : "no spend on file"}
          </p>
        </div>
        {!connected ? (
          <div className="mt-4 rounded-lg border border-dashed border-line bg-paper-deep p-8 text-center">
            <p className="font-sans text-[13px] italic text-ink-soft">Historic performance lands once the Meta token is in.</p>
            <p className="mt-2 font-sans text-[12px] text-ink-soft">
              Connect Meta ads on the <Link href={`/grow/reach?entity=${entity}`} className="underline">Reach hub</Link> to unlock the chart.
            </p>
          </div>
        ) : (
          <AdsInsightsChart entity={entity} />
        )}
      </section>
    </main>
  );
}
