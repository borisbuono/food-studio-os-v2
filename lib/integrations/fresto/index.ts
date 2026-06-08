import { supabase } from "@/lib/supabase";
import type { FrestoAdapter } from "./types";
import { MockFrestoAdapter } from "./mock";
import { LiveFrestoAdapter, type FrestoCredentials } from "./live";

export * from "./types";
export { MockFrestoAdapter } from "./mock";
export { LiveFrestoAdapter, FrestoNotConnected } from "./live";

// Pick the adapter for a venue. Reads the `integrations` row (provider='fresto') created
// by the Day-6 migration. We only go LIVE when the row is explicitly connected AND carries
// credentials; anything else (no row, status!='connected', missing config, or the table
// not migrated yet) falls back to the deterministic mock so every screen still renders.
//
// Shape assumed (from 20260607_floor_bookings.sql): integrations(restaurant_id, provider,
// status, config jsonb). config = { api_base, token, location_id }.
export async function getFrestoAdapter(restaurantId: string): Promise<FrestoAdapter> {
  try {
    const { data, error } = await supabase
      .from("integrations")
      .select("status, config")
      .eq("restaurant_id", restaurantId)
      .eq("provider", "fresto")
      .maybeSingle();
    if (error || !data || data.status !== "connected") {
      return new MockFrestoAdapter(restaurantId);
    }
    const cfg = (data.config || {}) as Record<string, string>;
    const creds: FrestoCredentials = {
      apiBase: cfg.api_base || "",
      token: cfg.token || "",
      locationId: cfg.location_id || "",
    };
    if (!creds.apiBase || !creds.token) return new MockFrestoAdapter(restaurantId);
    return new LiveFrestoAdapter(restaurantId, creds);
  } catch {
    // table not migrated / network — never block a render on the adapter
    return new MockFrestoAdapter(restaurantId);
  }
}
