// Chef v3 Phase 2 S7 — the PA inbox materialiser.
//
// `run_agent` (and anything else that briefs an agent from inside the OS)
// queues a `pa_inbox_notes` row holding the full `TO_<AGENT>_<slug>_<date>.md`
// body. The OS runs on Vercel and cannot write into the workspace folder
// `06_PA/_INBOX/` (that folder lives on Boris's machine; the Drive client is
// still a stub), so the note is materialised into the private Storage bucket
// `pa_inbox` as `<filename>` and the row is marked `materialised_at`. The PA
// session then syncs the bucket into `06_PA/_INBOX/` and sets `synced_at`.
//
// Two callers: /api/chef/act right after queueing (best-effort, user
// session) and /api/cron/pa-inbox (service role sweep for stragglers).

import type { SupabaseClient } from "@supabase/supabase-js";

export const PA_INBOX_BUCKET = "pa_inbox";

export type MaterialiseResult = { scanned: number; written: number; failed: number; files: string[]; errors: string[] };

function safeName(name: string): string {
  const base = String(name || "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+/, "").slice(0, 140) || "note.md";
  return base.endsWith(".md") ? base : base + ".md";
}

export async function materialiseNotes(sb: SupabaseClient, opts?: { ids?: string[]; limit?: number }): Promise<MaterialiseResult> {
  const out: MaterialiseResult = { scanned: 0, written: 0, failed: 0, files: [], errors: [] };
  let q = sb.from("pa_inbox_notes").select("id, filename, body_md, status, materialised_at").eq("status", "pending").order("created_at").limit(opts?.limit || 50);
  if (opts?.ids?.length) q = q.in("id", opts.ids);
  const { data: rows, error } = await q;
  if (error) { out.errors.push(error.message); return out; }
  for (const r of rows || []) {
    out.scanned++;
    const path = safeName((r as any).filename);
    try {
      const body = String((r as any).body_md || "");
      const up = await sb.storage.from(PA_INBOX_BUCKET).upload(path, new Blob([body], { type: "text/markdown" }), { contentType: "text/markdown; charset=utf-8", upsert: true });
      if (up.error) throw new Error(up.error.message);
      const { error: updErr } = await sb.from("pa_inbox_notes").update({
        status: "written", materialised_at: new Date().toISOString(), storage_path: PA_INBOX_BUCKET + "/" + path, written_at: new Date().toISOString(), error: null,
      }).eq("id", (r as any).id);
      if (updErr) throw new Error(updErr.message);
      out.written++; out.files.push(path);
    } catch (e: any) {
      out.failed++;
      const msg = String(e?.message || e).slice(0, 300);
      out.errors.push(path + ": " + msg);
      // Leave it pending for the sweep; record why.
      await sb.from("pa_inbox_notes").update({ error: msg }).eq("id", (r as any).id);
    }
  }
  return out;
}
