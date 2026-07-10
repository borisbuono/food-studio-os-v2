// Substrate-agnostic adapter contracts. Vendor swaps (Fresto → Square, Holded → QuickBooks,
// CoverManager → OpenTable, etc.) are config not rewrite. Every adapter exposes `name` so the
// UI never hardcodes a vendor — labels come from the active adapter.

export type EntityCode = "IFL" | "BM" | "BBH";

// ---------- POS ----------
export interface PosSaleLine {
  group: "food" | "wine" | "bar" | "softdrinks" | "tips" | "service" | "other";
  description?: string;
  net_eur: number;
  vat_rate: 0 | 4 | 10 | 21;
  vat_eur: number;
}
export interface PosDailySale {
  date: string;             // YYYY-MM-DD
  restaurant_id: string;
  covers: number;
  lines: PosSaleLine[];
  total_eur: number;
  source: { adapter: string; raw_ref?: string };
}
export interface PosAdapter {
  name: string;
  vendor: "fresto" | "square" | "micros" | "toast" | "lightspeed" | "csv" | string;
  // Pull a day's sales — live API if connected, cache fallback otherwise
  pullDay(restaurant_id: string, date: string): Promise<PosDailySale | null>;
  // Optional XLSX/CSV parse path (used when the API isn't live yet)
  parseUpload?(buf: ArrayBuffer): Promise<PosDailySale[]>;
}

// ---------- Accounting ----------
export interface AccountingSalesReceipt {
  entity: EntityCode;
  date: string;
  description: string;
  lines: { account_code: string; description: string; net_eur: number; vat_rate: number }[];
}
export interface AccountingPurchase {
  external_id: string;
  date: string;
  supplier_name: string | null;
  amount_eur: number;
  vat_eur: number;
  status: "unapproved" | "approved" | "cancelled" | string;
  url?: string;
}
export interface AccountingMovement {
  external_id: string;
  date: string;
  description: string;
  amount_eur: number;
  bank_account: string;
}
export interface AccountingAdapter {
  name: string;
  vendor: "holded" | "quickbooks" | "xero" | "sage" | string;
  postSalesReceipt(input: AccountingSalesReceipt): Promise<{ external_id: string; dryRun: boolean }>;
  listUnapprovedPurchases(entity: EntityCode): Promise<AccountingPurchase[]>;
  listMovementsSince(entity: EntityCode, sinceUnixSec: number): Promise<AccountingMovement[]>;
}

// ---------- Booking ----------
export interface BookingRecord {
  external_id: string;
  date: string;
  time: string;
  party_size: number;
  guest_name: string;
  status: "confirmed" | "cancelled" | "no_show" | "seated" | string;
}
export interface BookingAdapter {
  name: string;
  vendor: "covermanager" | "opentable" | "sevenrooms" | "thefork" | "resy" | string;
  pullDay(restaurant_id: string, date: string): Promise<BookingRecord[]>;
}

// ---------- Payment / acquirer ----------
export interface PaymentRecord {
  external_id: string;
  date: string;
  amount_eur: number;
  fee_eur?: number;
  brand?: string;
  last4?: string;
}
export interface PaymentAdapter {
  name: string;
  vendor: "stripe" | "adyen" | "redsys" | "caixabank" | "square_payments" | string;
  pullSettlementsSince(entity: EntityCode, sinceUnixSec: number): Promise<PaymentRecord[]>;
}

// ---------- Banking ----------
export interface BankMovement {
  external_id: string;
  date: string;
  description: string;
  amount_eur: number;
  balance_eur?: number;
  bank_account: string;
}
export interface BankingAdapter {
  name: string;
  vendor: "caixabank" | "bbva" | "santander" | "plaid" | "tink" | "gocardless" | string;
  listMovementsSince(entity: EntityCode, sinceUnixSec: number): Promise<BankMovement[]>;
}

// ---------- Registry binding ----------
export interface IntegrationBinding {
  entity: EntityCode;
  pos?: { vendor: string; status: "connected" | "stub" | "off" };
  accounting?: { vendor: string; status: "connected" | "stub" | "off" };
  booking?: { vendor: string; status: "connected" | "stub" | "off" };
  payment?: { vendor: string; status: "connected" | "stub" | "off" };
  banking?: { vendor: string; status: "connected" | "stub" | "off" };
  marketing?: { vendor: string; status: "connected" | "stub" | "off" };
  social?: { vendor: string; status: "connected" | "stub" | "off" };
  reviews?: { vendor: string; status: "connected" | "stub" | "off" };
}

// ---------- Marketing (Grow · Reach) ----------
export interface GuestSegment {
  id: string;                          // internal segment id or ad-hoc slug
  name: string;                        // human label ("Wine club", "Birthday this month")
  guests: Array<{
    external_id?: string;              // vendor-side id if we've synced before
    email?: string | null;
    phone?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    tags?: string[];
  }>;
}
export interface CampaignDraft {
  channel: "email" | "sms" | "whatsapp";
  subject?: string;                    // email only
  body: string;                        // plain or HTML depending on channel
  segment_id: string;                  // audience reference (matches GuestSegment.id)
  send_at?: string;                    // ISO — omit for send-now
  from_name?: string;
  from_email?: string;
}
export interface MarketingAdapter {
  name: string;
  vendor: "klaviyo" | "mailchimp" | "hubspot" | string;
  pushAudience(segment: GuestSegment): Promise<{ external_id: string; dryRun: boolean }>;
  pushCampaign(campaign: CampaignDraft): Promise<{ external_id: string; dryRun: boolean }>;
}

// ---------- Social (Grow · Reach) ----------
export interface SocialPost {
  channels: Array<"instagram" | "facebook" | "tiktok" | "threads" | "x" | "linkedin">;
  caption: string;
  media_urls: string[];                // absolute URLs to already-hosted media
  scheduled_at?: string;               // ISO — omit for send-now / draft
}
export interface SocialAdapter {
  name: string;
  vendor: "buffer" | "later" | "postiz" | string;
  schedulePost(post: SocialPost): Promise<{ external_id: string; dryRun: boolean }>;
}

// ---------- Reviews (Grow · Reputation) ----------
export interface ReviewRecord {
  external_id: string;
  platform: "google" | "tripadvisor" | "thefork" | "yelp" | string;
  author_name: string | null;
  rating: number | null;               // 1..5, null if platform doesn't rate
  body: string;
  posted_at: string;                   // ISO
  reply?: { body: string; posted_at: string } | null;
  url?: string | null;
}
export interface ReviewsAdapter {
  name: string;
  vendor: "google-business" | "tripadvisor" | "thefork" | "yelp" | string;
  listReviewsSince(entity: EntityCode, sinceUnixSec: number): Promise<ReviewRecord[]>;
  postReply(entity: EntityCode, external_id: string, body: string): Promise<{ ok: boolean; dryRun: boolean }>;
}

// ---------- EOD two-record split (2026-07-05) ----------
// See supabase/migrations/20260705_eod_two_record_split.sql and
// memory/pos_vs_accounting_separation.md.
export type EodDeviationCategory =
  | "comp" | "discount" | "credit_tab" | "staff_meal" | "waste"
  | "pos_error" | "cash_deficit" | "rounding" | "other";

export type EodAffectedLine =
  | "food" | "wine" | "bar" | "softdrinks" | "tips" | "service" | "cash" | "card";

export interface EodPosSnapshot {
  id: string;
  restaurant_id: string;
  date: string;
  source: "fresto" | "csv" | "manual";
  source_ref?: string | null;
  covers: number;
  food_net_eur: number;
  wine_net_eur: number;
  bar_net_eur: number;
  softdrinks_net_eur: number;
  tips_eur: number;
  service_charge_eur: number;
  cash_declared_eur: number;
  card_declared_eur: number;
  total_gross_eur: number;
  imported_at: string;
  imported_by: string | null;
  raw_payload?: any;
}

export interface AccountingEod {
  id: string;
  restaurant_id: string;
  report_date: string;
  eod_pos_id: string | null;             // link to the immutable POS snapshot
  actual_covers: number;
  revenue: number;
  revenue_food: number;
  revenue_wine: number;
  revenue_bar: number;
  eighty_six_notes?: string | null;
  wastage_notes?: string | null;
}

export interface EodDeviation {
  id: string;
  eod_pos_id: string | null;
  eod_accounting_id: string | null;
  category: EodDeviationCategory;
  affected_line: EodAffectedLine;
  amount_eur: number;                    // signed
  description?: string | null;
  created_at: string;
  created_by: string | null;
}
