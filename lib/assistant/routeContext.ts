import { supabaseServer } from "@/lib/supabaseServer";
import { ENTITY_TO_RESTAURANT, EntityKey, E_BM, E_TALLER, E_HOLDINGS } from "@/lib/entities";
import type { AssistantEntityScope, EntityCode } from "@/lib/assistant/orchestrator";
// Route context — Chef's ground truth for the page the operator is
// standing on right now.
//
// The Chef FAB used to answer aspirationally from entity-wide state (open
// invoices, active MEP, mid-service framing) no matter what page the user
// was on. On 2026-08-22 Boris opened Chef on /develop/wine (which the page
// renders as "0 wines" because the underlying query has a category filter
// bug) and Chef replied about "307 drafts sitting at €80k" and hallucinated
// a venue name ("Pistumonto"). That failure mode is the reason this module
// exists.
//
// The contract:
//   - Given the route the user is on, look up which Supabase tables that
//     page reads and re-run the same query the page runs.
//   - Also, where the page's query is known to be filter-bugged (wine
//     currently is), run the "what actually exists" query so Chef can point
//     the user at the real data.
//   - Return descriptions in a shape the orchestrator can hand straight to
//     the model as ground truth. No inference here — just counts and short
//     labels.
//
// If a route isn't in the map, the caller falls back to a lightweight
// entity-wide snapshot (kept for backwards compatibility, but re-weighted
// down in the system prompt so it doesn't drown out the page).

// Route context is scope-driven since 2026-09-20 (Chef multi-tenant
// scoping). We do NOT map an EntityCode string → EntityKey any more; the
// caller hands us an AssistantEntityScope whose `entity.id` is the UUID and
// whose `restaurant_id` is populated for the pinned venues (BM / Taller).
// A fourth tenant (Amsterdam) arrives with restaurant_id=null; every
// handler either has an explicit restaurant-less path or is skipped so no
// data crosses tenants. See TO_BORIS_chef_context_audit_2026-09-20.

export type RouteQueryResult = {
  table: string;
  filter: string;
  count: number;
  note?: string;
};

export type RouteContext = {
  route: string;
  title: string;             // short human name for the page
  reads: string[];           // tables this page queries (for the model)
  queries: RouteQueryResult[]; // actual counts run right now
  hint?: string;             // extra sentence for Chef ("category filter bug: …")
  is_service_route: boolean; // /execute/pass, /execute/floor — the only routes
                             // where mid-service framing is appropriate
};

// The map. Longest-prefix wins in resolveRouteContext.
type RouteHandler = (
  scope: AssistantEntityScope,
  route: string,
) => Promise<Omit<RouteContext, "route" | "is_service_route">>;

const HANDLERS: Array<{
  prefix: string;
  is_service_route: boolean;
  handle: RouteHandler;
}> = [
  {
    prefix: "/develop/wine",
    is_service_route: false,
    handle: async (scope) => {
      const restaurantId = scope.restaurant_id;
      if (!restaurantId) {
        return {
          title: "Wine list",
          reads: ["menu_items (section=wine)"],
          queries: [{ table: "menu_items", filter: "no restaurant scope resolvable", count: 0 }],
        };
      }
      const sb = supabaseServer();
      // The page runs THIS exact filter (see app/develop/wine/page.tsx).
      // It has a known bug: category='drink' matches nothing, real rows use
      // category='red' / 'white' / 'bubbles' / 'rose'.
      const buggy = await sb
        .from("menu_items")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true).eq("category", "drink").eq("section", "wine")
        .eq("restaurant_id", restaurantId);
      const actual = await sb
        .from("menu_items")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true).eq("section", "wine")
        .eq("restaurant_id", restaurantId);
      // Also grab the distinct categories the actual wines carry, so Chef
      // can name them if asked.
      const cats = await sb
        .from("menu_items")
        .select("category")
        .eq("is_active", true).eq("section", "wine")
        .eq("restaurant_id", restaurantId);
      const catSet = new Set(((cats as any).data || []).map((r: any) => r.category));
      const buggyCount = buggy.count ?? 0;
      const actualCount = actual.count ?? 0;
      const hintParts: string[] = [];
      if (buggyCount === 0 && actualCount > 0) {
        hintParts.push(
          "The page renders 0 wines because /develop/wine filters menu_items by category='drink' AND section='wine'. Real wine rows use categories: " +
          Array.from(catSet).sort().join(", ") +
          ". Total wines actually present for this restaurant (section='wine' only): " + actualCount +
          ". This is a filter bug on the page, not missing data."
        );
      }
      return {
        title: "Wine list",
        reads: ["menu_items (section=wine)"],
        queries: [
          { table: "menu_items", filter: "is_active=true AND category='drink' AND section='wine' (the page's filter)", count: buggyCount, note: "what the page renders" },
          { table: "menu_items", filter: "is_active=true AND section='wine' (real data, all categories)", count: actualCount, note: "what actually exists" },
        ],
        hint: hintParts.join(" "),
      };
    },
  },
  {
    prefix: "/develop/recipes",
    is_service_route: false,
    handle: async (scope) => {
      const sb = supabaseServer();
      const rid = scope.restaurant_id;
      // Scope by restaurant_id — pre-2026-09-20 this was a global count and
      // a chef in any tenant saw the whole recipes book.
      const q = rid
        ? sb.from("recipes").select("id", { count: "exact", head: true }).eq("restaurant_id", rid)
        : sb.from("recipes").select("id", { count: "exact", head: true }).eq("entity_id", scope.entity.id);
      const recipes = await q;
      // recipe_imports.entity_id is a text column that historically held the
      // EntityCode ("BM"/"IFL"/"BBH"). Filter by code when we have one, else
      // fall back to the UUID (no rows for legacy tenants, which is
      // correct — the pipeline isn't wired for Amsterdam yet).
      const importKey = scope.code || scope.entity.id;
      const pending = await sb.from("recipe_imports").select("id", { count: "exact", head: true }).eq("entity_id", importKey).in("status", ["parsed", "pending"]);
      return {
        title: "Recipes",
        reads: ["recipes", "recipe_imports"],
        queries: [
          { table: "recipes", filter: rid ? "restaurant scope" : "entity scope", count: recipes.count ?? 0 },
          { table: "recipe_imports", filter: (rid ? "restaurant scope AND " : "entity scope AND ") + "status IN (parsed,pending)", count: pending.count ?? 0 },
        ],
      };
    },
  },
  {
    prefix: "/develop/menu",
    is_service_route: false,
    handle: async (scope) => {
      const sb = supabaseServer();
      const rid = scope.restaurant_id;
      const q = rid
        ? sb.from("recipes").select("id", { count: "exact", head: true }).eq("restaurant_id", rid)
        : sb.from("recipes").select("id", { count: "exact", head: true }).eq("entity_id", scope.entity.id);
      const rec = await q;
      return {
        title: "Menu",
        reads: ["recipes"],
        queries: [{ table: "recipes", filter: rid ? "restaurant scope" : "entity scope", count: rec.count ?? 0 }],
      };
    },
  },
  {
    prefix: "/execute/pass",
    is_service_route: true,
    handle: async (scope) => {
      const restaurantId = scope.restaurant_id;
      if (!restaurantId) {
        return { title: "Pass", reads: ["mep_dishes", "tasks", "zones"], queries: [] };
      }
      const sb = supabaseServer();
      const zones = await sb.from("zones").select("id").eq("restaurant_id", restaurantId);
      const zoneIds = ((zones as any).data || []).map((z: any) => z.id);
      const mep = zoneIds.length
        ? await sb.from("mep_dishes").select("id", { count: "exact", head: true }).in("zone_id", zoneIds).eq("is_active", true)
        : { count: 0 } as any;
      const tasks = zoneIds.length
        ? await sb.from("tasks").select("id", { count: "exact", head: true }).in("zone_id", zoneIds).eq("is_active", true)
        : { count: 0 } as any;
      return {
        title: "Pass",
        reads: ["mep_dishes", "tasks", "zones"],
        queries: [
          { table: "zones", filter: "restaurant scope", count: zoneIds.length },
          { table: "mep_dishes", filter: "is_active=true in these zones", count: mep.count ?? 0 },
          { table: "tasks (BOH station tasks)", filter: "is_active=true in these zones", count: tasks.count ?? 0 },
        ],
      };
    },
  },
  {
    prefix: "/execute/orders",
    is_service_route: false,
    handle: async (scope) => {
      const sb = supabaseServer();
      const restaurantId = scope.restaurant_id;
      // providers / provider_products scope: providers has restaurant_id;
      // provider_products has provider_id → restaurant_id.
      const providers = restaurantId
        ? await sb.from("providers").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurantId)
        : { count: 0 } as any;
      const products = restaurantId
        ? await sb.from("provider_products").select("id,providers!inner(restaurant_id)", { count: "exact", head: true }).eq("is_active", true).eq("providers.restaurant_id", restaurantId)
        : { count: 0 } as any;
      const openOrders = restaurantId
        ? await sb.from("orders").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurantId).is("delivered_at", null)
        : { count: 0 } as any;
      return {
        title: "Orders",
        reads: ["providers", "provider_products", "orders"],
        queries: [
          { table: "providers", filter: "restaurant scope", count: providers.count ?? 0 },
          { table: "provider_products", filter: "restaurant scope AND is_active=true", count: products.count ?? 0 },
          { table: "orders", filter: "restaurant scope AND delivered_at IS NULL", count: openOrders.count ?? 0 },
        ],
      };
    },
  },
  {
    prefix: "/execute/bookings",
    is_service_route: true,
    handle: async (scope) => {
      const sb = supabaseServer();
      const restaurantId = scope.restaurant_id;
      const covers = restaurantId
        ? await sb.from("covers").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurantId)
        : { count: 0 } as any;
      return {
        title: "Bookings",
        reads: ["covers"],
        queries: [{ table: "covers", filter: "restaurant scope (first 50 shown)", count: covers.count ?? 0 }],
      };
    },
  },
  {
    prefix: "/execute/inventory",
    is_service_route: false,
    handle: async (scope) => {
      const restaurantId = scope.restaurant_id;
      if (!restaurantId) {
        return { title: "Inventory", reads: ["inventory_items"], queries: [] };
      }
      const sb = supabaseServer();
      const items = await sb.from("inventory_items").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurantId);
      return {
        title: "Inventory",
        reads: ["inventory_items"],
        queries: [{ table: "inventory_items", filter: "restaurant scope", count: items.count ?? 0 }],
      };
    },
  },
  {
    prefix: "/administrate/finance/eod",
    is_service_route: false,
    handle: async (scope) => {
      const sb = supabaseServer();
      const restaurantId = scope.restaurant_id;
      if (!restaurantId) {
        return {
          title: "EOD accounting",
          reads: ["eod_accounting"],
          queries: [{ table: "eod_accounting", filter: "restaurant scope (no restaurant bound for this entity)", count: 0 }],
        };
      }
      const eod = await sb.from("eod_accounting").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurantId);
      const recent = await sb.from("eod_accounting").select("report_date").eq("restaurant_id", restaurantId).order("report_date", { ascending: false }).limit(1);
      const lastDate = ((recent as any).data || [])[0]?.report_date || null;
      return {
        title: "EOD accounting",
        reads: ["eod_accounting"],
        queries: [
          { table: "eod_accounting", filter: "restaurant scope", count: eod.count ?? 0, note: lastDate ? "most recent report_date: " + lastDate : undefined },
        ],
      };
    },
  },
  {
    prefix: "/administrate/invoices",
    is_service_route: false,
    handle: async (scope) => {
      const restaurantId = scope.restaurant_id;
      if (!restaurantId) return { title: "Invoices", reads: ["orders", "providers"], queries: [] };
      const sb = supabaseServer();
      const orders = await sb.from("orders").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurantId);
      const unreconciled = await sb.from("orders").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurantId).is("reconciled_at", null);
      return {
        title: "Invoices",
        reads: ["orders", "providers", "inventory_movements", "price_history"],
        queries: [
          { table: "orders", filter: "restaurant scope", count: orders.count ?? 0 },
          { table: "orders", filter: "restaurant scope AND reconciled_at IS NULL", count: unreconciled.count ?? 0 },
        ],
      };
    },
  },
  {
    prefix: "/administrate/suppliers",
    is_service_route: false,
    handle: async (scope) => {
      const sb = supabaseServer();
      const restaurantId = scope.restaurant_id;
      if (!restaurantId) {
        return {
          title: "Suppliers",
          reads: ["providers", "provider_products"],
          queries: [{ table: "providers", filter: "restaurant scope (none bound)", count: 0 }],
        };
      }
      const providers = await sb.from("providers").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurantId);
      const products = await sb.from("provider_products").select("id,providers!inner(restaurant_id)", { count: "exact", head: true }).eq("is_active", true).eq("providers.restaurant_id", restaurantId);
      return {
        title: "Suppliers",
        reads: ["providers", "provider_products"],
        queries: [
          { table: "providers", filter: "restaurant scope", count: providers.count ?? 0 },
          { table: "provider_products", filter: "restaurant scope AND is_active=true", count: products.count ?? 0 },
        ],
      };
    },
  },
  {
    prefix: "/administrate/master-todo",
    is_service_route: false,
    handle: async (scope) => {
      const sb = supabaseServer();
      const code = scope.code;
      if (!code) {
        // master_todos is keyed by legacy EntityCode string; non-pinned
        // tenants have no rows. Return empty rather than the global count.
        return {
          title: "Master to-do",
          reads: ["master_todos"],
          queries: [{ table: "master_todos", filter: "entity_code scope (this tenant has no master_todos pipeline)", count: 0 }],
        };
      }
      const openEntity = await sb.from("master_todos").select("id", { count: "exact", head: true }).not("status", "in", "(completed,deferred)").eq("entity_code", code);
      return {
        title: "Master to-do",
        reads: ["master_todos"],
        queries: [
          { table: "master_todos", filter: "status NOT IN (completed,deferred), entity_code=" + code, count: openEntity.count ?? 0 },
        ],
      };
    },
  },
];

export async function getRouteContext(scope: AssistantEntityScope, route: string | null | undefined): Promise<RouteContext | null> {
  if (!route) return null;
  // Strip query string; match on path.
  const path = route.split("?")[0].split("#")[0];
  // Longest-prefix match.
  const match = HANDLERS
    .slice()
    .sort((a, b) => b.prefix.length - a.prefix.length)
    .find((h) => path === h.prefix || path.startsWith(h.prefix + "/"));
  if (!match) return null;
  try {
    const partial = await match.handle(scope, path);
    return {
      route: path,
      is_service_route: match.is_service_route,
      ...partial,
    };
  } catch (e: any) {
    return {
      route: path,
      title: partial_title(match.prefix),
      reads: [],
      queries: [{ table: "(query failed)", filter: e?.message || String(e), count: 0 }],
      is_service_route: match.is_service_route,
    };
  }
}

function partial_title(prefix: string) {
  return prefix.split("/").filter(Boolean).slice(-1)[0] || "page";
}

// Format the route context as a system-prompt block. Kept in the module so
// the wording lives next to the data shape. `entityLabel` is the human name
// of the current entity (e.g. "Bistro Mondo", or "Grote Zaal Amsterdam") —
// used only for the "entity scope: " line. The pre-2026-09-20 signature
// took an EntityCode string.
export function formatRouteContextBlock(rc: RouteContext, entityLabel: EntityCode | string): string {
  const lines: string[] = [];
  lines.push("PAGE THE OPERATOR IS ON (this is the primary context — answer about THIS page):");
  lines.push("- route: " + rc.route);
  lines.push("- title: " + rc.title);
  lines.push("- entity scope: " + entityLabel);
  lines.push("- reads: " + rc.reads.join(", "));
  lines.push("- current query state (re-run just now, ground truth):");
  for (const q of rc.queries) {
    lines.push("    · " + q.table + " where " + q.filter + " → " + q.count + " rows" + (q.note ? " (" + q.note + ")" : ""));
  }
  if (rc.hint) lines.push("- interpretation: " + rc.hint);
  return lines.join("\n");
}

// Small utility used by the anti-hallucination post-check: return every
// concrete token that appears in the route context, so the orchestrator can
// verify the model didn't invent a venue name or an unrelated ledger figure.
export function routeContextTokens(rc: RouteContext | null): string[] {
  if (!rc) return [];
  const tok: string[] = [];
  tok.push(rc.title, rc.route);
  for (const q of rc.queries) {
    tok.push(q.table, q.filter, String(q.count));
    if (q.note) tok.push(q.note);
  }
  if (rc.hint) tok.push(rc.hint);
  for (const t of rc.reads) tok.push(t);
  return tok;
}
