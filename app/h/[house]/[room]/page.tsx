import { redirect } from "next/navigation";
import { houseNameForSlug, HOUSE_ROOM_LABEL, HOUSE_ROOM_LEGACY_PATH, isHouseRoom } from "@/lib/houses";
import { getHouseBySlug } from "@/lib/houses.server";

// /h/<slug>/<room> — a room inside a house.
//
// Redirects to the room's canonical legacy path (/boh, /foh, /office).
// fs_entity is bound to this house by middleware.ts on the way in (a
// Server Component cannot set cookies — the old in-page set was a silent
// no-op), so every existing dashboard keeps working and the room switcher /
// sidebar chrome derive the three-level scope from the cookie via
// resolveScope().
//
// Invalid slug or room → bounce to the house or studio so the user is
// never dead-ended.

export const dynamic = "force-dynamic";

export default async function HouseRoomPage({
  params,
}: { params: { house: string; room: string } }) {
  const slug = params.house;
  const room = params.room;
  const house = await getHouseBySlug(slug);
  if (!house) redirect("/studio");
  if (!isHouseRoom(room)) redirect(`/h/${slug}`);
  redirect(HOUSE_ROOM_LEGACY_PATH[room]);
}

export function generateMetadata({ params }: { params: { house: string; room: string } }) {
  const houseName = houseNameForSlug(params.house);
  const roomLabel = isHouseRoom(params.room) ? HOUSE_ROOM_LABEL[params.room] : "Room";
  return { title: `${houseName} · ${roomLabel} · Food Studios` };
}
