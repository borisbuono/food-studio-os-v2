/**
 * Studio + House chrome polish (2026-09-21) — pure-logic checks.
 * Run:
 *   node_modules/.bin/tsc tests/chrome-polish.test.ts lib/access/tenantScope.ts \
 *     lib/studio/closeStatus.ts --outDir /tmp/cp --module commonjs --target es2020 --skipLibCheck \
 *     && node /tmp/cp/tests/chrome-polish.test.js
 */
import { filterAccessibleEntities, paletteAccessFor, canSeeRoute, type AccessibleEntity, type MembershipLite } from "../lib/access/tenantScope";
import { ddMmm, lastCloseLabel, isStaleClose } from "../lib/studio/closeStatus";

let fails = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}

const E = (
  id: string, type: string, parent: string | null = null,
  foh = true, bk = true, hire = true, acad = true,
): AccessibleEntity =>
  ({
    id, name: id, slug: id, entity_type: type, status: "active",
    parent_entity_id: parent,
    foh_enabled: foh, bookings_enabled: bk,
    hiring_enabled: hire, academy_enabled: acad,
  });
const all = [
  E("holdings", "holding_company", null, false, false),
  E("bm", "operating_venue", "holdings"),
  E("taller", "operating_venue", "holdings"),
  E("utopia", "operating_venue", null, true, false),
  E("canquince", "advisory_client", "holdings", false, false),
];
const boris: MembershipLite[] = [
  { entity_id: "bm", role: "owner", room: "studio" },
  { entity_id: "taller", role: "owner", room: "studio" },
  { entity_id: "utopia", role: "owner", room: "studio" },
];
const marco: MembershipLite[] = [{ entity_id: "utopia", role: "owner", room: "studio" }];
const cook: MembershipLite[] = [{ entity_id: "taller", role: "worker", room: "kitchen" }];
const ids = (xs: AccessibleEntity[]) => xs.map((x) => x.id).sort();

// Tenant filter
eq("boris sees all his houses + holding + advisory", ids(filterAccessibleEntities(all, boris)), ["bm", "canquince", "holdings", "taller", "utopia"]);
eq("utopia owner sees ONLY utopia", ids(filterAccessibleEntities(all, marco)), ["utopia"]);
eq("taller cook sees only taller", ids(filterAccessibleEntities(all, cook)), ["taller"]);

// Palette gating
const aCook = paletteAccessFor(filterAccessibleEntities(all, cook), cook, "taller");
eq("cook: kitchen route", canSeeRoute({ room: "kitchen" }, aCook), true);
eq("cook: office route hidden", canSeeRoute({ room: "office" }, aCook), false);
eq("cook: FOH hidden", canSeeRoute({ room: "dining", feature: "foh" }, aCook), false);
eq("cook: studio hidden", canSeeRoute({ room: "studio" }, aCook), false);
eq("cook: universal visible", canSeeRoute({}, aCook), true);

const aMarco = paletteAccessFor(filterAccessibleEntities(all, marco), marco, "utopia");
eq("utopia owner: FOH visible", canSeeRoute({ room: "dining", feature: "foh" }, aMarco), true);
eq("utopia owner: bookings hidden (flag off)", canSeeRoute({ room: "dining", feature: "bookings" }, aMarco), false);
eq("cookie pointing at a house he can't see → falls back to his own", paletteAccessFor(filterAccessibleEntities(all, marco), marco, "bm").bookings, false);

const aBorisStudio = paletteAccessFor(filterAccessibleEntities(all, boris), boris, null);
eq("boris @ studio: bookings (any house)", canSeeRoute({ room: "dining", feature: "bookings" }, aBorisStudio), true);
eq("boris @ studio: studio routes", canSeeRoute({ room: "studio" }, aBorisStudio), true);

const mgr: MembershipLite[] = [{ entity_id: "bm", role: "manager", room: "office" }];
const aMgr = paletteAccessFor(filterAccessibleEntities(all, mgr), mgr, "bm");
eq("manager: kitchen + dining + office", ["kitchen", "dining", "office"].map((r) => canSeeRoute({ room: r as any }, aMgr)), [true, true, true]);
eq("manager: studio hidden", canSeeRoute({ room: "studio" }, aMgr), false);

// Close status (#58)
eq("ddMmm pads day", ddMmm("2026-09-03"), "03 Sep");
eq("label", lastCloseLabel("2026-09-21"), "Last close 21 Sep");
eq("2 days old not stale", isStaleClose("2026-09-19", "2026-09-21"), false);
eq("3 days old stale", isStaleClose("2026-09-18", "2026-09-21"), true);
eq("today not stale", isStaleClose("2026-09-21", "2026-09-21"), false);

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log("\nall passed");
