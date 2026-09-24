import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

// Chef v3 — POST /api/chef/say { text, lang } → audio/mpeg
//
// Speaks the ≤ 12-word `say` line back to the chef. Deepgram Aura-2 when the
// key is there (same key as STT — one account, one swap), otherwise OpenAI
// gpt-4o-mini-tts, otherwise 204 and the client stays silent. Never an
// error the UI has to render: a kitchen that can't hear still gets the card.

const MAX_CHARS = 480; // Phase 2: a read-back carries the whole draft reply

const AURA_VOICE: Record<"es" | "en", string> = {
  en: "aura-2-thalia-en",
  es: "aura-2-celeste-es",
};

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const text = String(body?.text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
  const lang: "es" | "en" = body?.lang === "es" ? "es" : "en";
  if (!text) return new NextResponse(null, { status: 204 });

  const dgKey = process.env.DEEPGRAM_API_KEY;
  const oaKey = process.env.OPENAI_API_KEY || process.env.openai;

  try {
    if (dgKey) {
      const r = await fetch(`https://api.deepgram.com/v1/speak?model=${AURA_VOICE[lang]}&encoding=mp3`, {
        method: "POST",
        headers: { Authorization: `Token ${dgKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        cache: "no-store",
      });
      if (r.ok && r.body) return streamMp3(r.body);
      // Aura failed → try OpenAI below rather than go mute.
    }
    if (oaKey) {
      const r = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: { Authorization: `Bearer ${oaKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          voice: "alloy",
          input: text,
          response_format: "mp3",
          instructions: "Kitchen assistant. Brisk, clear, Spanish or English as written.",
        }),
        cache: "no-store",
      });
      if (r.ok && r.body) return streamMp3(r.body);
    }
  } catch {}
  return new NextResponse(null, { status: 204 });
}

function streamMp3(body: ReadableStream<Uint8Array>): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
