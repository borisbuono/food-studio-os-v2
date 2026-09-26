import Link from "next/link";
import { redirect } from "next/navigation";
import { houseNameForSlug } from "@/lib/houses";
import { getHouseBySlug } from "@/lib/houses.server";
import { supabaseServer } from "@/lib/supabaseServer";
import SavedRepliesEditor, { type SavedRow } from "./SavedRepliesEditor";

export const dynamic = "force-dynamic";

// /h/<slug>/office/inbox/saved — the canned answers the inbox offers and the
// drafter reads (apply, hours, booking, dogs, parking). Edited in place;
// rows write through RLS (managed-entity policies).

// The Saved replies tab of /h/<slug>/comms (slim OS slice 4).
export default async function SavedRepliesPage({ params }: { params: { house: string } }) {
  const slug = params.house;
  const house = await getHouseBySlug(slug);
  if (!house) redirect("/studio");
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) redirect(`/login?next=/h/${slug}/comms?tab=saved`);

  const { data } = await sb.from("social_saved_replies")
    .select("id, key, title, lang, body, sort, active")
    .eq("entity_id", house.id).order("sort").order("key");

  return (
    <main className="mx-auto max-w-3xl px-3 py-4 sm:px-6 sm:py-8">
      <div className="border-b border-black/10 pb-3">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
          {houseNameForSlug(slug)}
        </p>
        <h2 className="font-serif text-2xl">Saved replies</h2>
        <p className="mt-1 text-xs text-clay">
          Facts only. The drafter reuses these; anything in square brackets is a placeholder you still have to fill — those rows stay off until you switch them on.
        </p>
      </div>
      <SavedRepliesEditor entityId={house.id} rows={(data ?? []) as SavedRow[]} />
    </main>
  );
}
