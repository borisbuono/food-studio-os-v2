/**
 * Role-trimmed dock (2026-10-02, cook path) — pure-logic checks on
 * lib/nav/visible.ts: the ONE function the dock, the rail and ⌘K render from.
 * Run:
 *   node_modules/.bin/tsc tests/nav-roles.test.ts --outDir /tmp/nr --module commonjs --target es2020 \
 *     --skipLibCheck --moduleResolution node --baseUrl . --paths '{"@/*":["./*"]}' \
 *     && node -e "require('module').Module._initPaths()" && node /tmp/nr/tests/nav-roles.test.js
 * (scripts/test_nav_roles.sh does the path aliasing.)
 */
import { visibleVerbs, accessForHouse } from "../lib/nav/visible";
import type { MyAccess } from "../lib/access/myAccess";
import type { AccessibleEntity } from "../lib/access/tenantScope";

let fails = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}

const bm: AccessibleEntity = { id: "bm", name: "Bistro Mondo", slug: "bm", entity_type: "operating_venue", status: "active", parent_entity_id: "holdings", foh_enabled: true, bookings_enabled: true, hiring_enabled: true, academy_enabled: true };
const my = (role: string, room: "kitchen" | "dining" | "office" | "studio", can_receive = false): MyAccess => ({
  signedIn: true, isOwner: role === "owner", isMulti: false,
  memberships: [{ entity_id: "bm", role, room, can_receive }],
  entities: [bm],
});
const keys = (a: ReturnType<typeof accessForHouse>) => visibleVerbs("house", a).map((v) => v.key);
const leaves = (a: ReturnType<typeof accessForHouse>, verb: string) => (visibleVerbs("house", a).find((v) => v.key === verb)?.leaves || []).map((l) => l.label);

eq("cook: Service · Menu · Team", keys(accessForHouse(my("cook", "kitchen"), "bm")), ["serve", "cook", "people"]);
eq("cook + can_receive: + Supplies", keys(accessForHouse(my("cook", "kitchen", true), "bm")), ["serve", "cook", "buy", "people"]);
eq("foh: Service · Menu · Team", keys(accessForHouse(my("foh", "dining"), "bm")), ["serve", "cook", "people"]);
eq("manager: six", keys(accessForHouse(my("manager", "office"), "bm")), ["serve", "cook", "buy", "close", "people", "reach"]);
eq("owner: six", keys(accessForHouse(my("owner", "studio"), "bm")), ["serve", "cook", "buy", "close", "people", "reach"]);
eq("not loaded: ungated only (fail closed)", keys(accessForHouse(null, "bm")), ["serve", "cook", "people"]);

eq("cook Service leaves: pass · prep · cleaning · calendar · wall", leaves(accessForHouse(my("cook", "kitchen"), "bm"), "serve"), ["Pass board", "Prep list", "Cleaning", "Calendar", "Wall screen"]);
eq("foh Service leaves: cleaning · floor · guests · calendar · guest surface", leaves(accessForHouse(my("foh", "dining"), "bm"), "serve"), ["Cleaning", "Floor", "Guests", "Calendar", "Guest surface"]);
eq("cook Menu: no Costing", leaves(accessForHouse(my("cook", "kitchen"), "bm"), "cook").includes("Costing"), false);
eq("manager Menu: Costing", leaves(accessForHouse(my("manager", "office"), "bm"), "cook").includes("Costing"), true);
eq("cook Team leaves: clock · academy only", leaves(accessForHouse(my("cook", "kitchen"), "bm"), "people"), ["Clock station", "Academy"]);
eq("cook: no studio verbs", visibleVerbs("studio", accessForHouse(my("cook", "kitchen"), "bm")).length, 0);
eq("owner: studio verbs", visibleVerbs("studio", accessForHouse(my("owner", "studio"), null)).length, 5);

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nall passed");
