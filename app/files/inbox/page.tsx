import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { serverEntity } from "@/lib/serverVenue";
import { EntityKey, ENTITY_SHORT } from "@/lib/entities";
import FilesInboxClient, { InboxRow } from "./FilesInboxClient";

export const dynamic = "force-dynamic";

const ENTITY_CODE: Record<EntityKey, string> = {
  holdings: "BBH",
  bistro_mondo: "BM",
  taller: "IFL",
  utopia: "IFL",
};

// /files/inbox — the triage front-end for auto-ingested attachments.
//
// The inbox sits ahead of /files (library). Attachments from admin@
// mailboxes auto-arrive, Anthropic vision classifies them, they queue
// here for Boris to confirm before promotion to files_documents.
export default async function FilesInboxPage() {
  const sb = supabaseServer();
  const entity = serverEntity();
  const ec = ENTITY_CODE[entity] || "IFL";

  // Grouped fetch — we load all four buckets in one round trip. Rows with a
  // null suggested_entity are visible to every operator (helps unclogging
  // classifier ambiguity).
  const { data, error } = await sb.from("files_inbox")
    .select("id,source,source_ref,sender,subject,received_at,file_url,file_bytes,mime_type,thumbnail_url,suggested_category,suggested_entity,suggested_title,suggested_valid_until,classification_confidence,classification_rationale,status,filed_document_id,created_at,triaged_at,triaged_by")
    .or(`suggested_entity.eq.${ec},suggested_entity.is.null`)
    .order("received_at", { ascending: false })
    .limit(400);

  const rows: InboxRow[] = (data as any) || [];

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/files" className="font-mono text-[10px] uppercase tracking-wide text-clay">← files library</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide text-clay">Files · inbox</p>
      <div className="mt-2 flex items-baseline justify-between gap-4">
        <h1 className="font-serif text-4xl leading-tight text-ink">The triage table.</h1>
        <Link
          href="/files"
          className="font-mono text-[10px] uppercase tracking-wide text-ink hover:underline decoration-black/20 underline-offset-2"
        >
          library →
        </Link>
      </div>
      <p className="mt-2 font-serif italic text-[15px] text-ink-soft">
        Attachments from admin@bistro-mondo and admin@ibzfoodstudio auto-arrive here.
        Confirm a category and file it — nothing lands in the library without your say-so.
      </p>

      {error ? (
        <p className="mt-4 border-l-2 border-tomato pl-3 font-mono text-[10px] uppercase tracking-wide text-tomato">
          Couldn't read the inbox: {String(error.message || error)}
        </p>
      ) : null}

      <FilesInboxClient rows={rows} entityCode={ec} entityLabel={ENTITY_SHORT[entity]} />
    </main>
  );
}
