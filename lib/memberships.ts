// memberships.ts — resolve a user's active memberships → primary room / owner flag.
//
// Push 1 vocabulary (2026-08-23):
//   STUDIO   the group
//   HOUSE    a single operating venue (Bistro Mondo, Taller, advisory client)
//   ROOM     a role-scoped dashboard (Kitchen, Dining Room, Office)
//   STATION  a tool inside a room
//
// This module answers ONE question: given the current auth user, which room
// do they belong on? It joins auth.uid → team_members.auth_user_id →
// team_members.id → memberships.person_id, and returns the active memberships.
//
// The mapping from role → room is intentionally simple; the DB `role` column
// is imprecise ("worker" is FOH or BOH depending on `area`) so we look at both
// role AND area when picking the room.

import { supabaseServer } from "@/lib/supabaseServer";

export type Room = "kitchen" | "dining" | "office" | "studio";

// Route the room resolves to. "kitchen" → /boh (URL stays alive), etc.
export const ROOM_TO_PATH: Record<Room, string> = {
  kitchen: "/boh",
  dining:  "/foh",
  office:  "/office",
  studio:  "/studio",
};

export const ROOM_LABEL: Record<Room, string> = {
  kitchen: "Kitchen",
  dining:  "Dining Room",
  office:  "Office",
  studio:  "The Studio",
};

// role|area → room. Owner is a special case (→ studio). Manager / admin sit
// in the Office. Everyone else routes by role first, area second.
function roleAreaToRoom(role: string | null | undefined, area: string | null | undefined): Room {
  const r = (role || "").toLowerCase().trim();
  const a = (area || "").toLowerCase().trim();
  if (r === "owner") return "studio";
  if (["manager", "admin", "gm", "director", "operator"].includes(r)) return "office";
  // Explicit kitchen roles
  if (["chef", "cook", "porter", "pastry", "kitchen", "prep"].includes(r)) return "kitchen";
  // Explicit dining-room roles
  if (["maitre", "maître", "waiter", "host", "somm", "sommelier", "bar", "server", "foh"].includes(r)) return "dining";
  // Fallback: use the `area` column (workers are the majority; area disambiguates).
  if (a === "boh") return "kitchen";
  if (a === "foh") return "dining";
  if (a === "admin") return "office";
  // Very last resort — dining is the safest guest-visible surface.
  return "dining";
}

export type ActiveMembership = {
  entity_id: string;
  entity_name: string;
  entity_type: string;
  role: string;
  area: string | null;
  room: Room;
};

export type MyMembershipContext = {
  signedIn: boolean;
  personId: string | null;
  memberships: ActiveMembership[];
  // The room the user should LAND on after sign-in.
  primaryRoom: Room;
  // True if any active membership is `owner`. Owners get the Studio.
  isOwner: boolean;
  // True if the user has more than one active membership.
  isMulti: boolean;
  // The distinct rooms across all memberships (owner always sees studio+each room they can enter).
  availableRooms: Room[];
};

// Read the signed-in user's memberships. Owner-first resolution: if any active
// membership is `owner`, primaryRoom = studio regardless of the others.
export async function getMyMembershipContext(): Promise<MyMembershipContext> {
  const sb = supabaseServer();
  const { data: userRes } = await sb.auth.getUser();
  const user = userRes?.user;
  if (!user) {
    return {
      signedIn: false, personId: null, memberships: [],
      primaryRoom: "dining", isOwner: false, isMulti: false, availableRooms: [],
    };
  }

  // auth.uid → team_members.id (there may be several rows in team_members with
  // the same auth_user_id — one per venue). We resolve to a single "person" by
  // taking the first non-archived row; person_id in `memberships` is the
  // team_members.id but each team_members row is scoped to one operator_entity,
  // so we collect ALL person_ids that share this auth user.
  const { data: tmRows } = await sb
    .from("team_members")
    .select("id, status")
    .eq("auth_user_id", user.id);
  const personIds = (tmRows || [])
    .filter((r: any) => r.status !== "archived")
    .map((r: any) => r.id as string);

  if (!personIds.length) {
    return {
      signedIn: true, personId: null, memberships: [],
      primaryRoom: "dining", isOwner: false, isMulti: false, availableRooms: [],
    };
  }

  const { data: mRows } = await sb
    .from("memberships")
    .select("entity_id, role, area, status, is_default")
    .in("person_id", personIds)
    .eq("status", "active");
  const raw = mRows || [];

  if (!raw.length) {
    return {
      signedIn: true, personId: personIds[0], memberships: [],
      primaryRoom: "dining", isOwner: false, isMulti: false, availableRooms: [],
    };
  }

  // Hydrate entity names/types in one call.
  const entityIds = Array.from(new Set(raw.map((r: any) => r.entity_id)));
  const { data: ents } = await sb
    .from("entities")
    .select("id, name, entity_type")
    .in("id", entityIds);
  const eById = new Map<string, { name: string; entity_type: string }>();
  for (const e of ents || []) eById.set(e.id, { name: e.name, entity_type: e.entity_type });

  const memberships: ActiveMembership[] = raw.map((r: any) => {
    const e = eById.get(r.entity_id);
    return {
      entity_id: r.entity_id,
      entity_name: e?.name || "Unknown",
      entity_type: e?.entity_type || "unknown",
      role: r.role,
      area: r.area || null,
      room: roleAreaToRoom(r.role, r.area),
    };
  });

  const isOwner = memberships.some((m) => (m.role || "").toLowerCase() === "owner");
  const isMulti = memberships.length > 1;

  // Primary room: owner → studio; multi-role → studio; else the single role's room.
  let primaryRoom: Room;
  if (isOwner) primaryRoom = "studio";
  else if (isMulti) {
    // Multi-role but not owner — pick their strongest role but land on Studio
    // per Push 1 spec ("multiple memberships → land on The Studio with the picker").
    primaryRoom = "studio";
  } else {
    primaryRoom = memberships[0].room;
  }

  // For owners we surface all rooms (owner sees the whole board). Others get
  // the union of rooms across their memberships.
  const roomSet = new Set<Room>(memberships.map((m) => m.room === "studio" ? "office" : m.room));
  if (isOwner) { roomSet.add("kitchen"); roomSet.add("dining"); roomSet.add("office"); }
  const availableRooms = Array.from(roomSet);

  return {
    signedIn: true,
    personId: personIds[0],
    memberships,
    primaryRoom,
    isOwner,
    isMulti,
    availableRooms,
  };
}

// countActiveMemberships — cheap wrapper for "does this person have more than
// one active membership?" checks. Added 2026-08-30 for the switcher-visibility
// gate: single-membership users never see entity/room switchers.
//
// Fetches directly from the memberships table without hydrating entities.
export async function countActiveMemberships(personId: string): Promise<number> {
  if (!personId) return 0;
  const sb = supabaseServer();
  const { count } = await sb
    .from("memberships")
    .select("*", { count: "exact", head: true })
    .eq("person_id", personId)
    .eq("status", "active");
  return count || 0;
}

// countActiveMembershipsForAuthUser — same shape but for the auth.uid → team_members
// → memberships join. Sums across ALL team_members rows for the same auth user
// (a single auth user can be an operator at multiple venues, each with its own
// team_members row).
export async function countActiveMembershipsForAuthUser(authUserId: string): Promise<number> {
  if (!authUserId) return 0;
  const sb = supabaseServer();
  const { data: tmRows } = await sb
    .from("team_members")
    .select("id, status")
    .eq("auth_user_id", authUserId);
  const personIds = (tmRows || [])
    .filter((r: any) => r.status !== "archived")
    .map((r: any) => r.id as string);
  if (!personIds.length) return 0;
  const { count } = await sb
    .from("memberships")
    .select("*", { count: "exact", head: true })
    .in("person_id", personIds)
    .eq("status", "active");
  return count || 0;
}
