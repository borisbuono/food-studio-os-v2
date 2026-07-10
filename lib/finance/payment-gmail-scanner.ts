// Finance intelligence #3 — Gmail-based payment failure scanner.
//
// The idea: instead of Boris finding out weeks late that Meta shut the ad
// account, or that Wix has been retrying the same €35.09 charge for a
// month, the assistant reads billing-failure emails as they land and
// updates platform_billing_status directly.
//
// Read-only against Gmail — never labels, never archives, never modifies
// the mailbox. Every state change writes to assistant_actions
// (action_kind='payment_scan_gmail') so nightly + on-demand runs are
// auditable.
//
// Detection uses a two-pass approach:
//   1. Regex prefilter — cheap keyword patterns catch the obvious cases
//      (payment_method_rotation memory lists the language: "we couldn't
//      charge", "payment declined", "billing failed", "your card was
//      rejected", "account has been suspended").
//   2. LLM extract — the orchestrator (mode:'draft', system-hinted for
//      extraction) reads the prefiltered thread and returns a compact JSON
//      with platform, failure_date, and failure_reason. We only pay tokens
//      on threads that already look like billing failures.

import { supabaseServer } from "@/lib/supabaseServer";
import { orchestrator } from "@/lib/assistant/orchestrator";
import { listRecentThreads, getThread } from "@/lib/assistant/channels/gmail";
import type { AssistantChannelRow } from "@/types/db";

export type EntityCode = "IFL" | "BM" | "BBH";

// Regex patterns — case-insensitive keyword prefilter. Broad on purpose —
// we let the LLM narrow. Adding a term is a one-line change.
const FAILURE_PATTERNS: RegExp[] = [
  /we\s+couldn'?t\s+charge/i,
  /we\s+were\s+unable\s+to\s+charge/i,
  /payment\s+declined/i,
  /payment\s+failed/i,
  /billing\s+failed/i,
  /billing\s+issue/i,
  /your\s+card\s+was\s+(rejected|declined)/i,
  /card\s+has\s+been\s+declined/i,
  /account\s+has\s+been\s+suspended/i,
  /subscription\s+(has\s+been\s+)?suspended/i,
  /unable\s+to\s+process\s+your\s+payment/i,
  /pay(ment)?\s+method\s+(needs|requires)\s+update/i,
  /action\s+required.*payment/i,
];

// Platform slug — matches platform_billing_status.platform column. When the
// LLM returns a display name, we map it to a slug. Unknown platforms are
// left as the raw slug so a new SaaS surfaces without a code change.
const PLATFORM_ALIASES: Record<string, string> = {
  "google workspace": "google-workspace",
  "google admin":     "google-workspace",
  "workspace":        "google-workspace",
  "meta ads":         "meta-ads",
  "meta business":    "meta-ads",
  "facebook business":"meta-ads",
  "facebook ads":     "meta-ads",
  "wix":              "wix-newsletter",
  "wix.com":          "wix-newsletter",
  "wix core":         "wix-newsletter",
  "holded":           "holded",
  "apideck":          "apideck",
  "stripe":           "stripe",
};

function normalisePlatform(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (PLATFORM_ALIASES[key]) return PLATFORM_ALIASES[key];
  for (const [alias, slug] of Object.entries(PLATFORM_ALIASES)) {
    if (key.includes(alias)) return slug;
  }
  // Slugify — lowercase, spaces → hyphens, non-word stripped.
  return key.replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").replace(/-+/g, "-");
}

// State transition — mirrors the payment_state enum. A new failure bumps
// the row from healthy → at_risk on the first hit, at_risk → failing after
// 3, and failing → disabled if the email talks about suspension.
function nextState(current: string, failures30d: number, suspended: boolean): string {
  if (suspended) return "disabled";
  if (failures30d >= 5) return "failing";
  if (failures30d >= 1) return "at_risk";
  return current || "healthy";
}

type Extracted = {
  is_failure: boolean;
  platform: string | null;      // display name — normalised locally
  failure_date: string | null;  // ISO date (YYYY-MM-DD)
  reason: string | null;        // one short line
  suspended: boolean;           // account fully shut down?
};

// Ask the orchestrator to extract structured billing-failure data from a
// prefiltered thread. Uses mode:'draft' + a system-extra hint so it returns
// STRICT JSON (matches the triage pattern).
async function extractFromThread(entity: EntityCode, subject: string, from: string, body: string): Promise<Extracted | null> {
  const prompt =
`Email subject: ${subject}
Email from: ${from}
Email body (truncated):
${body.slice(0, 3500)}

Question: is this a billing / payment failure notice from a SaaS platform we pay for? If yes, extract:
- platform: the SaaS name (e.g. "Wix", "Meta Ads", "Google Workspace", "Holded")
- failure_date: the date the charge failed / the notice was sent (YYYY-MM-DD)
- reason: one short line explaining what failed (e.g. "card declined by issuer")
- suspended: true if the email says the account or subscription is suspended / disabled

Return STRICT JSON matching:
{ "is_failure": true|false, "platform": string|null, "failure_date": "YYYY-MM-DD"|null, "reason": string|null, "suspended": true|false }
No prose, no code fences.`;

  const result = await orchestrator.generate({
    prompt, mode: "extract",
    system_extra: "You are extracting billing-failure fields for entity " + entity + ". Return only the JSON described in the prompt.",
  });
  if (!result.ok) return null;
  const m = result.text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]);
    if (typeof parsed !== "object" || parsed === null) return null;
    return {
      is_failure:  !!parsed.is_failure,
      platform:    parsed.platform || null,
      failure_date: typeof parsed.failure_date === "string" ? parsed.failure_date.slice(0, 10) : null,
      reason:      typeof parsed.reason === "string" ? parsed.reason.slice(0, 400) : null,
      suspended:   !!parsed.suspended,
    } as Extracted;
  } catch { return null; }
}

export type ScanChannelSummary = {
  channel_id: string;
  entity_code: EntityCode;
  account: string;
  threads_seen: number;
  hits: number;
  updated: Array<{ platform: string; new_state: string; failure_date: string | null }>;
  error?: string;
};

export type ScanRunSummary = {
  channels_seen: number;
  hits_total: number;
  updated_total: number;
  channels: ScanChannelSummary[];
};

// Scan a single Gmail channel. Reads-only.
export async function scanChannel(channel: AssistantChannelRow, opts?: { since?: Date }): Promise<ScanChannelSummary> {
  const entity: EntityCode = (channel.settings?.entity_code || "IFL") as EntityCode;
  const summary: ScanChannelSummary = {
    channel_id: channel.id,
    entity_code: entity,
    account: channel.account_ref,
    threads_seen: 0,
    hits: 0,
    updated: [],
  };

  const since = opts?.since || new Date(Date.now() - 3 * 86_400_000); // 3-day window on nightly
  let threads;
  try {
    threads = await listRecentThreads(channel, since);
  } catch (e: any) {
    summary.error = e?.message || String(e);
    return summary;
  }
  summary.threads_seen = threads.length;

  const sb = supabaseServer();

  for (const t of threads) {
    // Prefilter — cheap. Skip anything that doesn't smell like a billing failure.
    const surface = (t.subject + " · " + t.snippet).toLowerCase();
    if (!FAILURE_PATTERNS.some((rx) => rx.test(surface))) continue;

    let body = "";
    try {
      const full = await getThread(channel, t.thread_id);
      body = (full.messages[full.messages.length - 1]?.body_text || "").slice(0, 6000);
    } catch { continue; }

    const extracted = await extractFromThread(entity, t.subject, t.from, body);
    if (!extracted || !extracted.is_failure) continue;
    summary.hits += 1;

    const platformRaw = extracted.platform || t.from.replace(/.*@/, "").split(".")[0];
    const platform = normalisePlatform(platformRaw);
    if (!platform) continue;

    // Upsert onto platform_billing_status. We use the (entity_code, platform)
    // unique constraint. New failures bump the failure count, update
    // last_failure_at + notes, and transition state.
    const { data: existing } = await sb.from("platform_billing_status")
      .select("id,state,failure_count_30d,last_failure_at,notes")
      .eq("entity_code", entity)
      .eq("platform", platform)
      .maybeSingle();

    const failure_iso = extracted.failure_date ? extracted.failure_date + "T00:00:00Z" : new Date().toISOString();
    const next_failures = Math.min(999, (existing?.failure_count_30d ?? 0) + 1);
    const new_state = nextState(existing?.state || "healthy", next_failures, extracted.suspended);
    const noteLine = "Gmail: " + (extracted.reason || t.subject).slice(0, 200);

    if (existing?.id) {
      await sb.from("platform_billing_status").update({
        state: new_state,
        failure_count_30d: next_failures,
        last_failure_at: failure_iso,
        notes: existing.notes ? existing.notes + " · " + noteLine : noteLine,
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id);
    } else {
      await sb.from("platform_billing_status").insert({
        entity_code: entity,
        platform,
        state: new_state,
        failure_count_30d: next_failures,
        last_failure_at: failure_iso,
        notes: noteLine,
      });
    }

    summary.updated.push({ platform, new_state, failure_date: extracted.failure_date });

    // Audit — one row per state change so the timeline is queryable.
    await sb.from("assistant_actions").insert({
      user_id: channel.user_id,
      action_kind: "payment_scan_gmail",
      action_type: "finance.payment.gmail_detected",
      entity_code: entity,
      target_table: "platform_billing_status",
      target_id: existing?.id || null,
      payload: {
        platform,
        new_state,
        prev_state: existing?.state || null,
        failure_date: extracted.failure_date,
        reason: extracted.reason,
        suspended: extracted.suspended,
        thread_id: t.thread_id,
        subject: t.subject.slice(0, 200),
      },
      reversible: false,
    });
  }

  return summary;
}

// Run across every connected Gmail channel with triage enabled. Nightly
// entry point.
export async function scanAll(opts?: { since?: Date }): Promise<ScanRunSummary> {
  const sb = supabaseServer();
  const { data } = await sb.from("assistant_channels")
    .select("id,user_id,channel_type,account_ref,auth_ref,settings,created_at,revoked_at")
    .eq("channel_type", "gmail")
    .is("revoked_at", null);
  const channels = (data || []) as AssistantChannelRow[];

  const results: ScanChannelSummary[] = [];
  for (const c of channels) {
    results.push(await scanChannel(c, opts));
  }
  const hits_total    = results.reduce((a, r) => a + r.hits, 0);
  const updated_total = results.reduce((a, r) => a + r.updated.length, 0);

  await sb.from("assistant_actions").insert({
    user_id: null,
    action_kind: "payment_scan_gmail",
    action_type: "finance.payment.gmail_scan",
    entity_code: null,
    payload: {
      channels_seen: channels.length,
      hits_total,
      updated_total,
      per_channel: results.map((r) => ({ channel_id: r.channel_id, entity: r.entity_code, hits: r.hits, updated: r.updated.length, error: r.error || null })),
    },
    reversible: false,
  });

  return { channels_seen: channels.length, hits_total, updated_total, channels: results };
}

export const _internals = { FAILURE_PATTERNS, normalisePlatform, nextState };
