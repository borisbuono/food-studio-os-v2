import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import FileDetailClient from "./FileDetailClient";

export const dynamic = "force-dynamic";

// /files/[id] — file detail. Shows metadata + download + tag edit +
// archive. The download URL is created client-side because storage signed
// URLs need a live browser session.
export default async function FilePage({ params }: { params: { id: string } }) {
  const sb = supabaseServer();
  const { data: doc } = await sb.from("files_documents").select("*").eq("id", params.id).maybeSingle();
  if (!doc) notFound();
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/files" className="font-mono text-[10px] uppercase tracking-wide text-clay">← files</Link>
      <FileDetailClient doc={doc as any} />
    </main>
  );
}
