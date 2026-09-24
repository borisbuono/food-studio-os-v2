// lib/chef/predict.ts — Chef v3 Phase 2 S4: predictive idle chips.
//
// Server only. Dumb rules, no ML: score a handful of candidates from the
// clock, today's bookings, today's prep, the social inbox, the delivery
// weekday pattern, the calendar and what this user did at this time
// yesterday (chef_turns). Return the top 3 by score, deduped by key.
//
// Each reader is wrapped so one slow / missing table never blanks the row —
// the chips are a hint, never a blocker (brief §1: the control ships first).

import type { SupabaseClient } from "@supabase/supabase-js";
import { ENTITY_TO_RESTAURANT } from "@/lib/entities";
import { codeForEntityId } from "@/lib/assistant/orchestrator";
import { loadEvents } from "@/lib/calendar.server";

export type ChefChip = { key: string; label: string; utterance: string };
export type ChipKey = "inbox" | "prep" | "bookings" | "bookings_tomorrow" | "capture" | "calendar" | "yesterday";

type Candidate = ChefChip & { key: ChipKey; score: number };

export type PredictInput = {
  entityId: string;
  tz: string;
  lang: "es" | "en";
  uid: string;
  route?: string | null;
};

const LABEL_MAX = 22;

function clip(s: string, n = LABEL_MAX) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

// Local clock pieces in the venue tz.
function localClock(tz: string, offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz || "Europe/Madrid", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short",
  }).formatToParts(d);
  const g = (k: string) => parts.find((p) => p.type === k)?.value || "";
  const date = g("year") + "-" + g("month") + "-" + g("day");
  const hour = Number(g("hour")) % 24;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday"));
  return { date, hour, weekday: wd < 0 ? new Date().getUTCDay() : wd };
}

// Local midnight → next midnight as UTC instants (same trick as the router).
function dayWindow(tz: string, date: string) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz || "Europe/Madrid", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now);
  const g = (k: string) => Number(parts.find((p) => p.type === k)?.value || 0);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  const offsetMin = Math.round((asUtc - now.getTime()) / 60_000);
  const from = Date.parse(date + "T00:00:00Z") - offsetMin * 60_000;
  return { from: new Date(from).toISOString(), to: new Date(from + 86400_000).toISOString() };
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

export async function predictChips(sb: SupabaseClient, input: PredictInput): Promise<ChefChip[]> {
  const { entityId, tz, lang, uid } = input;
  const es = lang === "es";
  const { date: today, hour, weekday } = localClock(tz);
  const rid = (ENTITY_TO_RESTAURANT as Record<string, string | undefined>)[entityId] || null;
  const code = codeForEntityId(entityId);
  const now = Date.now();

  const [inbox, prep, bookings, captures, echo, calendar] = await Promise.all([
    // inbox: rows waiting for a reply
    safe(async (): Promise<Candidate[]> => {
      const { data } = await sb.from("social_inbox_waiting").select("waiting").eq("entity_id", entityId).maybeSingle();
      const waiting = Number((data as any)?.waiting || 0);
      if (!(waiting > 0)) return [];
      return [{ key: "inbox", label: clip(es ? waiting + " comentarios esperando" : waiting + " comments waiting"), utterance: "#inbox_open", score: 50 + Math.min(waiting, 20) }];
    }, []),

    // prep: open mise items today, 10–18 h
    safe(async (): Promise<Candidate[]> => {
      if (hour < 10 || hour > 18) return [];
      const { data } = await sb.from("prep_lists").select("status").eq("entity_id", entityId).eq("service_date", today);
      const open = (data || []).filter((i: any) => i.status !== "done").length;
      if (!(open > 0)) return [];
      return [{ key: "prep", label: clip(es ? "Mise pendiente (" + open + ")" : "Prep left (" + open + ")"), utterance: es ? "qué queda en la mise" : "what's left on prep", score: 40 + (hour >= 14 ? 20 : 0) }];
    }, []),

    // bookings: today's book (tomorrow's after 21:00)
    safe(async (): Promise<Candidate[]> => {
      if (!rid) return [];
      const tomorrow = hour >= 21;
      const date = tomorrow ? localClock(tz, 1).date : today;
      const { data } = await sb.from("bookings").select("status").eq("restaurant_id", rid).eq("service_date", date);
      const live = (data || []).filter((b: any) => !["cancelled", "no_show"].includes(String(b.status || "").toLowerCase()));
      if (!live.length) return [];
      if (tomorrow) return [{ key: "bookings_tomorrow", label: es ? "Reservas de mañana" : "Bookings tomorrow", utterance: es ? "reservas de mañana" : "bookings tomorrow", score: 30 }];
      const peak = (hour >= 11 && hour <= 13) || (hour >= 18 && hour <= 20);
      return [{ key: "bookings", label: es ? "Reservas de hoy" : "Bookings today", utterance: es ? "reservas de hoy" : "bookings today", score: 30 + (peak ? 25 : 0) }];
    }, []),

    // delivery day: this weekday has had ≥ 2 paper captures in the last 8 weeks, 8–14 h
    safe(async (): Promise<Candidate[]> => {
      if (!code || hour < 8 || hour > 14) return [];
      const since = new Date(now - 56 * 86400_000).toISOString();
      const { data } = await sb.from("invoice_inbox").select("arrived_at").eq("entity_id", code).eq("source", "paper_photo").gte("arrived_at", since).limit(500);
      const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz || "Europe/Madrid", weekday: "short" });
      const wdOf = (iso: string) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(fmt.format(new Date(iso)));
      const n = (data || []).filter((r: any) => r.arrived_at && wdOf(r.arrived_at) === weekday).length;
      if (n < 2) return [];
      return [{ key: "capture", label: es ? "Captura albarán" : "Capture delivery note", utterance: es ? "albarán" : "delivery note", score: 45 }];
    }, []),

    // yesterday echo: what this user asked at this time yesterday (±90 min)
    safe(async (): Promise<Candidate[]> => {
      const centre = now - 24 * 3600_000;
      const from = new Date(centre - 90 * 60_000).toISOString();
      const to = new Date(centre + 90 * 60_000).toISOString();
      const { data } = await sb.from("chef_turns").select("transcript, intent, outcome").eq("user_id", uid)
        .gte("created_at", from).lte("created_at", to).neq("outcome", "error").limit(200);
      const groups = new Map<string, { n: number; transcript: string }>();
      for (const r of data || []) {
        const it = (r as any).intent || {};
        const kind = String(it.kind || "");
        const tx = String((r as any).transcript || "").trim();
        if (!kind || !tx || tx.startsWith("#") || kind === "clarify") continue;
        const g = kind + "|" + String(it.surface || "") + "|" + String(it.q || "").toLowerCase();
        const cur = groups.get(g);
        if (cur) cur.n += 1; else groups.set(g, { n: 1, transcript: tx });
      }
      let best: { n: number; transcript: string } | null = null;
      for (const g of groups.values()) if (!best || g.n > best.n) best = g;
      if (!best) return [];
      return [{ key: "yesterday", label: clip(best.transcript), utterance: best.transcript, score: 35 }];
    }, []),

    // calendar: something starts within the next 2 h
    safe(async (): Promise<Candidate[]> => {
      const { from, to } = dayWindow(tz, today);
      const events = await loadEvents({ from, to, entityId });
      const soon = events.some((e) => {
        if (e.all_day) return false;
        const s = Date.parse(e.start_ts);
        return s >= now - 5 * 60_000 && s <= now + 2 * 3600_000;
      });
      if (!soon) return [];
      return [{ key: "calendar", label: es ? "Calendario" : "What's on", utterance: es ? "qué hay en el calendario" : "what's on today", score: 38 }];
    }, []),
  ]);

  const all = [...inbox, ...prep, ...bookings, ...captures, ...echo, ...calendar].sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const seenUtt = new Set<string>();
  const out: ChefChip[] = [];
  for (const c of all) {
    const u = c.utterance.toLowerCase();
    if (seen.has(c.key) || seenUtt.has(u)) continue; // the echo may repeat a rule chip
    seen.add(c.key); seenUtt.add(u);
    out.push({ key: c.key, label: clip(c.label), utterance: c.utterance });
    if (out.length >= 3) break;
  }
  return out;
}
