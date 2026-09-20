import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getHouseBySlug } from "@/lib/houses";

// /h/<slug>/office — mirror of the [room] catchall for the "office" room.
//
// We shipped `app/h/[house]/office/labor/page.tsx` for the labor dashboard;
// once a static segment `office` exists, Next.js stops falling back to the
// sibling `[room]/page.tsx` for /h/<slug>/office. This stub restores the
// old behaviour so `/h/bm/office` keeps binding the fs_entity cookie and
// dropping the operator on the legacy /office pillar.

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: { house: string } }) {
  const slug = params.house;
  const house = await getHouseBySlug(slug);
  if (!house) redirect("/studio");
  try {
    cookies().set("fs_entity", house.id, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 30 });
  } catch { /* read-only in some render paths — non-fatal */ }
  redirect("/office");
}
