// calendarGoogle.ts — read-only Google Calendar overlay (server only).
//
// Tokens live in google_calendar_tokens; the refresh token is readable only
// through definer RPCs scoped to the caller (gcal_my_tokens) or service_role.
// A pull replaces the person's `external` rows in the window via
// gcal_replace_external — they render dimmed and count as busy time for
// /book/<slug>. Nothing is ever written to Google in v1.
import type { SupabaseClient } from "@supabase/supabase-js";

export const GCAL_SCOPES = [
  "openid", "email",
  "https://www.googleapis.com/auth/calendar.readonly",
];
export const GCAL_PAST_DAYS = 7;
export const GCAL_FUTURE_DAYS = 30;
export const GCAL_STALE_MS = 15 * 60_000;

export type GcalTokens = {
  person_id: string; refresh_token: string; access_token: string | null;
  access_expires_at: string | null; last_synced_at: string | null;
};

export function gcalRedirectUri(origin: string) {
  return `${origin}/api/calendar/google/callback`;
}

export async function refreshAccess(refresh_token: string): Promise<{ access_token: string; expires_at: string }> {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
      refresh_token, grant_type: "refresh_token",
    }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`google refresh ${r.status}: ${j.error || "no token"}`);
  return { access_token: j.access_token, expires_at: new Date(Date.now() + (Number(j.expires_in) || 3000) * 1000).toISOString() };
}

type Pulled = { id: string; title: string; start: string; end: string | null; all_day: boolean; location: string | null };

function dayToIso(d: string, tz: string | undefined): string {
  // all-day events carry a bare date; anchor at local midnight of the calendar's zone (approx: UTC offset via Intl)
  const zone = tz || "Europe/Madrid";
  const probe = new Date(`${d}T12:00:00Z`);
  const f = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(probe);
  const off = (f.find((x) => x.type === "timeZoneName")?.value || "GMT").replace("GMT", "") || "+0";
  const m = off.match(/([+-])(\d+)(?::(\d+))?/);
  const sign = m ? (m[1] === "-" ? -1 : 1) : 1;
  const mins = m ? sign * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
  return new Date(Date.parse(`${d}T00:00:00Z`) - mins * 60_000).toISOString();
}

export async function pullPrimary(access_token: string, from: Date, to: Date): Promise<Pulled[]> {
  const out: Pulled[] = [];
  let pageToken = "";
  let calTz: string | undefined;
  for (let i = 0; i < 5; i++) {
    const qs = new URLSearchParams({
      timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: "true",
      orderBy: "startTime", maxResults: "250",
    });
    if (pageToken) qs.set("pageToken", pageToken);
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${qs}`, {
      headers: { authorization: `Bearer ${access_token}` }, cache: "no-store",
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`google events ${r.status}: ${j?.error?.message || "error"}`);
    calTz = calTz || j.timeZone;
    for (const e of j.items || []) {
      if (e.status === "cancelled" || e.transparency === "transparent") continue;
      const me = (e.attendees || []).find((a: any) => a.self);
      if (me && me.responseStatus === "declined") continue;
      const allDay = !!e.start?.date;
      out.push({
        id: String(e.id),
        title: String(e.summary || "Busy"),
        start: allDay ? dayToIso(e.start.date, calTz) : e.start?.dateTime,
        end: allDay ? dayToIso(e.end?.date || e.start.date, calTz) : e.end?.dateTime || null,
        all_day: allDay,
        location: e.location || null,
      });
    }
    pageToken = j.nextPageToken || "";
    if (!pageToken) break;
  }
  return out.filter((x) => x.start);
}

// Pull + replace for one person. `sb` is either the user's own client
// (RPC checks the person is theirs) or the service-role job client.
export async function syncPerson(sb: SupabaseClient, t: GcalTokens): Promise<{ ok: boolean; count: number; error?: string }> {
  const from = new Date(Date.now() - GCAL_PAST_DAYS * 86400_000);
  const to = new Date(Date.now() + GCAL_FUTURE_DAYS * 86400_000);
  let access = t.access_token;
  let expires = t.access_expires_at;
  try {
    if (!access || !expires || Date.parse(expires) < Date.now() + 60_000) {
      const r = await refreshAccess(t.refresh_token);
      access = r.access_token; expires = r.expires_at;
    }
    const items = await pullPrimary(access!, from, to);
    const { data, error } = await sb.rpc("gcal_replace_external", {
      p_person: t.person_id, p_from: from.toISOString(), p_to: to.toISOString(),
      p_events: items, p_access: access, p_expires: expires,
    });
    if (error) throw new Error(error.message);
    return { ok: true, count: Number(data) || 0 };
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 300);
    await sb.rpc("gcal_replace_external", {
      p_person: t.person_id, p_from: from.toISOString(), p_to: to.toISOString(),
      p_events: null, p_error: msg,
    });
    return { ok: false, count: 0, error: msg };
  }
}

// Every connected person, in one pass. Used by the nightly pull (which rides
// on pos-nightly — Hobby plans allow only two cron entries) and by the
// standalone /api/cron/calendar-google route.
export async function syncAllConnected(sb: SupabaseClient) {
  const { data, error } = await sb
    .from("google_calendar_tokens")
    .select("person_id, refresh_token, access_token, access_expires_at, last_synced_at");
  if (error) return { ok: false, error: error.message, people: 0, results: [] as any[] };
  const results: any[] = [];
  for (const t of (data || []) as GcalTokens[]) {
    results.push({ person: t.person_id, ...(await syncPerson(sb, t)) });
  }
  return { ok: results.every((r) => r.ok), people: results.length, results };
}
