import { redirect } from "next/navigation";
import { getHouseBySlug } from "@/lib/houses.server";

// /h/<slug>/office — mirror of the [room] catchall for the "office" room.
//
// We shipped `app/h/[house]/office/labor/page.tsx` for the labor dashboard;
// once a static segment `office` exists, Next.js stops falling back to the
// sibling `[room]/page.tsx` for /h/<slug>/office. This stub restores the
// old behaviour so `/h/bm/office` keeps
// dropping the operator on the legacy /office pillar.

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: { house: string } }) {
  const slug = params.house;
  const house = await getHouseBySlug(slug);
  if (!house) redirect("/studio");
  // fs_entity is bound by middleware.ts on the way in (2026-09-22) — the
  // in-page cookies().set() this used to do is a no-op in a Server Component.
  redirect("/office");
}
