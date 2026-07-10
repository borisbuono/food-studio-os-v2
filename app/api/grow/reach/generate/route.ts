import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import type { EntityCode } from "@/lib/integrations/types";
import { orchestrator } from "@/lib/assistant/orchestrator";
import {
  CONTENT_TEMPLATES,
  templateCategory,
  type ContentTemplateType,
  type ContextRef,
} from "@/lib/social/content-templates";

export const runtime = "nodejs";

// POST /api/grow/reach/generate
//
// Body: {
//   entity: "IFL"|"BM"|"BBH",
//   type: ContentTemplateType,
//   context_ref?: ContextRef,
//   variants?: number    — default 3
// }
//
// Returns: { ok, drafts: string[], template, model }
//
// Behaviour:
//   · Loads assistant_config for the entity so the model inherits Boris's
//     voice + personality dials.
//   · Uses orchestrator.generate with mode 'draft' + system_extra that binds
//     the model to a strict N-variant format:
//         <variant n="1">…</variant>
//         <variant n="2">…</variant>
//         <variant n="3">…</variant>
//   · Every generation logs an assistant_actions row (kind=draft) with the
//     template + context payload. Metering flows through the standard billing
//     surface (v_assistant_entity_mtd).
//   · Also stashes the concrete prompt into social_content_ideas so the idea
//     library grows automatically as the assistant is used.

const ENTITY_BRAND: Record<EntityCode, string> = {
  IFL: "Ibiza Food Studios",
  BM:  "Bistro Mondo",
  BBH: "Ibiza Food Studios",
};

function parseVariants(text: string, want: number): string[] {
  const out: string[] = [];
  const re = /<variant[^>]*>([\s\S]*?)<\/variant>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const t = (m[1] || "").trim();
    if (t) out.push(t);
  }
  if (out.length) return out.slice(0, want);
  // Fallback: split on blank-line separators if the model ignored the tags.
  const parts = text.split(/\n\s*---+\s*\n|\n\s*\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  return parts.slice(0, want).length ? parts.slice(0, want) : [text.trim()];
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json();
    const entity = b.entity as EntityCode;
    if (!["IFL", "BM", "BBH"].includes(entity)) {
      return NextResponse.json({ ok: false, error: "entity must be IFL / BM / BBH" }, { status: 400 });
    }
    const type = b.type as ContentTemplateType;
    if (!type || !(type in CONTENT_TEMPLATES)) {
      return NextResponse.json({ ok: false, error: "unknown template type" }, { status: 400 });
    }
    const context_ref: ContextRef = (b.context_ref || {}) as ContextRef;
    const wantVariants = Math.max(1, Math.min(5, Number(b.variants) || 3));
    const tmpl = CONTENT_TEMPLATES[type];
    const brand = ENTITY_BRAND[entity];

    const config = await orchestrator.getConfig(entity);
    const userPrompt = tmpl.render(context_ref, brand);

    const systemExtra = [
      "You are drafting a social media post for an editorial hospitality brand.",
      `Target length: ${tmpl.target_length.min}-${tmpl.target_length.max} characters.`,
      "Return EXACTLY the following XML shape and nothing else:",
      Array.from({ length: wantVariants }, (_, i) => `<variant n=\"${i + 1}\">…post text…</variant>`).join("\n"),
      "Each <variant> is a self-contained draft. No preamble, no commentary, no code fences.",
    ].join("\n");

    const gen = await orchestrator.generate({
      config,
      prompt: userPrompt,
      mode: "draft",
      language: "en",
      system_extra: systemExtra,
    });

    if (!gen.ok) {
      return NextResponse.json({ ok: false, error: gen.text || "generation failed" }, { status: 502 });
    }

    const drafts = parseVariants(gen.text, wantVariants);

    // Log the action (billing + audit)
    try {
      await orchestrator.logAction({
        entity,
        kind: "draft",
        route: "grow/reach/generate",
        payload: { template: type, context_ref, variants: drafts.length, brand },
        result: gen,
      });
    } catch {}

    // Stash the concrete prompt as a fresh idea (best-effort — RLS may block
    // anon; we ignore the error, the generator page still returns drafts).
    try {
      const sb = supabaseServer();
      await sb.from("social_content_ideas").insert({
        entity_code: entity,
        category: templateCategory(type),
        prompt: userPrompt.slice(0, 4000),
      });
    } catch {}

    return NextResponse.json({
      ok: true,
      drafts,
      template: { type, label: tmpl.label, category: tmpl.category },
      model: gen.model,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 400 });
  }
}
