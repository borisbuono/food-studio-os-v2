// PWA #2 (2026-07-28) — server-side Whisper transcription.
//
// Web Speech API is unusable on iOS Safari: mic permission never persists,
// the engine cuts off on the first ~2s of silence, and there's no way to
// keep it hot for a longer dictation. On desktop Chrome it's great, so we
// keep it as the default there. On iOS (and any browser missing
// SpeechRecognition) we fall through to this: MediaRecorder → blob → POST
// to /api/assistant/voice/transcribe → OpenAI Whisper → text.
//
// Cost: whisper-1 is $0.006/minute of audio. Boris's voice notes run 5-30s.
// Even at 100 turns/day that's ~$0.30/day per operator — negligible relative
// to Anthropic chat cost. Every transcription is logged to assistant_actions
// so the same billing surface picks it up.

export type TranscribeResult = {
  ok: true;
  text: string;
  duration_seconds: number | null;
  cost_usd: number | null;
} | {
  ok: false;
  error: string;
};

const WHISPER_PRICE_PER_MIN_USD = 0.006;

// Whisper accepts wav, mp3, mp4, m4a, mpeg, mpga, webm, ogg, flac. The Chrome
// & Safari MediaRecorder default outputs (webm/opus on Chrome, mp4/aac on
// Safari) are both accepted.
export async function transcribeAudio(
  audioBuffer: ArrayBuffer,
  contentType: string,
  langHint?: "en" | "es" | "da",
): Promise<TranscribeResult> {
  const key = (process.env.OPENAI_API_KEY || process.env.openai);
  if (!key) return { ok: false, error: "OPENAI_API_KEY not set — voice transcription unavailable." };
  if (!audioBuffer || audioBuffer.byteLength < 400) {
    return { ok: false, error: "Audio clip too short to transcribe." };
  }
  if (audioBuffer.byteLength > 25 * 1024 * 1024) {
    // Whisper's per-request cap; MediaRecorder-webm at reasonable bitrates
    // gets us ~10 minutes for that budget, well past the 60s we allow.
    return { ok: false, error: "Audio clip too large (>25 MB) — trim it down." };
  }

  const ext = extForContentType(contentType);
  const fd = new FormData();
  fd.append("file", new Blob([audioBuffer], { type: contentType }), `clip.${ext}`);
  fd.append("model", "whisper-1");
  fd.append("response_format", "verbose_json");
  fd.append("temperature", "0");
  if (langHint) fd.append("language", langHint); // helps for short clips

  let r: Response;
  try {
    r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: fd,
    });
  } catch (e: any) {
    return { ok: false, error: "Whisper network error: " + (e?.message || "unknown") };
  }
  if (!r.ok) {
    let msg = `Whisper ${r.status}`;
    try { const j: any = await r.json(); if (j?.error?.message) msg += ` — ${j.error.message}`; } catch {}
    return { ok: false, error: msg };
  }
  let data: any;
  try { data = await r.json(); } catch { return { ok: false, error: "Whisper returned a non-JSON body." }; }

  const text = typeof data?.text === "string" ? data.text.trim() : "";
  if (!text) return { ok: false, error: "Whisper returned no transcript." };
  const duration = typeof data?.duration === "number" ? data.duration : null;
  const cost = duration != null ? (duration / 60) * WHISPER_PRICE_PER_MIN_USD : null;
  return { ok: true, text, duration_seconds: duration, cost_usd: cost };
}

// Best guess for the file extension Whisper wants to see. It sniffs by
// content but the filename tips the balance for some codecs (Safari's
// audio/mp4 needs an .m4a extension to be recognised).
function extForContentType(ct: string): string {
  const c = (ct || "").toLowerCase();
  if (c.includes("webm")) return "webm";
  if (c.includes("ogg"))  return "ogg";
  if (c.includes("wav"))  return "wav";
  if (c.includes("mpeg") || c.includes("mp3")) return "mp3";
  if (c.includes("mp4") || c.includes("aac") || c.includes("m4a")) return "m4a";
  if (c.includes("flac")) return "flac";
  return "webm";
}
