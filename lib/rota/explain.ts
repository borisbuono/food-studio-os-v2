// lib/rota/explain.ts — phrase a rota proposal in one short paragraph.
//
// The arithmetic is done in SQL (fn_rota_propose). Haiku may only put words to
// the numbers it is handed — never invent a saving or a cover count. Without a
// key, or on any error, a plain template is used. Nobody has to know which.

const MODEL = process.env.FS_ROTA_EXPLAIN_MODEL || "claude-haiku-4-5-20251001";

type Item = { name: string | null; service_date: string; area: string; start: string; end: string; saving_eur: number; reason: string; status: string };
type Warn = { service_date: string; area: string; have: number; need: number; covers: number };

export function templateExplanation(p: { before_eur: number; after_eur: number; items: Item[]; warnings: Warn[] }, lang: "es" | "en"): string {
  const open = p.items.filter((i) => i.status === "proposed");
  const saving = Math.round((p.before_eur - p.after_eur) * 100) / 100;
  if (lang === "es") {
    if (!open.length) return p.warnings.length ? `Sin ahorro propuesto. ${p.warnings.length} día(s) por debajo del mínimo de personal.` : "El plan ya está en el mínimo para la previsión. Nada que quitar.";
    return `${open.length} turno(s) sobran para la previsión: −${saving.toFixed(0)} € sobre ${p.before_eur.toFixed(0)} €. Cada cambio se acepta por separado.${p.warnings.length ? ` Ojo: ${p.warnings.length} día(s) quedan por debajo del mínimo.` : ""}`;
  }
  if (!open.length) return p.warnings.length ? `No saving proposed. ${p.warnings.length} day(s) sit below the staffing minimum.` : "The plan is already at the minimum for the forecast. Nothing to take out.";
  return `${open.length} shift(s) exceed the forecast need: −${saving.toFixed(0)} € on ${p.before_eur.toFixed(0)} €. Each change is accepted on its own.${p.warnings.length ? ` Note: ${p.warnings.length} day(s) are below the minimum.` : ""}`;
}

export async function explainProposal(p: { before_eur: number; after_eur: number; items: Item[]; warnings: Warn[] }, lang: "es" | "en"): Promise<string> {
  const fallback = templateExplanation(p, lang);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fallback;
  try {
    const facts = {
      before_eur: p.before_eur, after_eur: p.after_eur,
      changes: p.items.filter((i) => i.status === "proposed").map((i) => ({ day: i.service_date, area: i.area, hours: i.start + "-" + i.end, saving_eur: i.saving_eur, why: i.reason })),
      under_minimum: p.warnings,
    };
    const prompt = `You write ONE short paragraph (max 60 words, ${lang === "es" ? "Spanish" : "English"}, plain, no bullet points, no names of people) for a restaurant manager, explaining this rota suggestion. Use ONLY these numbers; do not invent any. Say it is a suggestion they accept per change.\n${JSON.stringify(facts)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctrl.signal,
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 200, temperature: 0, messages: [{ role: "user", content: prompt }] }),
    });
    clearTimeout(t);
    if (!r.ok) return fallback;
    const j = await r.json();
    const text = String(j?.content?.[0]?.text || "").trim();
    return text && text.length < 600 ? text : fallback;
  } catch { return fallback; }
}
