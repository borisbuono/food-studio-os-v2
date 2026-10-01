// lib/rota/explain.ts — phrase a rota proposal in one short paragraph.
//
// The arithmetic is done in SQL (fn_rota_propose). Haiku may only put words to
// the numbers it is handed — never invent a saving or a cover count. Without a
// key, or on any error, a plain template is used. Nobody has to know which.

const MODEL = process.env.FS_ROTA_EXPLAIN_MODEL || "claude-haiku-4-5-20251001";

type Item = { action?: string; service?: string; name?: string | null; service_date: string; area: string; start?: string; end?: string; saving_eur?: number; eur_delta?: number; minutes?: number; reason: string; status: string };
type Warn = { service_date: string; area: string; have: number; need: number; covers: number };

export function templateExplanation(p: { before_eur: number; after_eur: number; items: Item[]; warnings: Warn[] }, lang: "es" | "en"): string {
  const open = p.items.filter((i) => i.status === "proposed");
  const cuts = open.filter((i) => Number(i.eur_delta ?? -(i.saving_eur || 0)) < 0);
  const adds = open.filter((i) => Number(i.eur_delta ?? 0) > 0);
  const out = Math.abs(cuts.reduce((n, i) => n + Number(i.eur_delta ?? -(i.saving_eur || 0)), 0));
  const inn = adds.reduce((n, i) => n + Number(i.eur_delta || 0), 0);
  const net = Math.round((p.after_eur - p.before_eur) * 100) / 100;
  if (lang === "es") {
    if (!open.length) return "El plan ya cuadra con la previsión por servicio. Nada que mover.";
    return `${cuts.length ? `${cuts.length} servicio(s) con horas de sobra (−${out.toFixed(0)} €)` : ""}${cuts.length && adds.length ? " · " : ""}${adds.length ? `${adds.length} servicio(s) cortos (+${inn.toFixed(0)} €)` : ""}. Neto ${net > 0 ? "+" : ""}${net.toFixed(0)} € sobre ${p.before_eur.toFixed(0)} €. Cada línea se acepta por separado; quién cubre una hora nueva lo eliges tú.`;
  }
  if (!open.length) return "The plan already matches the forecast, service by service. Nothing to move.";
  return `${cuts.length ? `${cuts.length} service(s) with hours to take out (−${out.toFixed(0)} €)` : ""}${cuts.length && adds.length ? " · " : ""}${adds.length ? `${adds.length} service(s) short (+${inn.toFixed(0)} €)` : ""}. Net ${net > 0 ? "+" : ""}${net.toFixed(0)} € on ${p.before_eur.toFixed(0)} €. Each line is accepted on its own; who covers a new hour is your call.`;
}

export async function explainProposal(p: { before_eur: number; after_eur: number; items: Item[]; warnings: Warn[] }, lang: "es" | "en"): Promise<string> {
  const fallback = templateExplanation(p, lang);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return fallback;
  try {
    const facts = {
      before_eur: p.before_eur, after_eur: p.after_eur,
      changes: p.items.filter((i) => i.status === "proposed").slice(0, 40).map((i) => ({ action: i.action, day: i.service_date, service: i.service, area: i.area, hours: (i.start || "") + "-" + (i.end || ""), eur_delta: i.eur_delta ?? -(i.saving_eur || 0), why: i.reason })),
      under_minimum: p.warnings,
    };
    const prompt = `You write ONE short paragraph (max 60 words, ${lang === "es" ? "Spanish" : "English"}, plain, no bullet points, no names of people) for a restaurant manager, explaining this rota suggestion: where hours come out and where hours are missing, per service. Use ONLY these numbers; do not invent any. Say it is a suggestion they accept line by line.\n${JSON.stringify(facts)}`;
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
