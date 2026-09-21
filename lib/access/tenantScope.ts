// tenantScope.ts — which entities a signed-in user may see, and which routes
// the command palette may offer them. Pure functions: no Supabase, no
// next/headers, safe to import from client AND server code.
//
// Studio + House chrome polish (2026-09-21). Before this, "owner" meant
// "sees every entity in the table" — fine while Boris was the only owner,
// wrong the day Utopia's owner signed in: /studio listed Bistro Mondo and
// Taller to him, and the palette offered every route to every user.
//
// The rule now:
//   1. A user sees every entity they hold an ACTIVE membership on.
//   2. An OWNER of an entity also sees that entity's parent holding and the
//      holding's non-operating children (advisory clients, partners,
//      landlords). Sibling operating venues are NOT granted by ownership —
//      they need their own membership row. Boris owns BM + Taller + Utopia
//      by membership, so his view is unchanged.

export type PaletteRoom = "kitchen" | "dining" | "office" | "studio";

export type AccessibleEntity = {
  id: string;
  name: string;
  slug: string | null;
  entity_type: string;
  status: string;
  parent_entity_id: string | null;
  timezone?: string | null;
  foh_enabled: boolean;
  bookings_enabled: boolean;
};

export type MembershipLite = {
  entity_id: string;
  role: string;
  room: PaletteRoom;
};

const OPERATING = new Set(["operating_venue", "operating"]);
export function isOperating(entityType: string | null | undefined): boolean {
  return OPERATING.has(String(entityType || ""));
}

// Sensible defaults when the DB predates 20260921_entity_feature_flags.sql:
// operating venues have a dining room + bookings, nothing else does.
export function defaultFlags(entityType: string): { foh_enabled: boolean; bookings_enabled: boolean } {
  const on = isOperating(entityType);
  return { foh_enabled: on, bookings_enabled: on };
}

export function filterAccessibleEntities(
  all: AccessibleEntity[],
  memberships: MembershipLite[],
): AccessibleEntity[] {
  const byId = new Map(all.map((e) => [e.id, e]));
  const allowed = new Set<string>();
  for (const m of memberships) {
    if (!byId.has(m.entity_id)) continue;
    allowed.add(m.entity_id);
    if ((m.role || "").toLowerCase() !== "owner") continue;
    const parentId = byId.get(m.entity_id)!.parent_entity_id;
    if (!parentId || !byId.has(parentId)) continue;
    allowed.add(parentId);
    for (const e of all) {
      if (e.parent_entity_id === parentId && !isOperating(e.entity_type)) allowed.add(e.id);
    }
  }
  return all.filter((e) => allowed.has(e.id));
}

// --- Command palette gating --------------------------------------------------

export type RouteGate = {
  // Room the route belongs to. Omitted = universal (Files, Account, Home).
  room?: PaletteRoom;
  // Entity feature the route depends on.
  feature?: "foh" | "bookings";
};

export type PaletteAccess = {
  rooms: Set<PaletteRoom>;
  foh: boolean;
  bookings: boolean;
};

// Nothing loaded yet (or signed out) → universal routes only. Fail closed.
export const NO_ACCESS: PaletteAccess = { rooms: new Set(), foh: false, bookings: false };

// Which rooms a membership opens. Owner → everything incl. Studio. Office
// (manager / admin) → the whole house, because managers run the floor and
// the pass as well as the books. Kitchen / dining → their own room only.
function roomsForMembership(m: MembershipLite): PaletteRoom[] {
  if ((m.role || "").toLowerCase() === "owner") return ["studio", "office", "kitchen", "dining"];
  if (m.room === "studio") return ["studio", "office", "kitchen", "dining"];
  if (m.room === "office") return ["office", "kitchen", "dining"];
  return [m.room];
}

// Build the palette's access for the house the user is looking at.
//   contextEntityId = the house in scope (URL /h/<slug>, or the fs_entity
//   cookie on a legacy path). null / not-accessible / a non-operating
//   entity (Studio, holding) → evaluate across every accessible house.
export function paletteAccessFor(
  entities: AccessibleEntity[],
  memberships: MembershipLite[],
  contextEntityId: string | null,
): PaletteAccess {
  const ctx = contextEntityId ? entities.find((e) => e.id === contextEntityId) : undefined;
  const houseScoped = !!ctx && isOperating(ctx.entity_type);
  const scopeEntities = houseScoped ? [ctx!] : entities.filter((e) => isOperating(e.entity_type));
  const scopeIds = new Set(scopeEntities.map((e) => e.id));

  const rooms = new Set<PaletteRoom>();
  for (const m of memberships) {
    const isOwner = (m.role || "").toLowerCase() === "owner";
    // Studio is portfolio-level: any owner membership grants it regardless
    // of which house is in scope.
    if (isOwner) rooms.add("studio");
    if (!scopeIds.has(m.entity_id)) continue;
    for (const r of roomsForMembership(m)) rooms.add(r);
  }

  return {
    rooms,
    foh: scopeEntities.some((e) => e.foh_enabled),
    bookings: scopeEntities.some((e) => e.bookings_enabled),
  };
}

export function canSeeRoute(gate: RouteGate, access: PaletteAccess): boolean {
  if (gate.room && !access.rooms.has(gate.room)) return false;
  if (gate.feature === "foh" && !access.foh) return false;
  if (gate.feature === "bookings" && !access.bookings) return false;
  return true;
}
