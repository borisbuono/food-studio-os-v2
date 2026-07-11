// Recipe parser — converts free-form recipe text (Spanish, English, or mixed)
// into a structured payload the OS can persist. Powered by Anthropic Haiku
// so parses are cheap and fast; falls back to a heuristic parser when
// ANTHROPIC_API_KEY is not present (dev / preview).
//
// Contract: parseRecipeContent(raw) returns a ParsedRecipe with per-field
// confidence so the UI can highlight low-confidence fields for review.

export type ParsedIngredient = {
  ingredient_name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
  is_optional: boolean;
  order_idx: number;
};

export type ParsedStep = {
  order_idx: number;
  body: string;
  minutes: number | null;
  temperature_c: number | null;
};

export type ParsedRecipe = {
  title: string;
  yield_grams: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  servings: number | null;
  difficulty: number | null;
  ingredients: ParsedIngredient[];
  steps: ParsedStep[];
  notes: string | null;
  confidence: {
    title: number;
    yield: number;
    times: number;
    servings: number;
    ingredients: number;
    steps: number;
  };
  language: "en" | "es" | "mixed";
  parser: "haiku" | "heuristic";
};

const HAIKU_MODEL = "claude-haiku-4-5";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

const SYSTEM_PROMPT = `You are a strict recipe parser for a professional kitchen management system used by Food Studios (Ibiza).

You receive raw recipe text (Spanish, English, or a mix — chef notes, OCR'd PDFs, Word docs, WhatsApp copy-paste). You return a single JSON object matching the exact schema below. No prose, no markdown fences, no commentary.

Rules:
- Preserve the original language of ingredient names (do not translate).
- Convert obvious units to their canonical short form (g, kg, ml, l, tsp, tbsp, unit).
- If a quantity is a range ("2-3 cloves"), take the midpoint (2.5) and put the original in notes.
- If a value is unknown, use null (never guess).
- servings: number of plates the recipe yields; yield_grams: total finished weight when stated.
- difficulty: 1 (mise-en-place) to 5 (multi-day fermentation / advanced technique).
- steps: split by clear method transitions; each step is one action.
- confidence values: 0.0 - 1.0 per field group, based on how clearly the input stated each.
- language: "en", "es", or "mixed".

Schema:
{
  "title": string,
  "yield_grams": number | null,
  "prep_minutes": number | null,
  "cook_minutes": number | null,
  "servings": number | null,
  "difficulty": number | null,
  "ingredients": [{"ingredient_name": string, "quantity": number | null, "unit": string | null, "notes": string | null, "is_optional": boolean, "order_idx": number}],
  "steps": [{"order_idx": number, "body": string, "minutes": number | null, "temperature_c": number | null}],
  "notes": string | null,
  "confidence": {"title": number, "yield": number, "times": number, "servings": number, "ingredients": number, "steps": number},
  "language": "en" | "es" | "mixed"
}`;

export async function parseRecipeContent(raw: string): Promise<ParsedRecipe> {
  const cleaned = (raw || "").trim();
  if (!cleaned) throw new Error("Empty recipe content");

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return heuristicParse(cleaned);

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: cleaned }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const j: any = await res.json();
    const text: string = j?.content?.[0]?.text || "";
    const jsonBlock = extractJson(text);
    const parsed = JSON.parse(jsonBlock) as Omit<ParsedRecipe, "parser">;
    return { ...normalize(parsed), parser: "haiku" };
  } catch (e) {
    // Fall back rather than error the whole import — the heuristic is
    // deliberately conservative and lets a human finish the parse in the UI.
    const fb = heuristicParse(cleaned);
    fb.notes = (fb.notes ? fb.notes + "\n\n" : "") + `Auto-parse fell back to heuristic: ${(e as Error).message}`;
    return fb;
  }
}

// Extract the first JSON object from a possibly-noisy model response.
function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function normalize(p: any): Omit<ParsedRecipe, "parser"> {
  const ings: ParsedIngredient[] = Array.isArray(p.ingredients) ? p.ingredients.map((i: any, idx: number) => ({
    ingredient_name: String(i.ingredient_name || i.name || "").trim(),
    quantity: numOrNull(i.quantity),
    unit: i.unit ? String(i.unit).trim() : null,
    notes: i.notes ? String(i.notes) : null,
    is_optional: !!i.is_optional,
    order_idx: Number.isFinite(i.order_idx) ? Number(i.order_idx) : idx,
  })) : [];
  const steps: ParsedStep[] = Array.isArray(p.steps) ? p.steps.map((s: any, idx: number) => ({
    order_idx: Number.isFinite(s.order_idx) ? Number(s.order_idx) : idx,
    body: String(s.body || s.text || "").trim(),
    minutes: numOrNull(s.minutes),
    temperature_c: numOrNull(s.temperature_c),
  })).filter((s: ParsedStep) => s.body) : [];
  return {
    title: String(p.title || "Untitled").trim(),
    yield_grams: numOrNull(p.yield_grams),
    prep_minutes: numOrNull(p.prep_minutes),
    cook_minutes: numOrNull(p.cook_minutes),
    servings: numOrNull(p.servings),
    difficulty: numOrNull(p.difficulty),
    ingredients: ings,
    steps,
    notes: p.notes ? String(p.notes) : null,
    confidence: {
      title: pct(p?.confidence?.title, 0.9),
      yield: pct(p?.confidence?.yield, 0.5),
      times: pct(p?.confidence?.times, 0.5),
      servings: pct(p?.confidence?.servings, 0.6),
      ingredients: pct(p?.confidence?.ingredients, 0.7),
      steps: pct(p?.confidence?.steps, 0.7),
    },
    language: (p.language === "es" || p.language === "mixed") ? p.language : "en",
  };
}

function numOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function pct(v: any, def: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(0, Math.min(1, n));
}

// --------------------------------------------------------------------------
// Heuristic parser — used when no Anthropic key is configured, or as fallback.
// Reads a fairly common shape: title in line 1, "Ingredients:" section,
// "Method:" / "Instructions:" section. Deliberately unambitious — a chef will
// review before saving.
// --------------------------------------------------------------------------
export function heuristicParse(raw: string): ParsedRecipe {
  const lines = raw.split(/\r?\n/).map((l) => l.trim());
  const title = (lines.find((l) => l.length > 0) || "Untitled").replace(/^#+\s*/, "");
  const lower = raw.toLowerCase();
  const isEs = /(ingredientes|elaboraci[oó]n|receta|para\s+\d+\s+personas)/.test(lower);
  const language: "en" | "es" | "mixed" = isEs && /ingredients|method|instructions/.test(lower) ? "mixed" : isEs ? "es" : "en";

  const ingRegex = /(ingredientes|ingredients)[:\s]*$/i;
  const stepRegex = /(elaboraci[oó]n|preparaci[oó]n|m[eé]todo|method|instructions|steps|procedimiento)[:\s]*$/i;

  let mode: "none" | "ing" | "step" = "none";
  const ings: ParsedIngredient[] = [];
  const steps: ParsedStep[] = [];
  for (const line of lines) {
    if (!line) continue;
    if (ingRegex.test(line)) { mode = "ing"; continue; }
    if (stepRegex.test(line)) { mode = "step"; continue; }
    if (mode === "ing") {
      const m = line.match(/^[-•*]?\s*(\d+(?:[.,]\d+)?)\s*([a-zA-Zµ]+)?\s+(.*)$/);
      if (m) {
        ings.push({
          ingredient_name: m[3].trim(),
          quantity: Number(m[1].replace(",", ".")),
          unit: m[2] || null,
          notes: null,
          is_optional: /\b(opcional|optional)\b/i.test(line),
          order_idx: ings.length,
        });
      } else if (line.length > 2) {
        ings.push({ ingredient_name: line.replace(/^[-•*]\s*/, ""), quantity: null, unit: null, notes: null, is_optional: false, order_idx: ings.length });
      }
    } else if (mode === "step") {
      steps.push({ order_idx: steps.length, body: line.replace(/^\d+[.)]\s*/, ""), minutes: null, temperature_c: null });
    }
  }

  const servingsMatch = raw.match(/(?:para|serves|servings?)\s+(\d+)/i);
  const servings = servingsMatch ? Number(servingsMatch[1]) : null;

  return {
    title,
    yield_grams: null,
    prep_minutes: null,
    cook_minutes: null,
    servings,
    difficulty: null,
    ingredients: ings,
    steps,
    notes: null,
    confidence: {
      title: title === "Untitled" ? 0.1 : 0.6,
      yield: 0.1,
      times: 0.1,
      servings: servings ? 0.7 : 0.1,
      ingredients: ings.length ? 0.5 : 0.1,
      steps: steps.length ? 0.5 : 0.1,
    },
    language,
    parser: "heuristic",
  };
}
