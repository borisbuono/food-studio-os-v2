import { NextResponse, type NextRequest } from "next/server";

// -----------------------------------------------------------------------------
// CSP violation sink — S5(a), 2026-10-03
// -----------------------------------------------------------------------------
// The Report-Only twin of our policy (lib/security/csp.mjs) is the same policy
// with 'unsafe-inline' removed. Its reports land here and tell us exactly which
// inline scripts and styles a nonce would have to cover — the evidence for the
// nonce pass, instead of a guess.
//
// Deliberately NOT a table. These are debug telemetry, not state: nothing acts
// on an individual report, no screen reads them, and a public endpoint that
// writes rows is a free way for anyone to fill the database. They go to the
// Vercel runtime log, where a build session reads them with
// `get_runtime_logs` and promotes the pattern — the same shape as the
// observation log: cheap to write, read only at synthesis.
//
// Public by necessity (the browser posts without our cookie) — so it accepts
// nothing, stores nothing, and returns 204 whatever happens.
// -----------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 16 * 1024;

type Report = {
  "blocked-uri"?: string;
  "violated-directive"?: string;
  "effective-directive"?: string;
  "document-uri"?: string;
  disposition?: string;
  blockedURL?: string;
  effectiveDirective?: string;
  documentURL?: string;
};

function summarise(r: Report): string {
  const directive = r["effective-directive"] || r["violated-directive"] || r.effectiveDirective || "?";
  const blocked = r["blocked-uri"] || r.blockedURL || "?";
  const doc = r["document-uri"] || r.documentURL || "?";
  const mode = r.disposition === "enforce" ? "ENFORCED" : "report-only";
  return `[csp] ${mode} ${directive} blocked=${blocked} on=${doc}`;
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    if (!raw || raw.length > MAX_BODY) return new NextResponse(null, { status: 204 });
    const parsed = JSON.parse(raw);

    // Two wire formats: the legacy `report-uri` shape ({"csp-report": {...}})
    // and the Reporting API `report-to` shape (an array of {type, body}).
    const reports: Report[] = Array.isArray(parsed)
      ? parsed.filter((e) => e?.type === "csp-violation" || e?.body).map((e) => e.body ?? e)
      : parsed["csp-report"]
        ? [parsed["csp-report"]]
        : [parsed];

    // One line each, capped — a loop on a broken page can report hundreds.
    for (const r of reports.slice(0, 10)) console.warn(summarise(r));
  } catch {
    // A malformed report is not an error worth surfacing.
  }
  return new NextResponse(null, { status: 204 });
}

// Anything other than a POST is noise.
export async function GET() {
  return new NextResponse(null, { status: 405 });
}
