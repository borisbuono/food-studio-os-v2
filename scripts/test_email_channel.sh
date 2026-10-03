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
"$ROOT/node_modules/.bin/tsc" -p "$OUT/tsconfig.json"
node -e "
const M=require('module'),p=require('path');const o=M._resolveFilename;
M._resolveFilename=function(r,...a){if(r.startsWith('@/'))r=p.join('$OUT',r.slice(2));return o.call(this,r,...a)};
require('$OUT/tests/email-channel.test.js');"
