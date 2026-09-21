// calendar.ts — shared types + palette for the unified OS calendar.
//
// `public.events` is an OVERLAY: one row per source row (shift, booking,
// interview, task, social post, sales event, prep day, HACCP service,
// commercial) kept in step by DB triggers + a nightly pg_cron catch-up
// (migration 20260921_calendar_events_sync). Meetings and Google "external"
// rows live only in `events`. Never edit a mirrored row directly — write the
// source table and the trigger re-syncs (see app/api/events/[id]).

export type EventSource =
  | "shift" | "booking" | "interview" | "task" | "social" | "sales_event"
  | "meeting" | "prep" | "haccp" | "commercial" | "external";

export const EVENT_SOURCES: EventSource[] = [
  "shift", "booking", "interview", "task", "social", "sales_event",
  "meeting", "prep", "haccp", "commercial", "external",
];

export type CalEvent = {
  id: string;
  entity_id: string | null;
  source_type: EventSource;
  source_id: string | null;
  title: string;
  description: string | null;
  start_ts: string;
  end_ts: string | null;
  all_day: boolean;
  timezone: string | null;
  colour: string | null;
  location: string | null;
  person_ids: string[];
  external_ref: string | null;
  status: string | null;
  meta: Record<string, any>;
};

export const EVENT_COLUMNS =
  "id, entity_id, source_type, source_id, title, description, start_ts, end_ts, all_day, timezone, colour, location, person_ids, external_ref, status, meta";

// Defaults per source. Shifts take the venue accent (stored on the row).
export const SOURCE_COLOUR: Record<EventSource, string> = {
  shift: "#2B3A45",
  booking: "#C9B38A",      // guest / sand
  interview: "#D98E04",    // amber
  task: "#4A6FA5",
  social: "#6B7A3A",       // IFS olive
  sales_event: "#D2452F",  // tomato
  meeting: "#5B6770",      // slate
  external: "#9AA3AB",     // slate, dimmed in UI
  prep: "#8A8A8A",
  haccp: "#8A8A8A",
  commercial: "#B5651D",
};

export const SOURCE_LABEL: Record<EventSource, string> = {
  shift: "Shifts", booking: "Bookings", interview: "Interviews", task: "Tasks",
  social: "Social", sales_event: "Events", meeting: "Meetings", external: "Google",
  prep: "Prep", haccp: "HACCP", commercial: "Promos",
};

// Which sources can be dragged to a new time (write-back to the source row).
// Bookings are guest promises — never moved from a calendar drag.
// Social posts only while not yet approved/published (meta-publish reads them).
export function canReschedule(e: CalEvent): boolean {
  switch (e.source_type) {
    case "shift": case "interview": case "task": case "meeting": case "sales_event":
      return true;
    case "social":
      return !e.meta?.approved && e.status !== "published";
    default:
      return false;
  }
}

export function eventColour(e: Pick<CalEvent, "colour" | "source_type">): string {
  return e.colour || SOURCE_COLOUR[e.source_type] || "#5B6770";
}

// Wall-clock parts of an instant in a given IANA zone (Madrid / Amsterdam).
export function zonedParts(iso: string | Date, tz: string) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour), minute: Number(p.minute), weekday: p.weekday,
  };
}

// The UTC instant for wall-clock `ymd hh:mm` in `tz`.
export function zonedToUtc(ymd: string, hh: number, mm: number, tz: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const p = zonedParts(guess, tz);
  const [py, pm, pd] = p.ymd.split("-").map(Number);
  const shown = Date.UTC(py, pm - 1, pd, p.hour, p.minute);
  return new Date(guess.getTime() - (shown - guess.getTime()));
}

export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function mondayOf(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  return addDaysYmd(ymd, dow === 0 ? -6 : 1 - dow);
}
