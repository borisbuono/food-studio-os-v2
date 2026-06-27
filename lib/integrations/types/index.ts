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
}
