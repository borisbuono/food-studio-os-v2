#!/usr/bin/env sh
# Security S7a — the anonymous RPC probe. Read-only. Run it against prod with
# nothing but the publishable anon key, before and after any change to the
# SECURITY DEFINER surface.
#
#   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... sh scripts/probes/anon_rpc_probe.sh
#
# It does NOT call the four unauthenticated write functions with real arguments.
# fn_recost_menu is probed because a 401 proves the gate without doing anything;
# if it ever answers 200 here, stop and revoke it again.
#
# Expected after S7a: every line under CLOSED is 401 (permission denied) or 404,
# and every line under PUBLIC is 200. A 200 under CLOSED is a regression.
set -e
B="${NEXT_PUBLIC_SUPABASE_URL:?set NEXT_PUBLIC_SUPABASE_URL}"
K="${NEXT_PUBLIC_SUPABASE_ANON_KEY:?set NEXT_PUBLIC_SUPABASE_ANON_KEY}"
BM=$(curl -sS "$B/rest/v1/restaurants?select=entity_id&limit=1" -H "apikey: $K" \
     | sed -E 's/.*"entity_id":"([^"]+)".*/\1/')
echo "entity under test: ${BM:-<none: restaurants may no longer be anon-readable, which is an improvement>}"
probe() { printf '%-32s ' "$2"; curl -sS -o /tmp/arp.json -w "%{http_code}" -X POST "$B/rest/v1/rpc/$2" \
  -H "apikey: $K" -H "content-type: application/json" -d "$3"; printf '  %s\n' "$(head -c 90 /tmp/arp.json)"; }
echo "--- CLOSED (expect 401/404) ---"
probe c fn_spend_per_cover "{\"p_entity\":\"$BM\"}"
probe c fn_rota_settings   "{\"p_entity\":\"$BM\"}"
probe c fn_person_rate     "{\"p_entity\":\"$BM\",\"p_person\":\"00000000-0000-0000-0000-000000000000\",\"p_date\":\"2026-01-01\"}"
probe c fn_recost_menu     "{\"p_entity\":\"$BM\"}"
probe c social_inbox_request_draft '{}'
echo "--- PUBLIC (expect 200) ---"
probe p apply_page_info    '{"p_slug":"bm"}'
probe p booking_page_info  '{"p_slug":"bistrot-mondo"}'
probe p booking_busy       '{"p_slug":"bistrot-mondo","p_from":"2026-01-01T00:00:00Z","p_to":"2026-01-02T00:00:00Z"}'
probe p public_recipe_by_slug '{"p_slug":"nonexistent-slug-probe"}'
probe p fn_apply_can_upload '{"p_name":"cv.pdf"}'
