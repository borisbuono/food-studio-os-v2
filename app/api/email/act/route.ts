import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseService } from "@/lib/supabaseService";
import { draftThread } from "@/lib/email/draft";
import { recategorise, CATEGORIES, type Category } from "@/lib/email/classify";
import { observe } from "@/lib/observations";
import { requireManagerOf } from "@/lib/access/requireManager";
import { mintAndConsumePageTick } from "@/lib/chef/confirm";
import { approveEmailAction, sendEmailReply } from "@/lib/email/reply";
import { advanceLead } from "@/lib/email/funnel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/email/act — the taps on an email card.
//
//   { action: "skip",         id }
//   { action: "restore",      id }                      un-skip
//   { action: "redraft",      id }                      Haiku again (also for 'other', on request)
//   { action: "recategorise", id, category }            "wrong pile" → re-route + observe()
//   { action: "outcome",      id, outcome }             won | lost | no_answer | not_sales → observe()
//   { action: "note",         id, note }                E6 — the one line on the sender (clients.notes; "" clears). The drafter reads it next time.
//   { action: "approve",      id, text, dry_run? }      E4 — the tick. Mints + consumes a page_tick
//                                                        confirm token for {approve_email, thread, text},
//                                                        then the edge function email-reply re-checks that
//                                                        consumed token and sends as the mailbox. Nothing
//                                                        in this route writes approved_by_boris or sends.
//
// Auth: the signed-in user. Every row write goes through the cookie-bound
// client first (RLS: managed-entity members), the service path only after
// that proved membership.
export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  let p: any;
  try { p = await req.json(); } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }
  const action = String(p.action || ""), id = String(p.id || "");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  // RLS-visible (member) AND a manager of that house — before any service work.
  const { data: row } = await sb.from("email_threads").select("id, status, entity_id, account_id, draft_reply, category, flagged, from_name, from_address").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const r = row as any;
  const gate = await requireManagerOf(sb, r.entity_id);
  if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });

  if (action === "skip" || action === "restore") {
    const status = action === "skip" ? "skipped" : (r.draft_reply ? "drafted" : "classified");
    const { error } = await sb.from("email_threads").update({ status }).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
    return NextResponse.json({ ok: true, status });
  }

  const svc = supabaseService();
  if (!svc) return NextResponse.json({ ok: false, error: "no service key" }, { status: 503 });

  if (action === "redraft") {
    if (!["classified", "drafted", "skipped", "failed"].includes(r.status) && !r.flagged) return NextResponse.json({ ok: false, error: `status ${r.status}` }, { status: 409 });
    await sb.from("email_threads").update({ status: "classified", flagged: false, flag_reason: null }).eq("id", id);
    const d = await draftThread(svc, id, { force: true });
    return NextResponse.json(d, { status: d.ok ? 200 : 422 });
  }

  if (action === "recategorise") {
    const category = String(p.category || "") as Category;
    if (!CATEGORIES.includes(category)) return NextResponse.json({ ok: false, error: "unknown category" }, { status: 400 });
    const res = await recategorise(svc, id, category, u.user.id);
    return NextResponse.json(res, { status: res.ok ? 200 : 422 });
  }

  if (action === "outcome") {
    const outcome = String(p.outcome || "");
    if (!["won", "lost", "no_answer", "not_sales"].includes(outcome)) return NextResponse.json({ ok: false, error: "unknown outcome" }, { status: 400 });
    const { error } = await sb.from("email_threads").update({ outcome }).eq("id", id);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 403 });
    // every enquiry outcome is an observation (brief: Observe)
    try { await observe(svc, { entity_id: r.entity_id, source: "email_channel", domain: "comms", body: `Enquiry outcome: ${outcome} (thread ${id.slice(0, 8)}, category ${r.category || "?"})` }); } catch { /* best-effort */ }
    // E5: the funnel row follows the outcome
    try { await advanceLead(svc, id, outcome as any); } catch { /* optional */ }
    return NextResponse.json({ ok: true, outcome });
  }

  if (action === "note") {
    // E6: one line on the counterparty. Through the caller's RLS client — a
    // manager of this house writes a clients row for this house; nothing else.
    const note = String(p.note ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    const address = String(r.from_address || "").toLowerCase();
    if (!address) return NextResponse.json({ ok: false, error: "no sender address on thread" }, { status: 422 });
    const { data: existing } = await sb.from("clients").select("id").eq("entity_id", r.entity_id).ilike("email", address).maybeSingle();
    const w = existing?.id
      ? await sb.from("clients").update({ notes: note || null, name: r.from_name || undefined }).eq("id", existing.id).select("id").maybeSingle()
      : await sb.from("clients").insert({ entity_id: r.entity_id, email: address, name: r.from_name || null, kind: r.category === "enquiry" ? "guest" : "other", notes: note || null, created_by: u.user.id }).select("id").maybeSingle();
    if (w.error) return NextResponse.json({ ok: false, error: w.error.message }, { status: 403 });
    return NextResponse.json({ ok: true, note: note || null, client_id: (w.data as any)?.id ?? null });
  }

  if (action === "approve") {
    // The tick. One code path with Chef: a confirm token is minted AND consumed
    // here (page_tick) for exactly {approve_email, this thread, this text}; the
    // edge function refuses anything else with 403.
    const text = String(p.text ?? r.draft_reply ?? "").trim();
    if (!text) return NextResponse.json({ ok: false, error: "empty reply" }, { status: 422 });
    if (r.status === "replied") return NextResponse.json({ ok: false, error: "already replied", status: "replied" }, { status: 409 });
    // flagged threads have no draft; the text is what Boris typed in the box — his tick, his words.
    if (!["classified", "drafted", "approved", "failed", "skipped", "flagged"].includes(r.status)) return NextResponse.json({ ok: false, error: `status ${r.status}` }, { status: 409 });
    const act = approveEmailAction(String(r.entity_id), id, text, r.from_name || r.from_address || null);
    const token = await mintAndConsumePageTick(sb, u.user.id, act);
    if (!token) return NextResponse.json({ ok: false, error: "could not confirm (token)", status: r.status }, { status: 403 });
    const res = await sendEmailReply(svc, { threadId: id, accountId: String(r.account_id), text, uid: u.user.id, confirmToken: token, action: act, via: "page_tick", dryRun: p.dry_run === true });
    if (res.dry_run) return NextResponse.json({ ok: res.ok, dry_run: true, would_send: res.would_send, error: res.error, reason: res.reason }, { status: res.ok ? 200 : res.http });
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error, status: "failed", reason: res.reason }, { status: res.http });
    return NextResponse.json({ ok: true, status: "replied", gmail_message_id: res.gmail_message_id, hours_to_answer: res.hours_to_answer });
  }
  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
