// POST /api/leads/[id]/touch
//
// Auth-gated. Logs an operator touch on a lead (an outbound email, an
// inbound WhatsApp reply, a phone call, an in-person conversation).
// Body: { channel, direction, notes }.

import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_CHANNELS = new Set(["email", "whatsapp", "call", "in-person", "system"]);
const ALLOWED_DIRECTIONS = new Set(["outbound", "inbound", "internal"]);

export async function POST(
  req: Request,
  ctx: { params: { id: string } },
) {
  const sb = supabaseServer();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  const uid = userRes.user.id;
  const leadId = ctx.params.id;
  if (!leadId || !/^[0-9a-f-]{36}$/i.test(leadId)) {
    return Response.json({ ok: false, error: "bad lead id" }, { status: 400 });
  }

  let body: { channel?: string; direction?: string; notes?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }

  const channel = String(body.channel || "").toLowerCase();
  const direction = String(body.direction || "").toLowerCase();
  if (!ALLOWED_CHANNELS.has(channel)) return Response.json({ ok: false, error: "bad channel" }, { status: 400 });
  if (!ALLOWED_DIRECTIONS.has(direction)) return Response.json({ ok: false, error: "bad direction" }, { status: 400 });
  const notes = body.notes ? String(body.notes).slice(0, 4000) : null;

  // Confirm the lead exists (so we don't silently write orphans).
  const { data: existing, error: readErr } = await sb
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .maybeSingle();
  if (readErr) return Response.json({ ok: false, error: readErr.message }, { status: 500 });
  if (!existing) return Response.json({ ok: false, error: "not found" }, { status: 404 });

  const { data: inserted, error: insErr } = await sb
    .from("lead_touches")
    .insert({
      lead_id: leadId,
      channel,
      direction,
      notes,
      by_user: uid,
    })
    .select("id, touched_at")
    .single();
  if (insErr) return Response.json({ ok: false, error: insErr.message }, { status: 500 });

  return Response.json({ ok: true, id: (inserted as any).id, touched_at: (inserted as any).touched_at });
}
