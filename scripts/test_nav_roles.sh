#!/usr/bin/env sh
# Compiles the pure nav/access tests with the "@/..." alias and runs them.
#   sh scripts/test_nav_roles.sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${TMPDIR:-/tmp}/fs-nav-roles"
rm -rf "$OUT"; mkdir -p "$OUT"
cat > "$OUT/tsconfig.json" <<JSON
{ "compilerOptions": { "outDir": "$OUT", "rootDir": "$ROOT", "module": "commonjs", "target": "es2020", "moduleResolution": "node",
    "skipLibCheck": true, "esModuleInterop": true, "baseUrl": "$ROOT", "paths": { "@/*": ["./*"] }, "types": ["node"], "typeRoots": ["$ROOT/node_modules/@types"] },
  "files": ["$ROOT/tests/nav-roles.test.ts", "$ROOT/tests/chrome-polish.test.ts"] }
JSON
"$ROOT/node_modules/.bin/tsc" -p "$OUT/tsconfig.json"
node -e "
const M=require('module'),p=require('path');const o=M._resolveFilename;
M._resolveFilename=function(r,...a){if(r.startsWith('@/'))r=p.join('$OUT',r.slice(2));return o.call(this,r,...a)};
require('$OUT/tests/chrome-polish.test.js'); require('$OUT/tests/nav-roles.test.js');"
