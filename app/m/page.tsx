import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import FabHidden from "@/components/FabHidden";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Root /m — with no slug, forward to the first venue with a public slug set
// (in practice: bistrot-mondo). Falls through to a picker if multiple exist
// and no clear default. Legacy printed QRs that point at bare /m keep working.
export default async function GuestMenuIndex() {
  const { data } = await supabase
    .from("restaurants")
    .select("public_slug, name")
    .not("public_slug", "is", null);
  const rows = (data || []) as { public_slug: string; name: string | null }[];

  // Prefer Bistrot Mondo (the venue the printed QR currently points at).
  const bm = rows.find((r) => r.public_slug === "bistrot-mondo");
  if (bm) redirect(`/m/${bm.public_slug}`);
  if (rows.length === 1) redirect(`/m/${rows[0].public_slug}`);

  return (
    <main className="mx-auto max-w-lg px-8 py-16">
      <FabHidden />
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-clay">Food Studios</p>
      <h1 className="mt-3 font-serif text-3xl text-ink">Choose a venue</h1>
      <ul className="mt-8 divide-y divide-black/10">
        {rows.map((r) => (
          <li key={r.public_slug}>
            <Link href={`/m/${r.public_slug}`} className="flex items-baseline justify-between py-4 transition hover:opacity-70">
              <span className="font-serif text-[18px] text-ink">{r.name || r.public_slug}</span>
              <span className="font-mono text-[11px] uppercase tracking-wide text-clay">Open ›</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
