import type {
  FrestoAdapter, FrestoBooking, FrestoTable, FrestoSalesSummary, BookingStatus,
} from "./types";

// Deterministic mock fresto data. Everything is seeded off the service date so a given
// day always looks the same (no flicker between renders) yet each date differs. Grounded
// in known Ibiza dinner-service cover patterns: quiet early week, busy Thu–Sat, a fat
// 21:00–22:00 second seating, terrace-heavy in June.

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}
function rng(seed: number): () => number {
  let x = seed || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
}

const TABLES: FrestoTable[] = [
  { label: "1", seats: 2, zone: "Terrace" }, { label: "2", seats: 2, zone: "Terrace" },
  { label: "3", seats: 4, zone: "Terrace" }, { label: "4", seats: 4, zone: "Terrace" },
  { label: "5", seats: 6, zone: "Terrace" }, { label: "10", seats: 2, zone: "Main" },
  { label: "11", seats: 4, zone: "Main" }, { label: "12", seats: 4, zone: "Main" },
  { label: "14", seats: 6, zone: "Main" }, { label: "Bar 1", seats: 1, zone: "Bar" },
  { label: "Bar 2", seats: 1, zone: "Bar" }, { label: "Bar 3", seats: 1, zone: "Bar" },
];

const NAMES = ["Ferrer", "de Bruine", "Marí", "Costa", "Planells", "Torres", "Roig", "Bonet", "Escandell", "Riera", "Tur", "Juan"];
const NOTES = [null, null, "anniversary", "coeliac — no gluten", "terrace requested", "regular", "high chair", "nut allergy", null];
const TIMES = ["19:30", "20:00", "20:00", "20:30", "21:00", "21:00", "21:30", "22:00", "22:00", "22:30"];

function isWeekend(date: string): boolean {
  const d = new Date(date + "T12:00:00").getUTCDay(); // 4=Thu 5=Fri 6=Sat
  return d === 4 || d === 5 || d === 6;
}

export class MockFrestoAdapter implements FrestoAdapter {
  readonly mode = "mock" as const;
  constructor(public readonly restaurantId: string) {}

  async getTables(): Promise<FrestoTable[]> { return TABLES; }

  async getBookings(date: string): Promise<FrestoBooking[]> {
    const r = rng(hash(this.restaurantId + ":" + date));
    const base = isWeekend(date) ? 14 : 7;
    const count = base + Math.floor(r() * 5);
    const today = new Date().toISOString().slice(0, 10);
    const past = date < today;
    const out: FrestoBooking[] = [];
    const free = [...TABLES];
    for (let i = 0; i < count; i++) {
      const party = 2 + Math.floor(r() * 5);
      // seat ~80% of bookings; the rest stay unassigned so the floor plan can nudge
      let tableLabel: string | null = null;
      const fit = free.findIndex((t) => t.seats >= party);
      if (r() < 0.8 && fit >= 0) { tableLabel = free[fit]!.label; free.splice(fit, 1); }
      let status: BookingStatus = "confirmed";
      if (past) status = r() < 0.06 ? "no_show" : "finished";
      else if (r() < 0.25) status = "seated";
      out.push({
        id: `mock-${date}-${i + 1}`,
        date,
        time: TIMES[Math.floor(r() * TIMES.length)]!,
        partySize: party,
        guestName: NAMES[Math.floor(r() * NAMES.length)]!,
        status,
        tableLabel,
        notes: NOTES[Math.floor(r() * NOTES.length)]!,
        channel: r() < 0.6 ? "fresto" : r() < 0.85 ? "web" : "phone",
      });
    }
    return out.sort((a, b) => a.time.localeCompare(b.time));
  }

  async getSalesSummary(date: string): Promise<FrestoSalesSummary> {
    const bookings = await this.getBookings(date);
    const seatedCovers = bookings
      .filter((b) => b.status === "seated" || b.status === "finished")
      .reduce((s, b) => s + b.partySize, 0);
    // add ~25% walk-ins on top of booked covers
    const covers = Math.round(seatedCovers * 1.25);
    const avgCheck = 52 + (isWeekend(date) ? 12 : 0); // € gross per cover
    const grossSales = covers * avgCheck;
    const netSales = Math.round(grossSales / 1.1); // 10% IVA, restaurant reduced rate
    const today = new Date().toISOString().slice(0, 10);
    const openTabs = date === today
      ? bookings.filter((b) => b.status === "seated").length
      : 0;
    return {
      date, covers, netSales, grossSales,
      avgCheck: covers ? Math.round(grossSales / covers) : 0,
      openTabs, asOf: new Date().toISOString(),
    };
  }

  async health() { return { ok: true, detail: "mock adapter — deterministic seed data" }; }
}
