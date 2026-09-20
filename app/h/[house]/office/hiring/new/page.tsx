import { redirect } from "next/navigation";
import Link from "next/link";
import { getHouseBySlug, houseNameForSlug } from "@/lib/houses";
import { supabaseServer } from "@/lib/supabaseServer";
import NewOpeningForm from "./NewOpeningForm";

export const dynamic = "force-dynamic";

export default async function NewOpeningPage({ params }: { params: { house: string } }) {
  const slug = params.house;
  const house = await getHouseBySlug(slug);
  if (!house) redirect("/studio");
  const entity_id = house.id;
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) redirect(`/login?next=/h/${slug}/office/hiring/new`);

  const houseName = houseNameForSlug(slug);
  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <div className="border-b border-black/10 pb-4">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
          Hiring · {houseName}
        </p>
        <h1 className="font-serif text-2xl">New opening</h1>
      </div>
      <NewOpeningForm slug={slug} entityId={entity_id} />
      <p className="mt-6 text-xs">
        <Link href={`/h/${slug}/office/hiring`} className="underline">
          ← back to hiring
        </Link>
      </p>
    </main>
  );
}
