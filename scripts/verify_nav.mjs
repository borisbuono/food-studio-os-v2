// verify_nav.mjs — slim OS nav checker (slice 1, 2026-09-26).
//
//   node scripts/verify_nav.mjs
//
// 1. Renders every nav tree (lib/nav.ts: house/studio/me), the ⌘K rows
//    (flattenNav + NEW_ITEMS from components/CommandK.tsx) and the Chef
//    navigate targets (string literals in lib/chef/router.ts + foodCost.ts)
//    with house = "bm" and resolves each href to a real app/**/page.tsx.
// 2. Asserts every retired route (lib/routing/retired.ts) has NO page.tsx
//    left, and that its survivor resolves.
// Exit 1 on any miss. Compiles the two pure TS modules to /tmp with tsc.

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = mkdtempSync(join(process.env.FS_NAV_TMP || tmpdir(), "fs-nav-"));
writeFileSync(join(out, "tsconfig.json"), JSON.stringify({
  compilerOptions: { outDir: out, rootDir: root, module: "es2022", target: "es2022", moduleResolution: "bundler", skipLibCheck: true, declaration: false, baseUrl: root, paths: { "@/*": ["./*"] }, types: [] },
  files: [join(root, "lib/nav.ts"), join(root, "lib/routing/retired.ts"), join(root, "lib/nav/recent.ts")],
}));
execSync(`npx tsc -p ${join(out, "tsconfig.json")}`, { cwd: root, stdio: "inherit" });
const nav = await import(pathToFileURL(join(out, "lib/nav.js")).href);
const retired = await import(pathToFileURL(join(out, "lib/routing/retired.js")).href);

// ---- resolve an href to app/**/page.tsx (static or [dynamic] segment)
function resolvePage(href) {
  const path = href.split("?")[0].split("#")[0];
  const segs = path.split("/").filter(Boolean);
  let dir = join(root, "app");
  for (const seg of segs) {
    const entries = readdirSync(dir).filter((e) => statSync(join(dir, e)).isDirectory());
    let next = entries.find((e) => e === seg);
    if (!next) next = entries.find((e) => /^\[[^.]+\]$/.test(e));
    if (!next) return null;
    dir = join(dir, next);
  }
  return existsSync(join(dir, "page.tsx")) ? join(dir, "page.tsx").replace(root + "/", "") : null;
}
const sub = (h) => h.split("{house}").join("bm");

let dead = 0, checked = 0;
const ok = (label, href) => {
  const p = resolvePage(sub(href)); checked++;
  console.log(`  ${p ? "ok  " : "DEAD"}  ${label.padEnd(34)} ${sub(href)}`);
  if (!p) dead++;
};

for (const tree of ["house", "studio", "me"]) {
  console.log(`== nav · ${tree} (house='bm')`);
  for (const v of nav.verbsFor(tree)) {
    ok(v.label, v.href);
    for (const l of v.leaves) ok("  · " + l.label, l.href);
  }
}

console.log("== ⌘K rows");
const kRows = [...nav.flattenNav("house"), ...nav.flattenNav("studio"), ...nav.flattenNav("me"), { label: "Home", href: "/" }, { label: "Studio", href: "/studio" }];
const ck = readFileSync(join(root, "components/CommandK.tsx"), "utf8");
const newBlock = ck.slice(ck.indexOf("const NEW_ITEMS"), ck.indexOf("];", ck.indexOf("const NEW_ITEMS")));
for (const m of newBlock.matchAll(/label:\s*"([^"]+)",\s*href:\s*"([^"]+)"/g)) kRows.push({ label: m[1], href: m[2] });
const seen = new Set();
for (const r of kRows) { if (seen.has(r.href)) continue; seen.add(r.href); ok(r.label, r.href); }
console.log(`  ${seen.size} distinct ⌘K rows`);

console.log("== Chef navigate / card targets (lib/chef/router.ts, foodCost.ts)");
const chefSrc = readFileSync(join(root, "lib/chef/router.ts"), "utf8") + readFileSync(join(root, "lib/chef/foodCost.ts"), "utf8");
const chefTargets = new Set();
for (const m of chefSrc.matchAll(/"(\/(?!api\/)[a-z0-9\-\/]*)"/g)) chefTargets.add(m[1]);
for (const m of chefSrc.matchAll(/h \+ "(\/[a-z0-9\-\/]+)"/g)) chefTargets.add("/h/bm" + m[1]);
for (const m of chefSrc.matchAll(/"\/h\/" \+ [a-z.]+ \+ "(\/[a-z0-9\-\/]+)"/g)) chefTargets.add("/h/bm" + m[1] + (m[1].endsWith("/") ? "x" : ""));
const suffixes = new Set([...chefSrc.matchAll(/h \+ "(\/[a-z0-9\-\/]+)"/g)].map((m) => m[1]));
for (const t of [...chefTargets].sort()) { if (t === "/") { ok("home", "/"); continue; } if (/\/$/.test(t) || suffixes.has(t)) continue; ok("chef", t); }

console.log("== retired routes (lib/routing/retired.ts)");
let stale = 0;
for (const r of retired.RETIRED) {
  const from = r.from.replace(":house", "bm").replace(":room", "kitchen").replace(":id", "11111111-1111-1111-1111-111111111111").replace(":entity", "x");
  const hit = retired.retiredTarget(from, "bm");
  // A static retired path that now resolves only through a dynamic sibling
  // (/administrate/team/onboarding ↔ /administrate/team/[id]) is gone as a
  // page — middleware redirects before the sibling could swallow it.
  const resolved = resolvePage(from);
  const still = resolved && !(!r.from.includes(":") && /\[/.test(resolved));
  // A retired path whose pattern also matches a surviving dynamic route
  // (/h/:house/:room ↔ /h/[house]/[room]/page.tsx) counts as stale only if
  // the exact page file is the retired one.
  const target = hit ? hit.to : null;
  const tOk = target ? (target === "/" || resolvePage(target)) : null;
  console.log(`  ${still ? "STALE" : "gone "}  ${r.from.padEnd(52)} → ${target}${tOk ? "" : "  (SURVIVOR MISSING)"}`);
  if (still) stale++;
  if (!tOk) dead++;
  checked++;
}

const pages = execSync("find app -name page.tsx | wc -l", { cwd: root }).toString().trim();
console.log(`\nTOTAL hrefs checked: ${checked}   dead: ${dead}   retired-still-present: ${stale}   page routes: ${pages}`);
process.exit(dead || stale ? 1 : 0);
