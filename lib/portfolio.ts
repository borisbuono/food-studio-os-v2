// lib/portfolio.ts — shared loaders + date/money helpers for the three Studio
// destination pages (/studio/advisory, /studio/partners, /studio/landlords).
//
// Tasks #34 + #52 (2026-09-21). Schema: supabase/migrations/20260921_portfolio_destinations.sql
//
// Real vs demo: every portfolio_* row carries is_demo. Pages read
// is_demo=false by default; ?demo=1 flips to the Utopia demo rows and the
// page shows a DEMO banner. The two are never mixed on one screen.

import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { getMyMembershipContext } from "@/lib/memberships";

export type ContractKind =
  | "advisory_engagement" | "joint_venture" | "revenue_share"
  | "licence" | "lease" | "catering" | "other";

export type Contract = {
  id: string;
  entity_id: string;
  counterparty_name: string | null;
  kind: ContractKind;
  title: string;
  status: "draft" | "active" | "paused" | "ended";
  start_date: string | null;
  end_date: string | null;
  notice_days: number | null;
  fee_eur: number | null;
  fee_cadence: string | null;
  hourly_rate_eur: number | null;
  revenue_share_pct: number | null;
  equity_pct: number | null;
  rent_eur: number | null;
  rent_due_day: number | null;
  next_review_on: string | null;
  doc_url: string | null;
  notes: string | null;
  is_demo: boolean;
  entity: { id: string; name: string; entity_type: string; status: string | null } | null;
};

export const CONTRACT_COLS =
  "id,entity_id,counterparty_name,kind,title,status,start_date,end_date,notice_days,fee_eur,fee_cadence,hourly_rate_eur,revenue_share_pct,equity_pct,rent_eur,rent_due_day,next_review_on,doc_url,notes,is_demo,entity:entities(id,name,entity_type,status)";

// Owner or multi-role only — same gate as /studio. Returns the tenant-scoped
// entity list too, so pages stay inside the viewer's own portfolio.
export async function requireStudioAccess() {
  const sb = supabaseServer();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) redirect("/welcome");
  const ctx = await getMyMembershipContext();
  if (!ctx.isOwner && !ctx.isMulti && ctx.memberships.length === 1) {
    const m = ctx.memberships[0];
    if (m.room !== "studio") redirect(`/${m.room === "kitchen" ? "boh" : m.room === "dining" ? "foh" : "office"}`);
  }
  return { sb, ctx, entityIds: ctx.entities.map((e) => e.id) };
}

export function isDemo(sp: Record<string, string | string[] | undefined> | undefined): boolean {
  const v = sp?.demo;
  return v === "1" || (Array.isArray(v) && v.includes("1"));
}

export async function loadContracts(
  sb: ReturnType<typeof supabaseServer>,
  kinds: ContractKind[],
  demo: boolean,
  entityIds: string[],
): Promise<Contract[]> {
  if (!entityIds.length) return [];
  const { data } = await sb
    .from("portfolio_contracts")
    .select(CONTRACT_COLS)
    .in("kind", kinds)
    .eq("is_demo", demo)
    .in("entity_id", entityIds)
    .order("status")
    .order("end_date", { ascending: true, nullsFirst: false });
  return ((data as any[]) || []).map((r) => ({
    ...r,
    entity: Array.isArray(r.entity) ? r.entity[0] ?? null : r.entity ?? null,
  })) as Contract[];
}

// Display name: counterparty text wins (demo rows + contracts with a named
// counterparty), else the entity name.
export function contractParty(c: Contract): string {
  return c.counterparty_name || c.entity?.name || "—";
}

// ---- dates (Madrid business day) -------------------------------------------
export function madridToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
export function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + "T12:00:00Z").getTime();
  const b = new Date(toISO + "T12:00:00Z").getTime();
  return Math.round((b - a) / 864e5);
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function monthStart(iso: string): string {
  return iso.slice(0, 8) + "01";
}
export function addMonths(isoMonthStart: string, n: number): string {
  const d = new Date(isoMonthStart + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n, 1);
  return d.toISOString().slice(0, 10);
}
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(String(iso).slice(0, 10) + "T12:00:00Z");
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}
export function monthLabel(iso: string): string {
  const d = new Date(String(iso).slice(0, 10) + "T12:00:00Z");
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}
// "in 6 days" / "today" / "3 days ago"
export function relDays(iso: string | null | undefined, today: string): string {
  if (!iso) return "";
  const n = daysBetween(today, String(iso).slice(0, 10));
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export function eur(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return "—";
  const v = Number(n);
  return (v < 0 ? "-" : "") + "€" + Math.round(Math.abs(v)).toLocaleString("en-GB");
}

// Contract end + notice window. Notice deadline = end_date − notice_days.
export function expiryInfo(c: Contract, today: string): {
  daysToEnd: number | null; noticeBy: string | null; daysToNotice: number | null; urgent: boolean;
} {
  if (!c.end_date) return { daysToEnd: null, noticeBy: null, daysToNotice: null, urgent: false };
  const daysToEnd = daysBetween(today, c.end_date);
  const noticeBy = c.notice_days ? addDays(c.end_date, -c.notice_days) : null;
  const daysToNotice = noticeBy ? daysBetween(today, noticeBy) : null;
  const urgent = daysToEnd <= 60 || (daysToNotice != null && daysToNotice <= 30);
  return { daysToEnd, noticeBy, daysToNotice, urgent };
}

// Rent due for a lease this month or next. Returns the earliest unpaid
// period from (this month − 2) forward, so an unpaid previous month shows
// as overdue rather than disappearing.
export function rentDue(
  c: Contract,
  paidPeriods: Set<string>,
  today: string,
): { period: string; dueOn: string; amount: number; overdueDays: number } | null {
  if (c.status !== "active" || !c.rent_eur || !c.rent_due_day) return null;
  const m0 = monthStart(today);
  for (let i = -2; i <= 1; i++) {
    const period = addMonths(m0, i);
    if (c.start_date && period < monthStart(c.start_date)) continue;
    if (c.end_date && period > c.end_date) continue;
    if (paidPeriods.has(period)) continue;
    const lastDay = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();
    const dueOn = period.slice(0, 8) + String(Math.min(c.rent_due_day, lastDay)).padStart(2, "0");
    return { period, dueOn, amount: Number(c.rent_eur), overdueDays: Math.max(0, daysBetween(dueOn, today)) };
  }
  return null;
}
