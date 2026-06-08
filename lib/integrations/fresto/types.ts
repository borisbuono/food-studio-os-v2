// Fresto POS + bookings adapter — shared types.
// Boris's Taller + Mondo run on fresto.io (POS + bookings all-in-one). This is the
// surface the OS reads from: tonight's bookings, table state, and the live sales pulse
// that feeds the Office home forecast. Until Lars's API lands we run on the mock; the
// shapes here are the contract both the mock and the live adapter satisfy.

export type FrestoMode = "live" | "mock";

export type BookingStatus = "confirmed" | "seated" | "finished" | "cancelled" | "no_show";

export interface FrestoBooking {
  id: string;               // provider booking id (mock ids are stable per date)
  date: string;             // YYYY-MM-DD (service date)
  time: string;             // HH:MM (24h, local)
  partySize: number;
  guestName: string;
  status: BookingStatus;
  tableLabel: string | null; // null = unassigned (the floor plan nudges to seat it)
  notes: string | null;      // allergies / occasion / source
  channel: "fresto" | "phone" | "walkin" | "web";
}

export interface FrestoTable {
  label: string;            // "12", "T4", "Bar 2"
  seats: number;
  zone: string;             // "Terrace", "Main", "Bar"
}

// One rolled-up sales reading — what the Office home pulse + forecast consume.
export interface FrestoSalesSummary {
  date: string;             // YYYY-MM-DD
  covers: number;
  netSales: number;         // € ex-VAT
  grossSales: number;       // € inc-VAT
  avgCheck: number;         // € per cover (gross)
  openTabs: number;         // live tables still open (0 on a closed past day)
  asOf: string;             // ISO timestamp of the reading
}

export interface FrestoAdapter {
  readonly mode: FrestoMode;
  readonly restaurantId: string;
  // tonight's (or a given date's) bookings
  getBookings(date: string): Promise<FrestoBooking[]>;
  // current table inventory as fresto knows it
  getTables(): Promise<FrestoTable[]>;
  // rolled-up sales for a date (today = live pulse, past = closed total)
  getSalesSummary(date: string): Promise<FrestoSalesSummary>;
  // cheap liveness probe — live adapter pings the API, mock always true
  health(): Promise<{ ok: boolean; detail: string }>;
}
