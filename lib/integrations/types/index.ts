// Vendor-agnostic adapter contracts. Nothing in app/ imports a vendor SDK directly —
// everything goes through these interfaces so we can swap fresto→square or
// holded→quickbooks by changing a row in `integrations` (or per-venue config).

export type EntityCode = "IFL" | "BM" | "BBH";

// ---------- POS adapter (Fresto today, Square / Lightspeed / Micros later) ----------
export interface PosSaleLine {
  group: "food" | "wine" | "bar" | "softdrinks" | "tips" | "other";
  description?: string;
  net_eur: number;
  vat_rate: 0 | 10 | 21; // Spain rates
  vat_eur: number;
}
export interface PosDailySale {
  date: string;          // YYYY-MM-DD
  restaurant_id: string;
  covers: number;
  lines: PosSaleLine[];
  total_eur: number;
  source: { adapter: string; raw_ref?: string };
}
export interface PosAdapter {
  name: string;
  pullDay(restaurant_id: string, date: string): Promise<PosDailySale | null>;
}

// ---------- Accounting adapter (Holded today, QuickBooks / Sage later) ----------
export interface AccountingSalesReceipt {
  entity: EntityCode;
  date: string;          // YYYY-MM-DD
  description: string;
  lines: { account_code: string; description: string; net_eur: number; vat_rate: 0 | 10 | 21 }[];
}
export interface AccountingPurchase {
  entity: EntityCode;
  date: string;
  supplier_id_external: string;
  doc_ref: string;
  total_eur: number;
  approved: boolean;
}
export interface AccountingMovement {
  entity: EntityCode;
  date: string;
  account: string;
  amount_eur: number;     // signed: + credit, - debit
  description: string;
  external_id: string;
}
export interface AccountingAdapter {
  name: string;
  postSalesReceipt(input: AccountingSalesReceipt): Promise<{ external_id: string }>;
  listUnapprovedPurchases(entity: EntityCode): Promise<AccountingPurchase[]>;
  listMovementsSince(entity: EntityCode, since: string): Promise<AccountingMovement[]>;
}

// ---------- Booking adapter (Fresto / CoverManager / OpenTable) ----------
export interface BookingRecord {
  external_id: string;
  service_date: string;
  service_time?: string;
  guest_name: string;
  party_size: number;
  table_ref?: string;
  notes?: string;
  deposit_eur?: number;
}
export interface BookingAdapter {
  name: string;
  listBookingsForDay(restaurant_id: string, date: string): Promise<BookingRecord[]>;
}

// ---------- Payment adapter (Viva Wallet / Square / MIX) ----------
export interface PaymentRecord {
  external_id: string;
  date: string;
  amount_eur: number;
  payment_type: "booking_deposit" | "tip" | "card_present" | "online";
  ref?: string;          // booking id / table / customer ref
}
export interface PaymentAdapter {
  name: string;
  listPaymentsSince(restaurant_id: string, since: string): Promise<PaymentRecord[]>;
}
