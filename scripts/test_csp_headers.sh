#!/usr/bin/env sh
# Security S5(a): asserts the security headers this app actually emits.
#   sh scripts/test_csp_headers.sh
#
# Phase 1 (always) reads the policy out of next.config.mjs and checks the
# invariants that make the policy worth having at all.
# Phase 2 (only when .next exists) boots the built app and asserts the headers
# as a browser would receive them — because a path-to-regexp source that looks
# right and matches nothing is the failure mode this guards.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail() { echo "FAIL  $1"; exit 1; }

# ---------------------------------------------------------------- phase 1
node --input-type=module -e "
import cfg from './next.config.mjs';
const rules = await cfg.headers();
const csp = (r) => r.headers.filter((h) => h.key === 'Content-Security-Policy');
const ro  = (r) => r.headers.filter((h) => h.key === 'Content-Security-Policy-Report-Only');
let n = 0;
const ok = (c, m) => { if (!c) { console.error('FAIL  ' + m); process.exit(1); } n++; };

for (const r of rules) {
  ok(csp(r).length === 1, 'exactly one Content-Security-Policy per rule: ' + r.source);
  ok(ro(r).length === 1, 'exactly one Report-Only per rule: ' + r.source);
  const p = csp(r)[0].value;
  // The three ways a stolen session token could leave the browser.
  ok(/connect-src 'self' https:\/\/[^ ;]*supabase\.co wss:\/\/[^ ;]*supabase\.co/.test(p), 'connect-src is self + Supabase only: ' + r.source);
  ok(/form-action 'self'/.test(p), \"form-action 'self': \" + r.source);
  ok(/img-src 'self' data: blob: https:\/\/[^ ;]*supabase\.co/.test(p), 'img-src has no third-party host: ' + r.source);
  // Cheap, cannot break anything, closes whole classes.
  ok(/object-src 'none'/.test(p), \"object-src 'none': \" + r.source);
  ok(/base-uri 'self'/.test(p), \"base-uri 'self': \" + r.source);
  ok(/frame-src 'none'/.test(p), \"frame-src 'none': \" + r.source);
  ok(p.includes('report-uri /api/csp-report'), 'reports have somewhere to go: ' + r.source);
  // The Report-Only twin must be STRICTLY tighter, or it teaches us nothing.
  const q = ro(r)[0].value;
  ok(!/script-src [^;]*'unsafe-inline'/.test(q), 'Report-Only drops unsafe-inline from script-src: ' + r.source);
  ok(/script-src [^;]*'unsafe-inline'/.test(p), 'enforced policy keeps unsafe-inline (Next 14 has no nonce yet): ' + r.source);
}

// Guest-facing pages stay frameable; the app and sign-in pages do not.
const guest = rules.filter((r) => r.source.includes(':guest'));
const app = rules.filter((r) => !r.source.includes(':guest'));
ok(guest.length === 2, 'two guest rules (prefix and bare)');
ok(app.length === 1, 'one app rule');
for (const r of guest) ok(!csp(r)[0].value.includes('frame-ancestors'), 'guest pages are frameable: ' + r.source);
ok(csp(app[0])[0].value.includes(\"frame-ancestors 'none'\"), 'app pages are not frameable');
console.log('PASS  phase 1 — ' + n + ' policy assertions');
"

# ---------------------------------------------------------------- phase 2
if [ ! -d "$ROOT/.next" ]; then
  echo "SKIP  phase 2 — no .next build present (run npm run build first)"
  exit 0
fi

PORT=${CSP_TEST_PORT:-3517}
HDR="${TMPDIR:-/tmp}/fs-csp-headers"
rm -rf "$HDR"; mkdir -p "$HDR"
"$ROOT/node_modules/.bin/next" start -p "$PORT" >"$HDR/server.log" 2>&1 &
SRV=$!
cleanup() { kill "$SRV" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

i=0
until curl -sS -o /dev/null "http://127.0.0.1:$PORT/robots.txt" 2>/dev/null; do
  i=$((i+1)); [ "$i" -gt 60 ] && { cat "$HDR/server.log"; fail "server did not start"; }
  sleep 1
done

check() { # path, expect-frame-ancestors (yes|no)
  curl -sS -D "$HDR/h" -o /dev/null "http://127.0.0.1:$PORT$1"
  COUNT=$(grep -ci '^content-security-policy:' "$HDR/h" || true)
  [ "$COUNT" = "1" ] || fail "$1 returned $COUNT enforced CSP headers, expected exactly 1"
  grep -qi '^content-security-policy-report-only:' "$HDR/h" || fail "$1 has no Report-Only header"
  grep -qi '^x-content-type-options: nosniff' "$HDR/h" || fail "$1 missing nosniff"
  # HSTS is deliberately NOT set by the app — Vercel sends it at the edge and
  # ours would be the weaker of the two. See the note in next.config.mjs.
  if grep -qi '^strict-transport-security:' "$HDR/h"; then fail "$1 sets HSTS in the app; Vercel already does at the edge, and ours would be the weaker of the two"; fi
  grep -qi '^referrer-policy: strict-origin-when-cross-origin' "$HDR/h" || fail "$1 missing Referrer-Policy"
  grep -qi '^permissions-policy:' "$HDR/h" || fail "$1 missing Permissions-Policy"
  if grep -i '^content-security-policy:' "$HDR/h" | grep -q "frame-ancestors"; then HAS=yes; else HAS=no; fi
  [ "$HAS" = "$2" ] || fail "$1 frame-ancestors=$HAS, expected $2"
  echo "PASS  $1 — 1 CSP, report-only present, frame-ancestors=$HAS"
}

check "/login" yes
check "/welcome" yes
check "/studio" yes
check "/robots.txt" yes
check "/m/bistrot-mondo/proposal" no
check "/apply/bm" no
check "/legal/privacy" no
check "/book/anything" no

# The sink must swallow a report without a session and answer 204.
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/csp-report' \
  --data '{"csp-report":{"document-uri":"https://www.foodstudio.ai/studio","violated-directive":"script-src","blocked-uri":"inline"}}' \
  "http://127.0.0.1:$PORT/api/csp-report")
[ "$CODE" = "204" ] || fail "/api/csp-report answered $CODE, expected 204 (is it in the middleware allow-list?)"
echo "PASS  /api/csp-report accepts an anonymous report → 204"
echo "PASS  phase 2 — emitted headers match the policy"
