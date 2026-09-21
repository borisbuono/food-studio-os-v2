// closeStatus.ts — the "Last close DD MMM" line + STALE rule shared by every
// Studio surface that shows a house tile (/studio, /studio/houses).
//
// Task #58 (Studio + House chrome polish, 2026-09-21). The two pages carried
// copy-pasted helpers that disagreed: "today" / "yesterday" / "3 Sep". Boris
// wants the date itself, always — "Last close 21 Sep" — so a tile never
// reads fresh without saying when it closed, plus an orange STALE badge when
// the newest close is more than 48h old.
//
// Dates are business dates (YYYY-MM-DD, the eod_pos.date column) compared
// against today in the house's timezone.

export function todayInTz(tz = "Europe/Madrid"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

// "2026-09-03" → "03 Sep". Fixed 3-letter months: Intl en-GB renders
// September as "Sept" on current ICU, which broke the DD MMM format.
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function ddMmm(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MON[d.getUTCMonth()]}`;
}

export function lastCloseLabel(iso: string): string {
  return `Last close ${ddMmm(iso)}`;
}

// > 48h between the close's business date and today. A close dated two days
// ago is exactly 48h → not stale; three days ago → stale.
export function isStaleClose(iso: string, today: string): boolean {
  const now = new Date(today + "T12:00:00Z").getTime();
  const row = new Date(iso + "T12:00:00Z").getTime();
  if (Number.isNaN(now) || Number.isNaN(row)) return false;
  return (now - row) / 36e5 > 48;
}
