#!/usr/bin/env sh
# Security S4: fails when an interactive route imports a service-role client
# (directly or through a lib) without a membership / secret gate.
#   sh scripts/test_service_role_gate.sh
# Step 1 proves the lint still bites: a throwaway ungated route must FAIL it.
# Step 2 runs it for real on the tree.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIX="$ROOT/app/api/_lint_selftest_ungated"
cleanup() { rm -rf "$FIX"; }
trap cleanup EXIT INT TERM
mkdir -p "$FIX"
cat > "$FIX/route.ts" <<'TS'
import { supabaseJob } from "@/lib/supabaseJob";
export async function POST() { const sb = supabaseJob(); await sb.from("x").select("id"); return Response.json({ ok: true }); }
TS
if node "$ROOT/scripts/check_service_role_gate.mjs" >/dev/null 2>&1; then
  echo "FAIL  self-test: an ungated route passed the lint"; exit 1
fi
echo "PASS  self-test: ungated fixture route is refused"
cleanup
node "$ROOT/scripts/check_service_role_gate.mjs"
