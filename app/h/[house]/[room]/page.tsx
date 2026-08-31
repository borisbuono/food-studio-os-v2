import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { entityForHouseSlug, houseNameForSlug, HOUSE_ROOM_LABEL, HOUSE_ROOM_LEGACY_PATH, isHouseRoom } from "@/lib/houses";

// /h/<slug>/<room> — a room inside a house.
//
// Sets fs_entity to the house's entity key, then redirects to the room's
// canonical legacy path (/boh, /foh, /office). Every existing dashboard
// keeps working, and the room switcher / sidebar chrome derives the
// three-level scope from the cookie via resolveScope().
//
// Invalid slug or room → bounce to the house or studio so the user is
// never dead-ended.

export const dynamic = "force-dynamic";

export default function HouseRoomPage({
  params,
}: { params: { house: string; room: string } }) {
  const slug = params.house;
  const room = params.room;
  const entity = entityForHouseSlug(slug);
  if (!entity) redirect("/studio");
  if (!isHouseRoom(room)) redirect(`/h/${slug}`);
  try {
    cookies().set("fs_entity", entity, {
      path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 30,
    });
  } catch { /* read-only in some render paths — non-fatal */ }
  redirect(HOUSE_ROOM_LEGACY_PATH[room]);
}

export function generateMetadata({ params }: { params: { house: string; room: string } }) {
  const houseName = houseNameForSlug(params.house);
  const roomLabel = isHouseRoom(params.room) ? HOUSE_ROOM_LABEL[params.room] : "Room";
  return { title: `${houseName} · ${roomLabel} · Food Studios` };
}
