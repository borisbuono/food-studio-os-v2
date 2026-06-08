import type {
  FrestoAdapter, FrestoBooking, FrestoTable, FrestoSalesSummary,
} from "./types";

// Live fresto adapter — SCAFFOLD ONLY.
// Lars (fresto CEO) hasn't sent the API spec/credentials yet, so the request/response
// mapping below is intentionally stubbed: every method throws NotConnected and the
// factory in ./index falls back to the mock. When the spec lands, fill the three
// fetch() bodies + the response→type mappers and the rest of the app needs no change
// (it only ever sees the FrestoAdapter interface).

export class FrestoNotConnected extends Error {
  constructor(msg = "fresto live API not connected yet") { super(msg); this.name = "FrestoNotConnected"; }
}

export interface FrestoCredentials {
  apiBase: string;   // e.g. https://api.fresto.io/v1
  token: string;     // bearer / api key (per-venue, from the integrations row)
  locationId: string; // fresto's id for this venue
}

export class LiveFrestoAdapter implements FrestoAdapter {
  readonly mode = "live" as const;
  constructor(
    public readonly restaurantId: string,
    private readonly creds: FrestoCredentials,
  ) {}

  // Shared request helper — ready for when the endpoints are known.
  private async req<T>(path: string): Promise<T> {
    void path;
    // const r = await fetch(`${this.creds.apiBase}${path}`, {
    //   headers: { authorization: `Bearer ${this.creds.token}` },
    //   cache: "no-store",
    // });
    // if (!r.ok) throw new Error(`fresto ${r.status}`);
    // return (await r.json()) as T;
    throw new FrestoNotConnected();
  }

  async getBookings(_date: string): Promise<FrestoBooking[]> {
    // TODO map: GET /locations/{id}/reservations?date= → FrestoBooking[]
    return this.req<FrestoBooking[]>("/reservations");
  }
  async getTables(): Promise<FrestoTable[]> {
    // TODO map: GET /locations/{id}/tables → FrestoTable[]
    return this.req<FrestoTable[]>("/tables");
  }
  async getSalesSummary(_date: string): Promise<FrestoSalesSummary> {
    // TODO map: GET /locations/{id}/sales/summary?date= → FrestoSalesSummary
    return this.req<FrestoSalesSummary>("/sales/summary");
  }
  async health() {
    try { await this.req<unknown>("/health"); return { ok: true, detail: "fresto live" }; }
    catch (e: any) { return { ok: false, detail: e?.message || "unreachable" }; }
  }
}
