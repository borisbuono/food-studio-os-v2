import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Chef v3 — GET /api/chef/voice-token
//
// Tells the client which voice backend to use and, when Deepgram is
// configured, hands it a short-lived key for the browser → Deepgram socket.
// No DEEPGRAM_API_KEY → { ok:false, backend:"whisper" } and the client stays
// on the existing Whisper path. Adding the key later is the whole swap.
//
// Env:
//   DEEPGRAM_API_KEY       master key (never sent to the browser unless …)
//   DEEPGRAM_PROJECT_ID    needed to mint 120 s keys via the Deepgram API
//   DEEPGRAM_ALLOW_RAW_KEY "1" → send the master key when PROJECT_ID is unset
//                          (dev only; a raw key in the browser is a leak)

const KEY_TTL_S = 120;

export async function GET() {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return NextResponse.json({ ok: false, backend: "whisper" });

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return NextResponse.json({ ok: false, error: "not authenticated" }, { status: 401 });

  const project = process.env.DEEPGRAM_PROJECT_ID;
  if (!project) {
    if (process.env.DEEPGRAM_ALLOW_RAW_KEY === "1") {
      return NextResponse.json({ ok: true, backend: "deepgram", token: key, ttl_seconds: 3600, raw: true }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ ok: false, backend: "whisper", reason: "needs DEEPGRAM_PROJECT_ID" });
  }

  try {
    const r = await fetch(`https://api.deepgram.com/v1/projects/${encodeURIComponent(project)}/keys`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ comment: "chef-ptt", scopes: ["usage:write"], time_to_live_in_seconds: KEY_TTL_S }),
      cache: "no-store",
    });
    const d: any = await r.json().catch(() => ({}));
    const token = typeof d?.key === "string" ? d.key : null;
    if (!r.ok || !token) {
      const reason = d?.err_msg || d?.message || `deepgram ${r.status}`;
      // Whisper still works; say so rather than break the tap.
      return NextResponse.json({ ok: false, backend: "whisper", reason }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(
      { ok: true, backend: "deepgram", token, ttl_seconds: KEY_TTL_S },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, backend: "whisper", reason: "deepgram network: " + (e?.message || "unknown") });
  }
}
