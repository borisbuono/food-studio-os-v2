import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { gmailApiFetch } from "@/lib/assistant/channels/gmail";
import { parseGuestsFromEmailBody } from "@/lib/integrations/pos/fresto";
import type { AssistantChannelRow } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Fresto closing-report email guest scanner.
// Boris walk 2026-08-31 18:15 CET.
//
// Fresto's closing-report EMAIL body contains a "Guests: N" line — the
// closest thing to a real physical guest count that lives in a machine-
// readable place. The Fresto API has NO guest field at all. The email is
// unreliable (doesn't fire every night, sometimes never for a given
// venue) so this is a best-effort backstop; manual key still trumps.
//
// The cron:
//   1) walks every ACTIVE assistant_channel where kind='gmail'
//   2) queries Gmail for closing-report messages in the last 14 days
//   3) extracts the business date from subject/body and the guest count
//      via /guests?:\s*(\d+)/i
//   4) upserts eod_pos.guests with guests_source='email' — but ONLY if
//      the row's guests_source is not already 'manual'
//
// Auth: Bearer $CRON_SECRET (Vercel cron) OR an authenticated Supabase
// user (Boris hitting the URL manually). Same shape as pos-nightly.

const VENUES: Array<{ entity: string; restaurant_id: string; label: string }> = [
  { entity: "BM",  restaurant_id: "fb4d008f-2d2a-4e0d-a525-6e0e36af0259", label: "Bistro Mondo" },
  { entity: "IFL", restaurant_id: "ca83e06f-a24d-43d7-bce4-57ac341d190f", label: "Taller Sa Penya" },
];

// Fresto's closing-report subject line — Boris walk observed both English
// and Spanish variants. The Gmail search is deliberately loose; parsing
// is strict.
const FRESTO_SEARCH_QUERY = 'newer_than:14d (subject:"closing report" OR subject:"cierre" OR from:fresto OR from:noreply@fresto)';

function findHeader(headers: any[], name: string): string {
  const h = (headers || []).find((h) => String(h.name).toLowerCase() === name.toLowerCase());
  return h ? String(h.value || "") : "";
}
function b64urlDecode(s: string): string {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/") + "==".slice((s.length + 3) % 4);
  try { return Buffer.from(norm, "base64").toString("utf8"); } catch { return ""; }
}
function extractPlainText(payload: any): string {
  if (!payload) return "";
  const mime = String(payload.mimeType || "");
  if (mime === "text/plain" && payload.body?.data) return b64urlDecode(payload.body.data);
  if (mime === "text/html" && payload.body?.data) {
    // Strip tags for regex extraction
    return b64urlDecode(payload.body.data).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  }
  const parts: any[] = Array.isArray(payload.parts) ? payload.parts : [];
  for (const p of parts) {
    const t = extractPlainText(p);
    if (t) return t;
  }
  return "";
}
// Try to pin the message to a business date. Fresto's subject usually
// contains the date (e.g. "Closing report — 2026-08-30"). If not, we
// scan the body for a YYYY-MM-DD. As a last resort we use the message's
// received date (Madrid) minus one day.
function inferBusinessDate(subject: string, body: string, receivedAt: Date): string | null {
  const combined = subject + "\n" + body;
  const m = combined.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  // Received-1 in Madrid
  const madrid = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(receivedAt);
  const [y, mo, d] = madrid.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}
// Which venue did the email land for? Best guesses: recipient address
// (admin@bistro-mondo → BM, admin@ibzfoodstudio → IFL) or a substring
// in the body/subject. Returns the restaurant_id or null.
function inferRestaurantId(to: string, subject: string, body: string): string | null {
  const hay = (to + " " + subject + " " + body).toLowerCase();
  if (hay.includes("bistro-mondo") || hay.includes("bistro mondo")) return "fb4d008f-2d2a-4e0d-a525-6e0e36af0259";
  if (hay.includes("ibzfoodstudio") || hay.includes("taller sa penya") || hay.includes("taller")) return "ca83e06f-a24d-43d7-bce4-57ac341d190f";
  return null;
}

async function isAuthorized(req: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") || "";
  if (secret && auth === `Bearer ${secret}`) return true;
  const sb = supabaseServer();
  const { data: userRes } = await sb.auth.getUser();
  return !!userRes?.user;
}

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sb = supabaseServer();

  // Get every Gmail channel — usually just Boris's, but the loop is
  // channel-agnostic. If no channels are connected we exit cleanly.
  const { data: channels } = await sb.from("assistant_channels")
    .select("*")
    .eq("channel_type", "gmail")
    .is("revoked_at", null) as any;
  if (!channels || !channels.length) {
    return NextResponse.json({ ok: true, note: "no active gmail channels", scanned: 0 });
  }

  const perChannel: any[] = [];

  for (const ch of channels as AssistantChannelRow[]) {
    const found: Array<{ message_id: string; subject: string; from: string; to: string; received_at: string }> = [];
    const applied: Array<{ restaurant_id: string; date: string; guests: number; message_id: string }> = [];
    const skipped: Array<{ message_id: string; reason: string }> = [];
    let searchError: string | null = null;

    try {
      const q = encodeURIComponent(FRESTO_SEARCH_QUERY);
      const list = await gmailApiFetch(ch, `/users/me/messages?q=${q}&maxResults=25`);
      const msgs: any[] = list.messages || [];
      for (const m of msgs) {
        try {
          const full = await gmailApiFetch(ch, `/users/me/messages/${m.id}?format=full`);
          const headers = full.payload?.headers || [];
          const subject = findHeader(headers, "Subject");
          const from = findHeader(headers, "From");
          const to = findHeader(headers, "To");
          const dateHdr = findHeader(headers, "Date");
          const receivedAt = dateHdr ? new Date(dateHdr) : new Date(Number(full.internalDate || Date.now()));
          const body = extractPlainText(full.payload);
          found.push({ message_id: m.id, subject, from, to, received_at: receivedAt.toISOString() });

          const guests = parseGuestsFromEmailBody(body) ?? parseGuestsFromEmailBody(subject);
          if (guests == null) { skipped.push({ message_id: m.id, reason: "no guests: field found" }); continue; }

          const rid = inferRestaurantId(to, subject, body);
          if (!rid) { skipped.push({ message_id: m.id, reason: "could not infer restaurant" }); continue; }
          if (!VENUES.some((v) => v.restaurant_id === rid)) { skipped.push({ message_id: m.id, reason: "unknown restaurant" }); continue; }

          const bizDate = inferBusinessDate(subject, body, receivedAt);
          if (!bizDate) { skipped.push({ message_id: m.id, reason: "no business date" }); continue; }

          // Manual key trumps email — never overwrite guests_source='manual'.
          const { data: existing } = await sb.from("eod_pos")
            .select("id, guests_source")
            .eq("restaurant_id", rid)
            .eq("date", bizDate)
            .eq("source", "fresto")
            .maybeSingle();

          if (existing?.guests_source === "manual") {
            skipped.push({ message_id: m.id, reason: `manual key present for ${bizDate}` });
            continue;
          }

          if (existing?.id) {
            const upd = await sb.from("eod_pos").update({
              guests, guests_source: "email",
              guests_keyed_by: null, guests_keyed_at: new Date().toISOString(),
            }).eq("id", existing.id);
            if (upd.error) { skipped.push({ message_id: m.id, reason: "update failed: " + upd.error.message }); continue; }
          } else {
            const ins = await sb.from("eod_pos").insert({
              restaurant_id: rid, date: bizDate, source: "fresto",
              source_ref: `email:${m.id}`,
              covers: null, tickets: null, orders_count: null, tables_count: null,
              food_net_eur: 0, wine_net_eur: 0, bar_net_eur: 0, softdrinks_net_eur: 0,
              tips_eur: 0, service_charge_eur: 0, cash_declared_eur: 0, card_declared_eur: 0,
              total_gross_eur: 0,
              guests, guests_source: "email",
              guests_keyed_by: null, guests_keyed_at: new Date().toISOString(),
              raw_payload: { stub: true, from_email: true, message_id: m.id },
            });
            if (ins.error) { skipped.push({ message_id: m.id, reason: "insert failed: " + ins.error.message }); continue; }
          }
          applied.push({ restaurant_id: rid, date: bizDate, guests, message_id: m.id });
        } catch (e: any) {
          skipped.push({ message_id: m.id, reason: "fetch failed: " + (e?.message || String(e)) });
        }
      }
    } catch (e: any) {
      searchError = e?.message || String(e);
    }

    perChannel.push({
      channel_id: ch.id, channel_email: (ch as any).account_ref || null,
      found: found.length, applied: applied.length, skipped: skipped.length,
      search_error: searchError, apply: applied, skip: skipped,
    });
  }

  try {
    await sb.from("assistant_actions").insert({
      user_id: null,
      action_kind: "email_scan",
      action_type: "fresto.email.guests_scan",
      entity_code: null,
      target_table: "eod_pos",
      payload: { channels_scanned: channels.length, per_channel: perChannel },
      reversible: false,
    });
  } catch {}

  return NextResponse.json({ ok: true, at: new Date().toISOString(), per_channel: perChannel });
}
