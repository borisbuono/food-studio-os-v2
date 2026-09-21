import { supabaseService } from "@/lib/supabaseService";
import { extractClientIp, hashIp } from "@/lib/leads/rateLimit";
import { parseCv, retainUntil, type CvProfile } from "@/lib/hiring-sop";
import { mirrorColumns, rescore } from "@/lib/hiring-sop-server";
import type { ApplyAnswers } from "@/lib/hiring-apply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/public/apply/<slug>   multipart/form-data — the public application.
// No account. Guarded by: honeypot, consent required, 3 per IP per hour,
// 10 MB CV cap, slug must be a house with hiring enabled.
// Writes with the service role (candidates are membership-scoped under RLS).
// Sends nothing to anyone.

const MAX = 10 * 1024 * 1024;
const OK_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"]);
const s = (v: FormDataEntryValue | null, n: number) => String(v ?? "").trim().slice(0, n);

export async function POST(req: Request, { params }: { params: { house: string } }) {
  const sb = supabaseService();
  if (!sb) return Response.json({ ok: false, error: "Applications are closed right now." }, { status: 503 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "Could not read the form." }, { status: 400 });
  }
  // Honeypot: bots fill every field. Pretend success.
  if (s(form.get("company"), 200)) return Response.json({ ok: true });

  const { data: ent } = await sb
    .from("entities")
    .select("id, name, hiring_enabled")
    .eq("slug", params.house)
    .maybeSingle();
  if (!ent || ent.hiring_enabled === false) return Response.json({ ok: false, error: "Unknown kitchen." }, { status: 404 });

  const name = s(form.get("name"), 200);
  const email = s(form.get("email"), 200);
  const phone = s(form.get("phone"), 50);
  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !phone)
    return Response.json({ ok: false, error: "Name, email and phone are required." }, { status: 400 });
  if (form.get("consent") !== "yes") return Response.json({ ok: false, error: "Please accept the privacy notice." }, { status: 400 });

  const ipHash = hashIp(extractClientIp(req));
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await sb
    .from("candidates")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);
  if ((count ?? 0) >= 3) return Response.json({ ok: false, error: "Too many applications from this connection — try again later." }, { status: 429 });

  const f = form.get("file");
  let file: { bytes: Uint8Array; base64: string; mediaType: string } | null = null;
  if (f instanceof Blob && f.size > 0) {
    if (f.size > MAX) return Response.json({ ok: false, error: "The CV is over 10 MB." }, { status: 400 });
    const mediaType = (f as any).type || "application/pdf";
    if (!OK_TYPES.has(mediaType)) return Response.json({ ok: false, error: "CV must be a PDF or a photo." }, { status: 400 });
    const bytes = new Uint8Array(await f.arrayBuffer());
    file = { bytes, base64: Buffer.from(bytes).toString("base64"), mediaType };
  }

  const a: ApplyAnswers = {
    right_to_work: (["yes", "no", "in_progress"].includes(s(form.get("right_to_work"), 20)) ? s(form.get("right_to_work"), 20) : "") as any,
    start_date: s(form.get("start_date"), 20),
    notice: s(form.get("notice"), 200),
    salary: s(form.get("salary"), 200),
    weekends: (["yes", "no", "some"].includes(s(form.get("weekends"), 10)) ? s(form.get("weekends"), 10) : "") as any,
    lives_where: s(form.get("lives_where"), 200),
    transport: s(form.get("transport"), 200),
    references: s(form.get("references"), 1000),
    station: s(form.get("station"), 300),
    allergen_training: (["yes", "no"].includes(s(form.get("allergen_training"), 10)) ? s(form.get("allergen_training"), 10) : "") as any,
    note: s(form.get("note"), 4000),
  };
  const opening = s(form.get("job_opening_id"), 60);
  let job_opening_id: string | null = null;
  if (opening) {
    const { data: o } = await sb.from("job_openings").select("id").eq("id", opening).eq("entity_id", ent.id).eq("status", "open").maybeSingle();
    job_opening_id = (o?.id as string) || null;
  }

  const now = new Date().toISOString();
  const { data: cand, error } = await sb
    .from("candidates")
    .insert({
      entity_id: ent.id,
      job_opening_id,
      name,
      email,
      phone,
      source: s(form.get("source"), 40) || "apply_page",
      source_ref: s(form.get("utm"), 200) || null,
      notes: a.note || null,
      answers: a,
      status: "new",
      status_history: [{ at: now, to: "new", by: null, reason: "applied via /apply page" }],
      ip_hash: ipHash,
      consent_at: now,
      retain_until: retainUntil(),
    })
    .select("id")
    .single();
  if (error || !cand) return Response.json({ ok: false, error: "Could not save — please try again." }, { status: 500 });
  const id = cand.id as string;

  const lines = [
    `Right to work: ${a.right_to_work || "—"}`,
    `Start: ${a.start_date || "—"}${a.notice ? ` (notice: ${a.notice})` : ""}`,
    `Salary: ${a.salary || "—"}`,
    `Weekends/holidays: ${a.weekends || "—"}`,
    `Lives: ${a.lives_where || "—"} · Transport: ${a.transport || "—"}`,
    `References: ${a.references || "—"}`,
    `Strongest station / wants to grow: ${a.station || "—"}`,
    `Allergen & food-handling training: ${a.allergen_training || "—"}`,
    a.note ? `\n${a.note}` : "",
  ].join("\n");
  await sb.from("candidate_touches").insert({
    candidate_id: id,
    channel: "apply_page",
    direction: "inbound",
    kind: "reply",
    body: lines,
    notes: "applied via the public page — answers included",
  });

  if (file) {
    const ext = file.mediaType === "application/pdf" ? "pdf" : file.mediaType.split("/")[1] || "jpg";
    const path = `${ent.id}/${id}.${ext}`;
    const up = await sb.storage.from("hiring-cvs").upload(path, file.bytes, { contentType: file.mediaType, upsert: true });
    if (!up.error) await sb.from("candidates").update({ cv_path: path }).eq("id", id);
  }

  // What the candidate declared is fact at confidence 1; the CV fills the rest.
  const F = (value: any) => (value === "" || value == null ? undefined : { value, confidence: 1 });
  const declared: Partial<CvProfile> = {
    name: F(name),
    email: F(email),
    phone: F(phone),
    right_to_work: F(a.right_to_work === "in_progress" ? "unknown" : a.right_to_work),
    availability: F([a.start_date && `from ${a.start_date}`, a.notice && `notice: ${a.notice}`].filter(Boolean).join(", ")),
    salary_expectation: F(a.salary),
    weekends: F(a.weekends === "" ? "" : a.weekends !== "no"),
    location: F(a.lives_where),
    transport: F(a.transport),
    references: F(a.references),
    station_preference: F(a.station),
    allergen_training: F(a.allergen_training),
  } as any;
  for (const k of Object.keys(declared)) if ((declared as any)[k] === undefined) delete (declared as any)[k];

  let profile: Partial<CvProfile> = declared;
  let summary: string | null = null;
  const flags: string[] = [];
  if (a.right_to_work === "in_progress") flags.push("right to work: permit in progress");
  try {
    const parsed = await parseCv(file ? { base64: file.base64, mediaType: file.mediaType } : null, `${a.note}\nLives: ${a.lives_where}`);
    profile = { ...parsed.profile, ...declared };
    summary = parsed.summary;
  } catch (e: any) {
    flags.push("CV not read automatically — " + (e?.message || "error"));
  }
  await sb
    .from("candidates")
    .update({ profile, summary, parsed_at: new Date().toISOString(), ...mirrorColumns(profile), phone, email })
    .eq("id", id);
  await rescore(sb, id);
  if (flags.length) {
    const { data: cur } = await sb.from("candidates").select("review_flags").eq("id", id).single();
    await sb.from("candidates").update({ review_flags: [...((cur?.review_flags as string[]) || []), ...flags] }).eq("id", id);
  }
  return Response.json({ ok: true });
}
