#!/usr/bin/env node
// Security S4 (2026-10-02) — the service-role gate lint.
//
// RLS is the backstop for every request-bound Supabase client. It is NOT the
// backstop once a route holds a service-role client (supabaseJob(),
// supabaseService(), cronDb(), guestServiceClient) or calls a library that
// does. So every route that reaches one of those must prove who is calling
// first, in a grep-able way:
//
//   /api/cron/**          → cronAuthorized(req)                         (Bearer CRON_SECRET, fails closed)
//   **/webhook/**         → an HMAC check (timingSafeEqual / verify…)   (signed by the sender)
//   /api/guest/**, /api/leads/** → public-form lane: signed token or rate limit (lib/guest, lib/leads)
//   everything else       → one of lib/access/requireManager.ts gates:
//                           requireEntityAccess / requireManagerOf / requireManagerOfAll /
//                           requirePlatformOwner / requireAnyMembership
//                           or an explicit secret lane: cronAuthorized(req) or a Vault RPC (*_secret_ok)
//
// Any route that imports a service path and has none of the above FAILS this
// script (exit 1). Run: node scripts/check_service_role_gate.mjs
// Wired into scripts/test_service_role_gate.sh; the release gate (docs/systems/release.md) requires it.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not new URL(...).pathname: a percent-encoded path is not a
// filesystem path. Boris's working copy lives under "Food Studio os", so the
// raw pathname arrives as ".../Food%20Studio%20os/..." and every readdirSync
// in this file threw ENOENT — `npm run build` could not run there at all.
// Found 2026-10-03; scripts/verify_nav.mjs had it right already.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "app");
const LIB = join(ROOT, "lib");

const SERVICE_MODULES = new Set([
  "lib/supabaseJob", "lib/supabaseService", "lib/guest/serviceClient",
]);
const SERVICE_SYMBOLS = /\b(supabaseJob|supabaseService|cronDb|guestServiceClient)\s*\(|SUPABASE_SERVICE_ROLE_KEY|\bguestServiceClient\b/;

const GATES = {
  interactive: /\b(requireEntityAccess|requireManagerOf|requireManagerOfAll|requirePlatformOwner|requireAnyMembership)\s*\(|\bcronAuthorized\s*\(|_secret_ok\b/,
  cron: /\bcronAuthorized\s*\(/,
  webhook: /\b(timingSafeEqual|verifySignature|verifyFrestoSignature|verifyMetaSignature|verifyHmac)\b|X-Hub-Signature|x-hub-signature/,
  guest: /\b(verifyGuestToken|readGuestToken|isRateLimited|guestRateLimited)\s*\(|guest\/token/,
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

// Resolve "@/lib/x" and relative imports to a repo-relative module id without extension.
function importsOf(file, src) {
  const ids = [];
  const re = /from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1] || m[2];
    let id = null;
    if (spec.startsWith("@/")) id = spec.slice(2);
    else if (spec.startsWith(".")) id = relative(ROOT, resolve(dirname(file), spec));
    if (id) ids.push(id.replace(/\.(ts|tsx|js|mjs)$/, "").replace(/\/index$/, ""));
  }
  return ids;
}

// 1. Which lib modules are service-backed (directly or transitively)?
const libFiles = walk(LIB);
const libSrc = new Map(libFiles.map((f) => [relative(ROOT, f).replace(/\.(ts|tsx)$/, ""), readFileSync(f, "utf8")]));
const serviceBacked = new Set(SERVICE_MODULES);
for (const [id, src] of libSrc) if (SERVICE_SYMBOLS.test(src)) serviceBacked.add(id);
let grew = true;
while (grew) {
  grew = false;
  for (const [id, src] of libSrc) {
    if (serviceBacked.has(id)) continue;
    const file = join(ROOT, id + ".ts");
    for (const dep of importsOf(file, src)) if (serviceBacked.has(dep)) { serviceBacked.add(id); grew = true; break; }
  }
}
// The gate helpers themselves are not "service-backed" even if they mention the symbols in comments.
serviceBacked.delete("lib/access/requireManager");
serviceBacked.delete("lib/cron/heartbeat"); // cronDb lives here; importing cronAuthorized is the gate, not a leak

// 2. Classify every route handler.
const routes = walk(APP).filter((f) => /\/route\.ts$/.test(f));
const failures = [];
const report = [];
for (const f of routes) {
  const rel = relative(ROOT, f);
  const src = readFileSync(f, "utf8");
  const deps = importsOf(f, src);
  const direct = SERVICE_SYMBOLS.test(src) || deps.some((d) => SERVICE_MODULES.has(d));
  const viaLib = deps.filter((d) => serviceBacked.has(d) && !SERVICE_MODULES.has(d));
  if (!direct && viaLib.length === 0) continue;

  const lane = rel.startsWith("app/api/cron/") ? "cron"
    : /\/webhook(s)?\//.test(rel) ? "webhook"
    : rel.startsWith("app/api/guest/") || rel.startsWith("app/api/leads/") || rel.startsWith("app/api/m/") ? "guest"
    : "interactive";
  const gate = GATES[lane];
  const ok = gate.test(src) || (lane !== "interactive" && GATES.interactive.test(src));
  const how = direct ? "direct" : "via " + viaLib.join(", ");
  report.push(`${ok ? "ok   " : "FAIL "} ${lane.padEnd(11)} ${rel}  (${how})`);
  if (!ok) failures.push(rel);
}

report.sort().forEach((l) => console.log(l));
console.log(`\nservice-backed libs: ${[...serviceBacked].filter((x) => !SERVICE_MODULES.has(x)).sort().join(", ")}`);
console.log(`\nroutes on a service path: ${report.length}   ungated: ${failures.length}`);
if (failures.length) {
  console.error("\nUngated routes — add requireEntityAccess(sb, entity) (or the lane's gate) before the service client:\n  " + failures.join("\n  "));
  process.exit(1);
}
