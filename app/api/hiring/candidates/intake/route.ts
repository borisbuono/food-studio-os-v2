import { supabaseServer } from "@/lib/supabaseServer";
import { firstName, retainUntil } from "@/lib/hiring-sop";
import { runCvPipeline } from "@/lib/hiring-sop-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/hiring/candidates/intake   (multipart/form-data)
//   entity_id        required
//   file             CV (pdf / jpg / png)  — optional if note carries it all
//   note             cover email text
//   job_opening_id   optional
//   source           email | whatsapp | walk_in | portal | referral …  (default email)
//   source_ref       e.g. gmail thread id
//   name             optional — otherwise read from the CV
//   candidate_id     optional — attach the CV to an existing candidate and re-parse
//
// Creates / updates the candidate, stores the CV privately, reads it,
// scores it, and drafts the screening questions. Sends nothing.

const MAX = 10 * 1024 * 1024;

export async function POST(req: Request) {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return Response.json({ ok: false, error: "unauthenticated" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "send multipart/form-data" }, { status: 400 });
  }
  const entity_id = String(form.get("entity_id") || "").trim();
  if (!entity_id) return Response.json({ ok: false, error: "entity_id required" }, { status: 400 });
  const { data: mem } = await sb.rpc("fn_is_entity_member", { uid, ent: entity_id });
  if (!mem) return Response.json({ ok: false, error: "not a member of this entity" }, { status: 403 });

  const note = String(form.get("note") || "").slice(0, 8000);
  const f = form.get("file");
  let file: { base64: string; mediaType: string; bytes: Uint8Array; name: string } | null = null;
  if (f instanceof Blob && f.size > 0) {
    if (f.size > MAX) return Response.json({ ok: false, error: "CV over 10 MB" }, { status: 400 });
    const bytes = new Uint8Array(await f.arrayBuffer());
    file = {
      bytes,
      base64: Buffer.from(bytes).toString("base64"),
      mediaType: (f as any).type || "application/pdf",
      name: String((f as any).name || "cv.pdf"),
    };
  }
  if (!file && !note.trim()) return Response.json({ ok: false, error: "attach a CV or paste the message" }, { status: 400 });

  let candidate_id = String(form.get("candidate_id") || "").trim();
  if (!candidate_id) {
    const source = String(form.get("source") || "email").slice(0, 40);
    const { data: c, error } = await sb
      .from("candidates")
      .insert({
        entity_id,
        job_opening_id: String(form.get("job_opening_id") || "") || null,
        name: String(form.get("name") || "").trim().slice(0, 200) || "(reading CV…)",
        source,
        source_ref: String(form.get("source_ref") || "").slice(0, 200) || null,
        notes: note ? note.slice(0, 4000) : null,
        status: "new",
        status_history: [{ at: new Date().toISOString(), to: "new", by: uid, reason: "CV intake" }],
        retain_until: retainUntil(),
      })
      .select("id")
      .single();
    if (error || !c) return Response.json({ ok: false, error: error?.message || "insert failed" }, { status: 500 });
    candidate_id = c.id as string;
    await sb.from("candidate_touches").insert({
      candidate_id, channel: source, direction: "inbound", notes: "application received", by_user: uid,
    });
  }

  if (file) {
    const ext = file.mediaType === "application/pdf" ? "pdf" : file.name.split(".").pop() || "bin";
    const path = `${entity_id}/${candidate_id}.${ext}`;
    const up = await sb.storage.from("hiring-cvs").upload(path, file.bytes, { contentType: file.mediaType, upsert: true });
    if (up.error) return Response.json({ ok: false, error: `CV upload: ${up.error.message}`, candidate_id }, { status: 500 });
    await sb.from("candidates").update({ cv_path: path }).eq("id", candidate_id);
  }

  try {
    const out = await runCvPipeline(sb, candidate_id, uid, file, note);
    const name = out.profile?.name?.value;
    if (name) {
      const { data: cur } = await sb.from("candidates").select("name").eq("id", candidate_id).single();
      if (cur?.name === "(reading CV…)") await sb.from("candidates").update({ name: String(name).slice(0, 200) }).eq("id", candidate_id);
    }
    const { data: cand } = await sb.from("candidates").select("*").eq("id", candidate_id).single();
    return Response.json({ ok: true, candidate: cand, draft: out.draft, first_name: firstName(String(cand?.name || "")) });
  } catch (e: any) {
    // Candidate + CV are saved; parse can be retried from the drawer.
    await sb.from("candidates").update({ review_flags: ["CV not read automatically — " + (e?.message || "error")] }).eq("id", candidate_id);
    const { data: cand } = await sb.from("candidates").select("*").eq("id", candidate_id).single();
    return Response.json({ ok: true, candidate: cand, parse_error: e?.message || "parse failed" });
  }
}
