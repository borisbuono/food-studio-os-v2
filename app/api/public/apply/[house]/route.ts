import { extractClientIp, hashIp } from "@/lib/leads/rateLimit";
import { parseCv, readPerson, retainUntil, reviewFlags, scoreCandidate, type CvProfile } from "@/lib/hiring-sop";
import { mirrorColumns } from "@/lib/hiring-sop-server";
import { applyClient, EXTRA_PERSON_Q, KIND_LABEL, PERSON_Q, SIGNATURE_Q, WORK_STYLE, workStyleLines, type ApplyAnswers, type ApplyKind, type ApplyPageInfo } from "@/lib/hiring-apply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/public/apply/<slug>   multipart/form-data — the public application.
// No account, no service-role key: writes go through the apply_submit /
// apply_finish SECURITY DEFINER functions, the CV through a one-shot anon
// upload rule. Guards: honeypot, consent, 3/connection/hour + per-house caps
// (in SQL), 10 MB, PDF or image. Sends nothing to anyone.

const MAX = 10 * 1024 * 1024;
const OK_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"]);
const s = (v: FormDataEntryValue | null, n: number) => String(v ?? "").trim().slice(0, n);
const pick = <T extends string>(v: string, allowed: T[]) => (allowed.includes(v as T) ? (v as T) : ("" as T));

export async function POST(req: Request, { params }: { params: { house: string } }) {
  const sb = applyClient();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "Could not read the form." }, { status: 400 });
  }
  if (s(form.get("company"), 200)) return Response.json({ ok: true }); // honeypot
  if (form.get("consent") !== "yes") return Response.json({ ok: false, error: "Please accept the privacy notice." }, { status: 400 });

  const { data: info } = await sb.rpc("apply_page_info", { p_slug: params.house });
  const house = info as ApplyPageInfo | null;
  if (!house?.id) return Response.json({ ok: false, error: "Unknown kitchen." }, { status: 404 });

  const name = s(form.get("name"), 200);
  const email = s(form.get("email"), 200);
  const phone = s(form.get("phone"), 50);

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
    area: pick(s(form.get("area"), 10), ["cocina", "sala"]) || "cocina",
    kind: pick(s(form.get("kind"), 10), ["job", "stage_1d", "stage_3d", "stage_1w"]) || "job",
    stage_dates: s(form.get("stage_dates"), 300),
    right_to_work: pick(s(form.get("right_to_work"), 20), ["yes", "no", "in_progress"]),
    start_date: s(form.get("start_date"), 20),
    notice: s(form.get("notice"), 200),
    salary: s(form.get("salary"), 200),
    weekends: pick(s(form.get("weekends"), 10), ["yes", "no", "some"]),
    lives_where: s(form.get("lives_where"), 200),
    transport: s(form.get("transport"), 200),
    references: s(form.get("references"), 1000),
    station: s(form.get("station"), 300),
    allergen_training: pick(s(form.get("allergen_training"), 10), ["yes", "no"]),
    schedule: pick(s(form.get("schedule"), 10), ["full", "extras"]),
    food_handler: pick(s(form.get("food_handler"), 10), ["yes", "no", "expired"]),
    craft1: s(form.get("craft1"), 2000),
    craft2: s(form.get("craft2"), 2000),
    p_hard: s(form.get("p_hard"), 2000),
    p_love: s(form.get("p_love"), 2000),
    p_mirror: s(form.get("p_mirror"), 2000),
    p_curious: s(form.get("p_curious"), 2000),
    p_team: s(form.get("p_team"), 2000),
    p_why: s(form.get("p_why"), 2000),
    p_proud: s(form.get("p_proud"), 2000),
    work_style: (() => {
      try {
        const raw = JSON.parse(String(form.get("work_style") || "{}"));
        const out: Record<string, "a" | "b"> = {};
        for (const w of WORK_STYLE) if (raw?.[w.k] === "a" || raw?.[w.k] === "b") out[w.k] = raw[w.k];
        return out;
      } catch {
        return {};
      }
    })(),
    note: s(form.get("note"), 4000),
  };
  const area = a.area === "sala" ? "sala" : "cocina";
  const qa = [
    { q: SIGNATURE_Q[area].es, a: a.craft1 },
    ...PERSON_Q.map((x) => ({ q: x.es(area), a: a[x.k] })),
    { q: EXTRA_PERSON_Q.p_why.es, a: a.p_why },
    { q: EXTRA_PERSON_Q.p_proud.es, a: a.p_proud },
    { q: "Forma de trabajar (elegido entre dos opciones)", a: workStyleLines(a.work_style, "es").join("\n") },
  ];
  const isStage = a.kind !== "job";
  const touch = [
    `${a.area === "sala" ? "SALA" : "COCINA"} · ${KIND_LABEL[(a.kind || "job") as ApplyKind].es.toUpperCase()}${isStage && a.stage_dates ? ` · fechas: ${a.stage_dates}` : ""}`,
    `Right to work: ${a.right_to_work || "—"}`,
    `Start: ${a.start_date || "—"}${a.notice ? ` (notice: ${a.notice})` : ""}`,
    `Salary: ${a.salary || "—"}`,
    `Weekends/holidays: ${a.weekends || "—"}`,
    `Lives: ${a.lives_where || "—"} · Transport: ${a.transport || "—"}`,
    `References: ${a.references || "—"}`,
    `Allergen training: ${a.allergen_training || "—"} · Carnet manipulador: ${a.food_handler || "—"}`,
    a.kind === "job" ? `Jornada: ${a.schedule || "—"}` : "",
    ...qa.map((x) => `\n— ${x.q}\n${x.a || "(sin respuesta)"}`),
    a.note ? `\n— Nota\n${a.note}` : "",
  ].join("\n");

  const openingId = s(form.get("job_opening_id"), 60);
  const { data: sub, error } = await sb.rpc("apply_submit", {
    p_slug: params.house,
    p_name: name,
    p_email: email,
    p_phone: phone,
    p_answers: a,
    p_opening: /^[0-9a-f-]{36}$/.test(openingId) ? openingId : null,
    p_ip_hash: hashIp(extractClientIp(req)),
    p_source: s(form.get("source"), 40) || "apply_page",
    p_utm: s(form.get("utm"), 200),
    p_notes: a.note,
    p_touch: touch,
    p_retain: retainUntil(),
  });
  if (error || !sub) {
    const msg = String(error?.message || "");
    if (msg.includes("rate limited")) return Response.json({ ok: false, error: "Too many applications right now — try again later." }, { status: 429 });
    if (msg.includes("required")) return Response.json({ ok: false, error: "Name, email and phone are required." }, { status: 400 });
    return Response.json({ ok: false, error: "Could not save — please try again." }, { status: 500 });
  }
  const { id, entity_id, token } = sub as { id: string; entity_id: string; token: string };

  // From here the application is saved. Everything below is best-effort.
  let cvPath: string | null = null;
  if (file) {
    const ext = file.mediaType === "application/pdf" ? "pdf" : file.mediaType.split("/")[1] || "jpg";
    const path = `${entity_id}/${id}.${ext}`;
    const up = await sb.storage.from("hiring-cvs").upload(path, file.bytes, { contentType: file.mediaType, upsert: false });
    if (!up.error) cvPath = path;
  }

  const F = (value: any) => (value === "" || value == null ? undefined : { value, confidence: 1 });
  const declared: Record<string, any> = {
    name: F(name),
    email: F(email),
    phone: F(phone),
    right_to_work: F(a.right_to_work === "in_progress" ? "unknown" : a.right_to_work),
    availability: F(
      isStage
        ? `${KIND_LABEL[a.kind as ApplyKind].en}${a.stage_dates ? ` — ${a.stage_dates}` : ""}`
        : [a.start_date && `from ${a.start_date}`, a.notice && `notice: ${a.notice}`].filter(Boolean).join(", ")
    ),
    salary_expectation: F(a.salary),
    weekends: a.weekends ? { value: a.weekends !== "no", confidence: 1 } : undefined,
    location: F(a.lives_where),
    transport: F(a.transport),
    references: F(a.references),
    station_preference: F(a.station),
    allergen_training: F(a.allergen_training),
    food_handler: F(a.food_handler),
    schedule: F(a.schedule),
  };
  for (const k of Object.keys(declared)) if (declared[k] === undefined) delete declared[k];

  let profile = declared as Partial<CvProfile>;
  let summary: string | null = null;
  const extra: string[] = [];
  if (a.right_to_work === "in_progress") extra.push("right to work: permit in progress");
  if (isStage) extra.push(`${KIND_LABEL[a.kind as ApplyKind].en} request (educational, fee) — confirm fee + invoice + insurance; no productive work unless on contract/alta`);
  if (file && !cvPath) extra.push("CV upload failed — ask them to resend");
  const [cvRes, personRes] = await Promise.allSettled([
    parseCv(file ? { base64: file.base64, mediaType: file.mediaType } : null, `${a.note}\nLives: ${a.lives_where}`),
    readPerson(area, qa),
  ]);
  if (cvRes.status === "fulfilled") {
    profile = { ...cvRes.value.profile, ...declared } as Partial<CvProfile>;
    summary = cvRes.value.summary;
  } else {
    extra.push("CV not read automatically — " + ((cvRes.reason as any)?.message || "error"));
  }
  if (personRes.status === "fulfilled" && personRes.value) {
    (profile as any).people_read = { value: personRes.value, confidence: 1 };
  }
  if (a.food_handler !== "yes") extra.push(a.food_handler === "expired" ? "carnet de manipulador expired" : "no carnet de manipulador declared");
  const opening = house.openings.find((o) => o.id === openingId) || null;
  const { score, reasons } = scoreCandidate(profile, opening, a.area);
  const m = mirrorColumns(profile) as Record<string, any>;
  await sb.rpc("apply_finish", {
    p_id: id,
    p_token: token,
    p_profile: profile,
    p_summary: summary,
    p_score: score,
    p_reasons: reasons,
    p_flags: [...reviewFlags(profile), ...extra],
    p_cv_path: cvPath,
    p_languages: m.languages ?? null,
    p_years: m.years_experience ?? null,
    p_rtw: m.right_to_work ?? null,
    p_location: m.location ?? null,
    p_availability: m.availability ?? null,
  });
  return Response.json({ ok: true });
}
