// labor.ts — small helpers shared across the clock-in module.
//
// The API endpoints and the two UI surfaces (/h/[house]/clock kiosk +
// /h/[house]/office/labor admin) all need the same tiny primitives:
//
//   * derive the "current business day" for an entity, in the entity's
//     own timezone (Amsterdam / Madrid);
//   * resolve the current hourly rate for a user@entity as of a given
//     date so the rate can be snapshotted at clock-in time;
//   * format an elapsed span from clock-in → now.
//
// Kept intentionally small so the API/UI files don't drift on formatting
// or timezone rules.

import { supabaseServer } from "@/lib/supabaseServer";
import { E_HOLDINGS, E_BM, E_TALLER } from "@/lib/entities";

// Fallback timezones for the three pinned entities. The `entities.timezone`
// column is the source of truth; these only apply when the DB lookup
// hasn't happened yet.
const TZ_FALLBACK: Record<string, string> = {
  [E_HOLDINGS]: "Europe/Madrid",
  [E_BM]:       "Europe/Madrid",
  [E_TALLER]:   "Europe/Madrid",
};

export async function entityTimezone(entity_id: string): Promise<string> {
  if (!entity_id) return "Europe/Madrid";
  const sb = supabaseServer();
  const { data } = await sb
    .from("entities")
    .select("timezone")
    .eq("id", entity_id)
    .maybeSingle();
  return (data?.timezone as string | undefined) || TZ_FALLBACK[entity_id] || "Europe/Madrid";
}

// Today's date (YYYY-MM-DD) in the entity's timezone. All labor bucketing
// keys off this so a shift that spans midnight still counts to the day the
// operator opened the pass.
export function todayInTz(tz: string, d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

// Given entity_id + user_id + as-of ISO date, return the active hourly rate.
// Returns null if no rate has been set (clock-in still works; the shift row
// just carries hourly_rate_eur = null and the labor dashboard flags it).
export async function currentRateFor(entity_id: string, user_id: string, asOf: string): Promise<number | null> {
  if (!entity_id || !user_id) return null;
  const sb = supabaseServer();
  const { data } = await sb
    .from("labor_hourly_rates")
    .select("hourly_rate_eur, effective_from, effective_to")
    .eq("entity_id", entity_id)
    .eq("user_id", user_id)
    .lte("effective_from", asOf)
    .order("effective_from", { ascending: false })
    .limit(5);
  if (!data || !data.length) return null;
  for (const row of data as Array<{ hourly_rate_eur: number; effective_from: string; effective_to: string | null }>) {
    if (!row.effective_to || row.effective_to >= asOf) {
      return Number(row.hourly_rate_eur);
    }
  }
  return null;
}

// Elapsed span formatter — "2h 14m" or "43m". Used by the kiosk to render
// how long each currently-on card has been clocked in.
export function elapsedLabel(ms: number): string {
  if (ms < 0) ms = 0;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin - h * 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Compute paid duration in minutes, subtracting breaks. Nulls collapse to 0.
export function paidMinutes(clock_in: string | null, clock_out: string | null, break_minutes: number | null): number {
  if (!clock_in || !clock_out) return 0;
  const gross = Math.max(0, (new Date(clock_out).getTime() - new Date(clock_in).getTime()) / 60000);
  return Math.max(0, Math.round(gross - Math.max(0, Number(break_minutes || 0))));
}

export function nextDay(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Convert a wall-clock local time (YYYY-MM-DDTHH:mm:ss) in tz into a UTC
// Date. Iterative because Intl only formats one direction — two passes
// converge for every standard tz offset.
export function zonedWallClockToUtc(wall: string, tz: string): Date {
  const initial = new Date(wall + "Z");
  const asString = (d: Date) => new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(d).replace(",", "").replace(" ", "T");
  let candidate = initial;
  for (let i = 0; i < 2; i++) {
    const shownWall = asString(candidate);
    const delta = Date.parse(wall + "Z") - Date.parse(shownWall + "Z");
    candidate = new Date(candidate.getTime() + delta);
  }
  return candidate;
}
