import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { listCampaigns as wixListCampaigns, listAudiences as wixListAudiences } from "@/lib/integrations/marketing/wix-newsletter";
import { getAccountState as metaGetAccountState, listCampaigns as metaListCampaigns } from "@/lib/integrations/marketing/meta-ads";
import ConnectIntegration from "@/app/administrate/finance/setup/[entity]/ConnectIntegration";
import type { EntityCode } from "@/lib/integrations/types";
import type { WixCampaignSummary, WixAudienceSummary } from "@/lib/integrations/marketing/wix-newsletter";
import type { MetaAccountState, MetaCampaignRow } from "@/lib/integrations/marketing/meta-ads";

export const dynamic = "force-dynamic";

type EntityOpt = "IFL" | "BM";
const ENTITIES: { code: EntityOpt; brand: string }[] = [
  { code: "IFL", brand: "Ibiza Food Studios" },
  { code: "BM",  brand: "Bistro Mondo" },
];

function fmtEUR(n: number | null | undefined, currency = "EUR") {
  if (n == null || Number.isNaN(n)) return "—";
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(n); }
  catch { return `${n.toFixed(0)} ${currency}`; }
}
function fmtInt(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-GB").format(n);
}
function fmtPct(rate: number | null | undefined) {
  if (rate == null || Number.isNaN(rate)) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}
function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return iso; }
}

async function loadWix(entity: EntityCode): Promise<{ campaigns: WixCampaignSummary[]; audience: WixAudienceSummary | null; err?: string }> {
  try {
    const [campaigns, audience] = await Promise.all([
      wixListCampaigns(entity, 10).catch((e: any) => { throw e; }),
      wixListAudiences(entity).catch(() => null),
    ]);
    return { campaigns, audience };
  } catch (e: any) {
    return { campaigns: [], audience: null, err: e?.message || String(e) };
  }
}
async function loadMeta(entity: EntityCode): Promise<{ state: MetaAccountState | null; campaigns: MetaCampaignRow[]; err?: string }> {
  try {
    const state = await metaGetAccountState(entity);
    let campaigns: MetaCampaignRow[] = [];
    // Campaign list requires the token; skip on error and let the account tile
    // still render (disabled account cases + no-token cases both hit this path).
    try { campaigns = await metaListCampaigns(entity, 20); } catch {}
    return { state, campaigns };
  } catch (e: any) {
    return { state: null, campaigns: [], err: e?.message || String(e) };
  }
}

async function isConnected(entity: EntityCode, vendor: string): Promise<boolean> {
  try {
    const sb = supabaseServer();
    const { data } = await sb.from("entity_integrations")
      .select("id").eq("entity_code", entity).eq("platform", vendor)
      .is("revoked_at", null).limit(1).maybeSingle();
    return !!data?.id;
  } catch { return false; }
}

export default async function GrowReach({ searchParams }: { searchParams: { entity?: string } }) {
  const raw = (searchParams?.entity || "IFL").toUpperCase();
  const entity: EntityOpt = (raw === "BM" ? "BM" : "IFL");
  const meta = ENTITIES.find((e) => e.code === entity)!;

  const [wixConn, metaConn] = await Promise.all([
    isConnected(entity, "wix-newsletter"),
    isConnected(entity, "meta-ads"),
  ]);
  type WixLoad  = { campaigns: WixCampaignSummary[]; audience: WixAudienceSummary | null; err?: string };
  type MetaLoad = { state: MetaAccountState | null; campaigns: MetaCampaignRow[]; err?: string };
  const [wix, metaAds] = await Promise.all([
    (wixConn ? loadWix(entity) : Promise.resolve({ campaigns: [], audience: null } as WixLoad)) as Promise<WixLoad>,
    (metaConn ? loadMeta(entity) : Promise.resolve({ state: null, campaigns: [] } as MetaLoad)) as Promise<MetaLoad>,
  ]);

  // Sends this month = sum of sent_count for campaigns with sent_at in current month
  const now = new Date();
  const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const sendsThisMonth = wix.campaigns
    .filter((c) => c.sent_at && new Date(c.sent_at) >= thisMonthStart)
    .reduce((sum, c) => sum + (c.sent_count || 0), 0);
  const lastCampaign = wix.campaigns.find((c) => c.sent_at) || null;

  // Currency for Meta EUR — use account currency if we have it, else EUR
  const currency = metaAds.state?.currency || "EUR";

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <Link href="/grow" className="font-sans text-sm text-ink-soft">← Grow</Link>
      <div className="mt-6 flex items-baseline justify-between gap-6">
        <div>
          <p className="font-sans text-xs font-medium text-tomato">Grow · reach</p>
          <h1 className="mt-2 font-serif text-3xl text-ink">Campaigns</h1>
          <p className="mt-2 font-sans text-[13px] leading-relaxed text-ink-soft">
            Newsletter goes through Wix — same list your Wix site already writes to. Paid social is the Meta ad account, read-only for now.
          </p>
        </div>
        <nav className="flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-wide">
          {ENTITIES.map((e) => (
            <Link
              key={e.code}
              href={`/grow/reach?entity=${e.code}`}
              className={`rounded-full border px-3 py-1 ${entity === e.code ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:border-ink-soft"}`}
            >
              {e.brand}
            </Link>
          ))}
        </nav>
      </div>

      <nav className="mt-6 flex flex-wrap items-baseline gap-2 border-t border-line pt-6 font-mono text-[10px] uppercase tracking-wide">
        <span className="text-clay">social workstream ·</span>
        <Link href={`/grow/reach/calendar?entity=${entity}`} className="rounded-full border border-line px-3 py-1 text-ink hover:border-ink-soft">calendar →</Link>
        
        <Link href={`/grow/reach/ads?entity=${entity}`} className="rounded-full border border-line px-3 py-1 text-ink hover:border-ink-soft">Meta ads →</Link>
      </nav>

      <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* -------- LEFT: Wix Newsletter -------- */}
        <section className="rounded-2xl border border-line bg-paper p-5">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">newsletter</p>
              <h2 className="mt-1 font-serif text-xl text-ink">Wix Newsletter</h2>
            </div>
            <span className={`inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${wixConn ? "border-basil/40 bg-basil/10 text-basil" : "border-line bg-paper-deep text-muted"}`}>
              {wixConn ? "connected" : "not connected"}
            </span>
          </div>

          {!wixConn ? (
            <div className="mt-5">
              <ConnectIntegration
                entity={entity}
                vendor="wix-newsletter"
                kind="marketing"
                label="Wix Newsletter"
                howto={`Wix Dashboard → Settings → API Keys → Create key with Email Marketing + Contacts scope. Paste as \`<account_id>:<api_key>\`.`}
              />
            </div>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Cell label="Subscribers" value={fmtInt(wix.audience?.contact_count)} />
                <Cell label="Sends this month" value={fmtInt(sendsThisMonth)} big />
                <Cell label="Last campaign" value={fmtDate(lastCampaign?.sent_at)} />
                <Cell label="Last open rate" value={fmtPct(lastCampaign?.open_rate)} />
              </div>

              {wix.err ? (
                <p className="mt-3 rounded border border-tomato/40 bg-tomato/10 px-2 py-1 font-mono text-[10px] text-tomato">
                  ⚠ {wix.err}
                </p>
              ) : null}

              <div className="mt-5 border-t border-line pt-4">
                <div className="flex items-baseline justify-between">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-clay">recent campaigns</p>
                  <span className="rounded-full border border-line bg-paper-deep px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-clay">
                    new campaign →
                  </Link>
                </div>
                {wix.campaigns.length === 0 ? (
                  <p className="mt-3 font-sans text-[13px] italic text-ink-soft">No campaigns yet.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-line">
                    {wix.campaigns.slice(0, 8).map((c) => (
                      <li key={c.external_id || c.title} className="flex items-baseline justify-between gap-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-serif text-[14px] text-ink">{c.title}</p>
                          <p className="font-mono text-[10px] uppercase tracking-wide text-muted">
                            {fmtDate(c.sent_at)} · {c.status.toLowerCase()}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-mono text-[11px] text-ink">{fmtInt(c.sent_count)} sent</p>
                          <p className="font-mono text-[10px] text-ink-soft">open {fmtPct(c.open_rate)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </section>

        {/* -------- RIGHT: Meta Ads (read-only) -------- */}
        <section className="rounded-2xl border border-line bg-paper p-5">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">paid social · read-only</p>
              <h2 className="mt-1 font-serif text-xl text-ink">Meta Ads</h2>
            </div>
            <MetaStatusPill state={metaAds.state} connected={metaConn} entity={entity} />
          </div>

          {!metaConn ? (
            <>
              <div className="mt-4 rounded border border-line bg-paper-deep/40 p-3">
                <p className="font-sans text-[13px] leading-relaxed text-ink">
                  {entity === "BM" ? (
                    <>Ad account <span className="font-mono text-[12px]">act_605781129956113</span> exists but has been <span className="text-tomato">disabled since 2026-04-04</span> — payment method failed (Mastercard 2134). We can still surface metadata once Marie provides a Marketing API access token.</>
                  ) : (
                    <>No Meta ad account wired for {meta.brand}. IFL runs organic-only today; connect a token if that changes.</>
                  )}
                </p>
              </div>
              <div className="mt-4">
                <ConnectIntegration
                  entity={entity}
                  vendor="meta-ads"
                  kind="marketing"
                  label="Meta Ads"
                  howto="Business Manager → Business Settings → System Users → generate a token with ads_read on the ad account. Paste the token alone (account id is fixed per entity)."
                />
              </div>
            </>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Cell label="Account state" value={metaAds.state?.status_label || "Unknown"} />
                <Cell label="Active campaigns" value={fmtInt(metaAds.state?.active_campaign_count)} />
                <Cell label="Spend · last 30d" value={fmtEUR(metaAds.state?.spend_last_30d, currency)} big />
                <Cell label="Reach · last 30d" value={fmtInt(metaAds.state?.reach_last_30d)} />
              </div>

              {metaAds.state?.status_code === 2 ? (
                <p className="mt-3 rounded border border-tomato/40 bg-tomato/10 px-2 py-1 font-mono text-[10px] leading-relaxed text-tomato">
                  ⚠ Disabled since 2026-04-04 · payment method failed. Historic spend/reach still visible.
                </p>
              ) : null}
              {metaAds.state?.error ? (
                <p className="mt-3 rounded border border-tomato/40 bg-tomato/10 px-2 py-1 font-mono text-[10px] text-tomato">
                  ⚠ {metaAds.state.error}
                </p>
              ) : null}

              <div className="mt-5 border-t border-line pt-4">
                <p className="font-mono text-[10px] uppercase tracking-wide text-clay">campaigns · last 30d</p>
                {metaAds.campaigns.length === 0 ? (
                  <p className="mt-3 font-sans text-[13px] italic text-ink-soft">No campaigns returned.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-line">
                    {metaAds.campaigns.slice(0, 8).map((c) => (
                      <li key={c.external_id} className="flex items-baseline justify-between gap-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-serif text-[14px] text-ink">{c.name}</p>
                          <p className="font-mono text-[10px] uppercase tracking-wide text-muted">
                            {(c.effective_status || c.status).toLowerCase()}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-mono text-[11px] text-ink">{fmtEUR(c.spend, currency)}</p>
                          <p className="font-mono text-[10px] text-ink-soft">reach {fmtInt(c.reach)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <p className="mt-8 font-mono text-[10px] uppercase tracking-wide text-clay">
        Sprint 3 — <span className="text-ink-soft">Wix wired · Meta read-only tile. Composer + audience push arrive next sprint.</span>
      </p>
    </main>
  );
}

function Cell({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div className="rounded border border-line bg-paper-deep/30 px-3 py-2">
      <p className="font-mono text-[9px] uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 ${big ? "font-serif text-2xl text-ink" : "font-serif text-[15px] text-ink"}`}>{value}</p>
    </div>
  );
}

function MetaStatusPill({ state, connected, entity }: { state: MetaAccountState | null; connected: boolean; entity: EntityOpt }) {
  if (!connected) {
    // Show a "disabled" pill for BM because we know the state without a token
    if (entity === "BM") {
      return (
        <span className="inline-block rounded-full border border-tomato/40 bg-tomato/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-tomato">
          disabled
        </span>
      );
    }
    return (
      <span className="inline-block rounded-full border border-line bg-paper-deep px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted">
        not connected
      </span>
    );
  }
  const code = state?.status_code;
  const cls =
    code === 1 ? "border-basil/40 bg-basil/10 text-basil"
    : code === 2 ? "border-tomato/40 bg-tomato/10 text-tomato"
    : "border-clay/40 bg-clay/10 text-clay";
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${cls}`}>
      {state?.status_label?.toLowerCase() || "unknown"}
    </span>
  );
}
