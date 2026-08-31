import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { entityForHouseSlug, houseNameForSlug } from "@/lib/houses";

// /h/<slug> — the house dashboard entry point.
//
// Push (2026-08-31 Boris walk 09:50 CET): URLs adopt a three-level shape —
// /studio, /h/<slug>, /h/<slug>/<room>. Rather than duplicate the operating
// venue's dashboard content under a new path, /h/<slug> lands the user on
// the house's canonical entry (Office today, the operator-familiar surface)
// after binding the fs_entity cookie so every downstream page reads the
// right entity. Legacy /office / /boh / /foh continue to work; the room
// switcher hydrates them into a house-scoped chrome via resolveScope().
//
// Unknown slug → 404 semantics via a bounce to /studio (better than a hard
// 404 mid-nav — the user still gets to the portfolio).

export const dynamic = "force-dynamic";

export default function HousePage({ params }: { params: { house: string } }) {
  const slug = params.house;
  const entity = entityForHouseSlug(slug);
  if (!entity) redirect("/studio");
  try {
    cookies().set("fs_entity", entity, {
      path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 30,
    });
  } catch { /* read-only in some render paths — non-fatal */ }
  // The house dashboard IS the Office today. Once a dedicated house
  // overview lands, this redirect flips to /h/<slug>/overview.
  redirect("/office");
}

export function generateMetadata({ params }: { params: { house: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Food Studios` };
}
