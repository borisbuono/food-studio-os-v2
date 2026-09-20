import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/check-urls  { post_id }
//
// Pre-flight for a post's media_urls before Meta ever tries to fetch them.
// HEAD each URL with a 5s timeout, cache the {url → ok/status} for 60s so a
// tab full of cards doesn't hammer the origin. Returns per-URL status so the
// calendar can render a warning triangle on any card with a bad URL.

type UrlHealth = {
  url: string;
  ok: boolean;
  status: number | null;
  content_type: string | null;
  error?: string;
};

// In-memory 60s cache. Keyed by URL — same URL used on two posts checks once.
type CacheEntry = { at: number; result: UrlHealth };
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;
const HEAD_TIMEOUT_MS = 5_000;

async function checkOne(url: string): Promise<UrlHealth> {
  const now = Date.now();
  const cached = CACHE.get(url);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.result;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HEAD_TIMEOUT_MS);
  let result: UrlHealth;
  try {
    const res = await fetch(url, { method: "HEAD", signal: ctrl.signal, redirect: "follow" });
    result = {
      url,
      ok: res.ok,
      status: res.status,
      content_type: res.headers.get("content-type"),
    };
  } catch (e: any) {
    result = {
      url,
      ok: false,
      status: null,
      content_type: null,
      error: e?.name === "AbortError" ? "timeout" : (e?.message || "fetch_failed"),
    };
  } finally {
    clearTimeout(timer);
  }
  CACHE.set(url, { at: now, result });
  return result;
}

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) {
    return NextResponse.json({ ok: false, error: "auth" }, { status: 401 });
  }

  let body: { post_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }
  const post_id = String(body?.post_id || "").trim();
  if (!post_id) {
    return NextResponse.json({ ok: false, error: "post_id required" }, { status: 400 });
  }

  const { data: row, error: rErr } = await sb
    .from("social_posts")
    .select("id, media_urls")
    .eq("id", post_id)
    .single();
  if (rErr || !row) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const urls: string[] = Array.isArray(row.media_urls) ? row.media_urls : [];
  const checks = await Promise.all(urls.map(checkOne));
  return NextResponse.json({
    ok: true,
    post_id,
    all_ok: checks.every((c) => c.ok),
    urls: checks,
  });
}
