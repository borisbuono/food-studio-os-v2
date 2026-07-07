import type { MarketingAdapter, CampaignDraft, GuestSegment, EntityCode } from "@/lib/integrations/types";
import { getEntityCredential } from "@/lib/integrations/credentials";

// Wix Email Marketing REST API.
// Base: https://www.wixapis.com
// Docs: https://dev.wix.com/api/rest/email-marketing
//
// Auth pattern for Site API Keys:
//   Authorization: <api_key>
//   wix-account-id: <account_id>       (paired with the key when Boris created it)
//   wix-site-id: <site_id>             (optional; account-scoped keys don't need it)
//
// Boris pastes a single string in the ConnectIntegration form. The convention we
// adopt here: paste `<account_id>:<api_key>` — the adapter splits on the first colon.
// If no colon is present we fall through to `WIX_API_TOKEN` for the key and
// `WIX_ACCOUNT_ID` for the account id (env fallback).
//
// Only READ operations are wired live for now. sendCampaign() intentionally
// throws — the composer at /grow/reach/campaigns/new is next sprint's work.

const BASE = "https://www.wixapis.com";

function splitCred(raw: string): { accountId: string | null; apiKey: string } {
  const i = raw.indexOf(":");
  if (i < 0) return { accountId: null, apiKey: raw };
  return { accountId: raw.slice(0, i), apiKey: raw.slice(i + 1) };
}

async function wixFetch(entity: EntityCode, path: string, init: RequestInit = {}) {
  const raw = await getEntityCredential(entity, "wix-newsletter");
  if (!raw) throw new Error(`No Wix Newsletter credential configured for ${entity}`);
  const { accountId, apiKey } = splitCred(raw);
  const account = accountId || process.env.WIX_ACCOUNT_ID;
  if (!account) throw new Error(`Wix account id missing — paste as "<account_id>:<api_key>" or set WIX_ACCOUNT_ID`);
  const headers: Record<string, string> = {
    "Authorization": apiKey,
    "wix-account-id": account,
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  return fetch(`${BASE}${path}`, { ...init, headers });
}

// ---------- Public campaign summaries (used by /grow/reach) ----------
export interface WixCampaignSummary {
  external_id: string;
  title: string;
  subject: string | null;
  sent_at: string | null;               // ISO
  status: string;                        // DRAFT / ACTIVE / DISTRIBUTED / TERMINATED / ...
  sent_count: number;
  open_rate: number | null;              // 0..1
  click_rate: number | null;
}
export interface WixAudienceSummary {
  contact_count: number;
  labels: Array<{ id: string; name: string; count: number | null }>;
}

// Types kept intentionally loose — Wix's schema evolves.
type WixCampaignRaw = {
  campaignId?: string;
  id?: string;
  title?: string;
  name?: string;
  subject?: string;
  status?: string;
  publishingData?: { firstPublishDate?: string; publishStatus?: string; distributionType?: string };
  statistics?: {
    delivered?: number;
    opened?: number;
    clicked?: number;
    notSent?: number;
    bounced?: number;
    totalRecipients?: number;
    total?: number;
    openRate?: number;
    clickRate?: number;
  };
};

function normalizeCampaign(raw: WixCampaignRaw): WixCampaignSummary {
  const stats = raw.statistics || {};
  const sent = stats.delivered ?? stats.total ?? stats.totalRecipients ?? 0;
  const opened = stats.opened ?? 0;
  const clicked = stats.clicked ?? 0;
  const openRate = stats.openRate ?? (sent > 0 ? opened / sent : null);
  const clickRate = stats.clickRate ?? (sent > 0 ? clicked / sent : null);
  return {
    external_id: raw.campaignId || raw.id || "",
    title: raw.title || raw.name || "(untitled)",
    subject: raw.subject || null,
    sent_at: raw.publishingData?.firstPublishDate || null,
    status: raw.publishingData?.publishStatus || raw.status || "UNKNOWN",
    sent_count: sent,
    open_rate: openRate ?? null,
    click_rate: clickRate ?? null,
  };
}

export async function listCampaigns(entity: EntityCode, limit = 20): Promise<WixCampaignSummary[]> {
  const r = await wixFetch(entity, `/email-marketing/v1/campaigns?paging.limit=${limit}`, { method: "GET" });
  if (!r.ok) throw new Error(`Wix campaigns ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const j = await r.json().catch(() => ({} as any));
  const raws: WixCampaignRaw[] = j.campaigns || j.items || [];
  return raws.map(normalizeCampaign);
}

export async function listAudiences(entity: EntityCode): Promise<WixAudienceSummary> {
  // Contacts v4 — the count field varies by response shape; we ask for a small
  // page and read the totals off the pagingMetadata block.
  const r = await wixFetch(entity, `/contacts/v4/contacts?paging.limit=1`, { method: "GET" });
  if (!r.ok) throw new Error(`Wix contacts ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  const j = await r.json().catch(() => ({} as any));
  const contactCount = j.pagingMetadata?.total ?? j.total ?? (Array.isArray(j.contacts) ? j.contacts.length : 0);

  // Labels — v4 supports GET /contacts/v4/labels
  let labels: WixAudienceSummary["labels"] = [];
  try {
    const lr = await wixFetch(entity, `/contacts/v4/labels`, { method: "GET" });
    if (lr.ok) {
      const lj = await lr.json().catch(() => ({} as any));
      const rows: any[] = lj.labels || lj.items || [];
      labels = rows.map((l) => ({
        id: l.key || l.id || "",
        name: l.displayName || l.name || l.key || "",
        count: l.contactsCount ?? null,
      }));
    }
  } catch {}
  return { contact_count: contactCount, labels };
}

export const wixNewsletterAdapter: MarketingAdapter = {
  name: "Wix Newsletter",
  vendor: "wix-newsletter",
  async pushAudience(_segment: GuestSegment) {
    // Wix doesn't have a first-class "segment" object — contacts + labels do that
    // job. We tag each contact in the segment with a label matching the segment id.
    // Not wired yet — Boris confirmed we'll pipe this through the /grow/relationships
    // sync in a later sprint.
    return { external_id: "stub-wix-audience", dryRun: true };
  },
  async pushCampaign(_campaign: CampaignDraft) {
    // Composer at /grow/reach/campaigns/new is a placeholder for now.
    // POST /email-marketing/v1/campaigns lands here once the composer ships.
    return { external_id: "stub-wix-campaign", dryRun: true };
  },
};
