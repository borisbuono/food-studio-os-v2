import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { transcribeAudio } from "@/lib/assistant/voice/whisper";
import { EntityCode } from "@/lib/assistant/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The default 4.5MB body cap is too small for even a 30s webm/opus clip; the
// underlying Whisper cap is 25MB so mirror it here.
export const maxDuration = 60;

// PWA #2 (2026-07-28) — the endpoint the AssistantFab hits when Web Speech
// isn't available (iOS Safari, Firefox, PWA mode). Accepts a multipart audio
// blob + language hint, forwards to OpenAI Whisper, returns the text and
// logs cost to assistant_actions so billing metering picks it up.
//
// This does NOT invoke the assistant orchestrator — transcription is
// deliberately separate from generation. The FAB pipes the transcript back
// through /api/ask as if the user had typed it.

const VALID_ENTITY: Record<string, EntityCode> = { IFL: "IFL", BM: "BM", BBH: "BBH" };

export async function POST(req: NextRequest) {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json({ ok: false, error: "Send audio as multipart/form-data" }, { status: 400 });
  }

  let form: FormData;
  try { form = await req.formData(); }
  catch (e: any) { return NextResponse.json({ ok: false, error: "bad body: " + (e?.message || "unknown") }, { status: 400 }); }

  const file = form.get("audio") as File | null;
  const langRaw = (form.get("lang") as string | null) || "en";
  // FAB voice #3 — accept da alongside en/es. Whisper handles many more
  // languages; we only expose the ones the UI actually offers.
  const lang: "en" | "es" | "da" = langRaw === "es" ? "es" : langRaw === "da" ? "da" : "en";
  const entityRaw = (form.get("entity") as string | null) || "IFL";
  const entity: EntityCode = VALID_ENTITY[entityRaw] || "IFL";
  const route = (form.get("route") as string | null) || null;
  // FAB voice #3 — streaming interim uploads (every ~3s during recording).
  // We still transcribe them but skip the assistant_actions log write so we
  // don't spam the billing table. The final blob on release DOES get logged.
  const interim = ((form.get("interim") as string | null) || "").toLowerCase() === "true";

  if (!file || typeof file.arrayBuffer !== "function") {
    return NextResponse.json({ ok: false, error: "No audio file in the request." }, { status: 400 });
  }

  const buf = await file.arrayBuffer();
  const contentType = file.type || "audio/webm";
  const t0 = Date.now();
  const out = await transcribeAudio(buf, contentType, lang);
  const latency_ms = Date.now() - t0;

  // Fire-and-forget log (do not block the response). We swallow log errors —
  // if Supabase is briefly down the transcript still comes back.
  // Interim chunk uploads bypass the log — see FAB voice #3 comment above.
  if (!interim) try {
    const sb = supabaseServer();
    const { data: u } = await sb.auth.getUser();
    const uid = u.user?.id || null;
    const costEur = out.ok && out.cost_usd != null ? Number((out.cost_usd * 0.92).toFixed(6)) : 0;
    sb.from("assistant_actions").insert({
      user_id: uid,
      action_type: "generate",
      action_kind: "voice_transcribe",
      entity_code: entity,
      target_table: route,
      cost_eur: costEur,
      latency_ms,
      model: "whisper-1",
      input_tokens: null,
      output_tokens: null,
      payload: {
        engine: "openai_whisper",
        lang,
        duration_seconds: out.ok ? out.duration_seconds : null,
        bytes: buf.byteLength,
        content_type: contentType,
        ok: out.ok,
        error: out.ok ? null : out.error,
      },
      reversible: false,
    }).then(() => {}, () => {});
  } catch {}

  if (!out.ok) return NextResponse.json({ ok: false, error: out.error }, { status: 502 });
  return NextResponse.json({
    ok: true,
    text: out.text,
    duration_seconds: out.duration_seconds,
    cost_usd: out.cost_usd,
    engine: "openai_whisper",
    latency_ms,
  });
}
