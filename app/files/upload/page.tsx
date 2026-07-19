import Link from "next/link";
import { serverEntity } from "@/lib/serverVenue";
import { EntityKey, ENTITY_SHORT } from "@/lib/entities";
import FilesUploadForm from "./FilesUploadForm";

export const dynamic = "force-dynamic";

const ENTITY_CODE: Record<EntityKey, string> = { holdings: "BBH", bistro_mondo: "BM", taller: "IFL", utopia: "IFL" };

// /files/upload — upload form. Client component does the heavy lifting
// (Supabase Storage upload + files_documents insert). The page shell here
// just frames it.
export default async function FilesUploadPage() {
  const entity = serverEntity();
  const ec = ENTITY_CODE[entity] || "IFL";
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/files" className="font-mono text-[10px] uppercase tracking-wide text-clay">← files</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>
        Upload · to {ENTITY_SHORT[entity]}
      </p>
      <h1 className="mt-2 font-serif text-4xl leading-tight text-ink">Drop a document.</h1>
      <p className="mt-2 font-serif italic text-[15px] text-ink-soft">
        PDF, image, or spreadsheet. Tag it so someone else can find it in six months.
      </p>

      <FilesUploadForm entityCode={ec} />
    </main>
  );
}
