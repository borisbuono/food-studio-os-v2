import type { SocialAdapter, SocialPost, EntityCode } from "@/lib/integrations/types";
import { getEntityCredential } from "@/lib/integrations/credentials";

// Buffer Publish API — https://buffer.com/developers/api
// Base: https://api.bufferapp.com/1/
//
// Auth: `?access_token=<token>` or Authorization header. Legacy v1 endpoints are
// still live for scheduling Instagram / Facebook / TikTok / X posts, which is
// what the Grow · Reach composer needs today.
//
// Boris pastes a personal access token via /administrate/finance/setup/[entity]
// → ConnectIntegration (vendor: "buffer"). See app/api/integrations/connect/route.ts.
// Env fallback: BUFFER_ACCESS_TOKEN.

const BASE = "https://api.bufferapp.com/1";

async function bufferFetch(entity: EntityCode, path: string, init: RequestInit = {}, opts: { form?: URLSearchParams } = {}) {
  const token = (await getEntityCredential(entity, "buffer")) || process.env.BUFFER_ACCESS_TOKEN || "";
  if (!token) throw new Error(`No Buffer credential configured for ${entity}`);
  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE}${path}${sep}access_token=${encodeURIComponent(token)}`;
  const headers: Record<string, string> = {
    "Content-Type": opts.form ? "application/x-www-form-urlencoded" : "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  const body = opts.form ? opts.form.toString() : init.body;
  return fetch(url, { ...init, headers, body });
}

// ---------- Public read shapes ----------
export interface BufferProfile {
  id: string;
  service: string;               // "instagram" | "facebook" | "twitter" | "tiktok" | ...
  service_username: string | null;
  formatted_username: string | null;
  timezone: string | null;
}
export interface BufferSentPost {
  external_id: string;
  service: string;
  text: string;
  sent_at: string | null;         // ISO
  status: string;                  // "sent" | "buffer" | ...
  service_link: string | null;
}

export async function listChannels(entity: EntityCode): Promise<BufferProfile[]> {
  const r = await bufferFetch(entity, "/profiles.json");
  if (!r.ok) throw new Error(`Buffer profiles ${r.status}: ${(await r.text().catch(() => "")).slice(0, 240)}`);
  const rows = (await r.json().catch(() => [])) as any[];
  return (rows || []).map((p) => ({
    id: String(p.id),
    service: String(p.service || ""),
    service_username: p.service_username ?? null,
    formatted_username: p.formatted_username ?? null,
    timezone: p.timezone ?? null,
  }));
}

// Sends across up to 3 profile pages of history for a single profile — enough
// for the Reach dashboard's "recent posts" strip. Aggregation across profiles
// happens at the caller.
export async function listRecentPosts(entity: EntityCode, profileId: string): Promise<BufferSentPost[]> {
  const r = await bufferFetch(entity, `/profiles/${encodeURIComponent(profileId)}/updates/sent.json?count=30`);
  if (!r.ok) throw new Error(`Buffer sent ${r.status}: ${(await r.text().catch(() => "")).slice(0, 240)}`);
  const j = await r.json().catch(() => ({ updates: [] } as any));
  const rows = Array.isArray(j?.updates) ? j.updates : [];
  return rows.map((u: any) => ({
    external_id: String(u.id),
    service: String(u.profile_service || ""),
    text: String(u.text || ""),
    sent_at: u.sent_at ? new Date(Number(u.sent_at) * 1000).toISOString() : null,
    status: String(u.status || ""),
    service_link: u.service_link ?? null,
  }));
}

async function schedulePost(input: SocialPost & { entity?: EntityCode; profile_ids?: string[]; dryRun?: boolean }) {
  const entity: EntityCode = input.entity || "BM";
  if (input.dryRun) {
    return { external_id: `dry-buffer-${Date.now()}`, dryRun: true };
  }

  // Resolve profile ids per channel if the caller didn't supply them.
  let profileIds = input.profile_ids || [];
  if (!profileIds.length) {
    const channels = await listChannels(entity);
    const wanted = new Set(input.channels.map((c) => c.toLowerCase()));
    profileIds = channels
      .filter((p) => wanted.has(p.service.toLowerCase()) || (p.service === "twitter" && wanted.has("x")))
      .map((p) => p.id);
    if (!profileIds.length) throw new Error("No matching Buffer profile for requested channels");
  }

  const form = new URLSearchParams();
  form.set("text", input.caption);
  profileIds.forEach((id) => form.append("profile_ids[]", id));
  if (input.media_urls?.length) form.set("media[picture]", input.media_urls[0]);
  if (input.scheduled_at) {
    // Buffer wants Unix seconds for scheduled_at.
    const unix = Math.floor(new Date(input.scheduled_at).getTime() / 1000);
    if (!Number.isFinite(unix) || unix <= 0) throw new Error("scheduled_at must be a valid ISO datetime");
    form.set("scheduled_at", String(unix));
  } else {
    form.set("now", "true");
  }

  const r = await bufferFetch(entity, "/updates/create.json", { method: "POST" }, { form });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Buffer create ${r.status}: ${t.slice(0, 300)}`);
  }
  const j = await r.json().catch(() => ({} as any));
  // Buffer returns an array of created update ids under `updates` or `buffer_ids`.
  const external_id = String(
    (Array.isArray(j.updates) && j.updates[0]?.id) ||
    (Array.isArray(j.buffer_ids) && j.buffer_ids[0]) ||
    j.id ||
    ""
  );
  return { external_id, dryRun: false };
}

export const bufferAdapter: SocialAdapter = {
  name: "Buffer",
  vendor: "buffer",
  schedulePost,
};
