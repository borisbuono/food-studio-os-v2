import type { MarketingAdapter, CampaignDraft, GuestSegment, EntityCode } from "@/lib/integrations/types";
import { getEntityCredential } from "@/lib/integrations/credentials";

// Meta Marketing API v20.0. Read-only for now.
// Base: https://graph.facebook.com/v20.0
// Docs: https://developers.facebook.com/docs/marketing-apis
//
// Auth: Marketing API access token (user access token with ads_read, or a
// system-user token with ads_read on the ad account). Boris pastes the token
// alone — the account id is fixed per entity below (BM = 605781129956113).
//
// The Reach tile stays read-only even after the token is live: we display
// account state, spend, reach and campaign list, but pushCampaign() throws.
// The account is currently DISABLED for payment failure (memo:
// payment_method_rotation_needed) — the /act_{id}?fields=account_status call
// returns 2 (DISABLED) rather than 1 (ACTIVE).

const BASE = "https://graph.facebook.com/v20.0";

// account_status enum (per Meta docs):
//  1 = ACTIVE  2 = DISABLED  3 = UNSETTLED  7 = PENDING_RISK_REVIEW
//  8 = PENDING_SETTLEMENT  9 = IN_GRACE_PERIOD  100 = PENDING_CLOSURE
//  101 = CLOSED  201 = ANY_ACTIVE  202 = ANY_CLOSED
const STATUS_LABEL: Record<number, string> = {
  1: "Active",
  2: "Disabled",
  3: "Unsettled",
  7: "Pending risk review",
  8: "Pending settlement",
  9: "In grace period",
  100: "Pending closure",
  101: "Closed",
};

const ENTITY_ACCOUNT: Record<EntityCode, string | undefined> = {
  IFL: process.env.META_AD_ACCOUNT_IFL,
  BM:  process.env.META_AD_ACCOUNT_BM || "605781129956113",
  BBH: process.env.META_AD_ACCOUNT_BBH,
};

async function metaFetch(entity: EntityCode, path: string, params: Record<string, string> = {}) {
  const token = await getEntityCredential(entity, "meta-ads");
  if (!token) throw new Error(`No Meta Ads access token configured for ${entity}`);
  const acct = ENTITY_ACCOUNT[entity];
  if (!acct) throw new Error(`No Meta ad account id configured for ${entity} — set META_AD_ACCOUNT_${entity}`);
  const qs = new URLSearchParams({ ...params, access_token: token });
  const url = `${BASE}${path.replace("{ACCT}", `act_${acct}`)}?${qs.toString()}`;
  return fetch(url);
}

export interface MetaAccountState {
  account_id: string;
  name: string | null;
  currency: string | null;
  status_code: number | null;
  status_label: string;
  disable_reason: string | null;
  spend_last_30d: number | null;         // EUR-ish (account currency)
  reach_last_30d: number | null;
  active_campaign_count: number | null;
  error?: string;                        // populated when the API rejects the call
}

export interface MetaCampaignRow {
  external_id: string;
  name: string;
  status: string;                        // ACTIVE / PAUSED / DELETED / ARCHIVED
  effective_status: string | null;
  spend: number | null;
  reach: number | null;
}

export async function getAccountState(entity: EntityCode): Promise<MetaAccountState> {
  const acct = ENTITY_ACCOUNT[entity] || "";
  const base: MetaAccountState = {
    account_id: acct,
    name: null, currency: null,
    status_code: null, status_label: "Unknown",
    disable_reason: null,
    spend_last_30d: null, reach_last_30d: null, active_campaign_count: null,
  };
  try {
    const r = await metaFetch(entity, `/{ACCT}`, {
      fields: "account_status,name,currency,disable_reason",
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return { ...base, error: `${r.status}: ${t.slice(0, 200)}` };
    }
    const j: any = await r.json().catch(() => ({}));
    const code: number | null = typeof j.account_status === "number" ? j.account_status : null;
    const state: MetaAccountState = {
      ...base,
      name: j.name ?? null,
      currency: j.currency ?? null,
      status_code: code,
      status_label: code != null ? (STATUS_LABEL[code] || `Status ${code}`) : "Unknown",
      disable_reason: j.disable_reason != null ? String(j.disable_reason) : null,
    };

    // Insights + active campaign count — best-effort, disabled accounts still return them
    try {
      const ir = await metaFetch(entity, `/{ACCT}/insights`, {
        fields: "spend,reach",
        date_preset: "last_30d",
      });
      if (ir.ok) {
        const ij: any = await ir.json().catch(() => ({}));
        const row = Array.isArray(ij.data) && ij.data[0] ? ij.data[0] : null;
        if (row) {
          state.spend_last_30d = row.spend != null ? Number(row.spend) : null;
          state.reach_last_30d = row.reach != null ? Number(row.reach) : null;
        }
      }
    } catch {}
    try {
      const cr = await metaFetch(entity, `/{ACCT}/campaigns`, {
        fields: "id",
        effective_status: '["ACTIVE"]',
        limit: "200",
      });
      if (cr.ok) {
        const cj: any = await cr.json().catch(() => ({}));
        state.active_campaign_count = Array.isArray(cj.data) ? cj.data.length : 0;
      }
    } catch {}
    return state;
  } catch (e: any) {
    return { ...base, error: e?.message || String(e) };
  }
}

export async function listCampaigns(entity: EntityCode, limit = 25): Promise<MetaCampaignRow[]> {
  const r = await metaFetch(entity, `/{ACCT}/campaigns`, {
    fields: "id,name,status,effective_status,insights.date_preset(last_30d){spend,reach}",
    limit: String(limit),
  });
  if (!r.ok) throw new Error(`Meta campaigns ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const j: any = await r.json().catch(() => ({}));
  const rows: any[] = Array.isArray(j.data) ? j.data : [];
  return rows.map((row) => {
    const ins = row.insights?.data?.[0] || null;
    return {
      external_id: row.id,
      name: row.name || "(untitled)",
      status: row.status || "UNKNOWN",
      effective_status: row.effective_status || null,
      spend: ins?.spend != null ? Number(ins.spend) : null,
      reach: ins?.reach != null ? Number(ins.reach) : null,
    };
  });
}

export const metaAdsAdapter: MarketingAdapter = {
  name: "Meta Ads",
  vendor: "meta-ads",
  async pushAudience(_segment: GuestSegment) {
    throw new Error("Meta Ads adapter is read-only for now — audience sync will land after the ad account is reactivated");
  },
  async pushCampaign(_campaign: CampaignDraft) {
    throw new Error("Meta Ads adapter is read-only for now — campaign push is out of scope for the current sprint");
  },
};
