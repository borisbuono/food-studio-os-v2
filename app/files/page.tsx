import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";
import { EntityKey, ENTITY_SHORT } from "@/lib/entities";
import FilesBrowser from "./FilesBrowser";

export const dynamic = "force-dynamic";

const ENTITY_CODE: Record<EntityKey, string> = { holdings: "BBH", bistro_mondo: "BM", taller: "IFL" };

// /files — the Files module landing.
//
// Universal document store — sits above the three pillars in the top nav
// (small icon). This page shows search + category filter chips + a table
// listing every non-archived document for the current entity.
export default async function FilesHome({ searchParams }: { searchParams: { q?: string; category?: string } }) {
  const sb = supabaseServer();
  const entity = serverEntity();
  const ec = ENTITY_CODE[entity] || "IFL";

  const q = (searchParams?.q || "").trim();
  const category = (searchParams?.category || "").trim();

  let query = sb.from("files_documents")
    .select("id,title,description,category,file_bytes,mime_type,tags,uploaded_at,uploaded_by,valid_until,entity_code")
    .eq("entity_code", ec)
    .is("archived_at", null)
    .order("uploaded_at", { ascending: false })
    .limit(200);
  if (category) query = query.eq("category", category);
  if (q) query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);

  const { data: docs, error } = await query;
  const rows: any[] = docs || [];

  return (
    <main className="mx-auto max-w-3xl lg:max-w-5xl px-6 py-10">
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Files · universal</p>
      <div className="mt-2 flex items-baseline justify-between gap-4">
        <h1 className="font-serif text-4xl leading-tight text-ink">The file room.</h1>
        <div className="flex items-baseline gap-3">
          <Link href="/files/inbox" className="font-mono text-[10px] uppercase tracking-wide text-ink hover:underline decoration-black/20 underline-offset-2">Inbox →</Link>
          <span className="font-mono text-[10px] uppercase tracking-wide text-clay">via Chef</span>
        </div>
      </div>
      <p className="mt-2 font-serif italic text-[15px] text-ink-soft">
        HACCP, contracts, brand, gestoría, statements, insurance, certifications. One place for {ENTITY_SHORT[entity]}.
      </p>

      <FilesBrowser rows={rows} q={q} category={category} entityCode={ec} error={error ? String(error.message || error) : null} />
    </main>
  );
}
