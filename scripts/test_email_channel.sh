#!/usr/bin/env sh
# Compiles + runs the email-channel pure tests (no Gmail token needed).
#   sh scripts/test_email_channel.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TMPDIR:-/tmp}/fs-email-channel"
rm -rf "$OUT"; mkdir -p "$OUT"
cat > "$OUT/tsconfig.json" <<JSON
{ "compilerOptions": { "outDir": "$OUT", "rootDir": "$ROOT", "module": "commonjs", "target": "es2020", "moduleResolution": "node",
    "skipLibCheck": true, "esModuleInterop": true, "baseUrl": "$ROOT", "paths": { "@/*": ["./*"] }, "types": ["node"], "typeRoots": ["$ROOT/node_modules/@types"] },
  "files": ["$ROOT/tests/email-channel.test.ts"] }
JSON
# E4: the edge function email-reply carries a byte-identical copy of lib/chef/canonical.ts
cmp -s "$ROOT/lib/chef/canonical.ts" "$ROOT/supabase/functions/email-reply/canonical.ts" || { echo "FAIL  canonical.ts copies differ (lib/chef vs supabase/functions/email-reply)"; exit 1; }
echo "PASS  canonical.ts identical in lib/chef and supabase/functions/email-reply"
# 2026-10-03: the Google client is per entity. The pure half (row-vs-env pick, hd, client_changed) runs
# below; the RLS half (stranger 0 rows on oauth_clients, secret never selectable, RPCs refused) is
# scripts/probes/oauth_clients_probe.sql — run on prod inside begin/rollback. With SUPABASE_DB_URL set
# and psql on the PATH it runs here; otherwise it is SKIPped (the release gate pastes the result).
if [ -n "${SUPABASE_DB_URL:-}" ] && command -v psql >/dev/null 2>&1; then
  P="$(psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -At -f "$ROOT/scripts/probes/oauth_clients_probe.sql" 2>&1)" || { echo "FAIL  oauth_clients probe errored"; echo "$P"; exit 1; }
  echo "$P" | grep -q "ALLOWED (BAD)" && { echo "FAIL  oauth_clients probe: something a stranger/authenticated user should not reach was ALLOWED"; echo "$P"; exit 1; }
  echo "$P" | grep -q "stranger select oauth_clients|0" || { echo "FAIL  oauth_clients probe: stranger saw rows"; echo "$P"; exit 1; }
  echo "PASS  oauth_clients RLS probe (rolled back on prod): stranger 0 rows, secret + RPCs refused"
else
  echo "SKIP  oauth_clients RLS probe (set SUPABASE_DB_URL + psql to run scripts/probes/oauth_clients_probe.sql here)"
fi
"$ROOT/node_modules/.bin/tsc" -p "$OUT/tsconfig.json"
node -e "
const M=require('module'),p=require('path');const o=M._resolveFilename;
M._resolveFilename=function(r,...a){if(r.startsWith('@/'))r=p.join('$OUT',r.slice(2));return o.call(this,r,...a)};
require('$OUT/tests/email-channel.test.js');"
