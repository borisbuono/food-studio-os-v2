"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { ENTITY_ACCENT, ENTITY_LABEL, type EntityKey } from "@/lib/entities";
import { TEMPLATE_LIST, type ContentTemplateType, type ContextRef } from "@/lib/social/content-templates";

export const dynamic = "force-dynamic";

// Grow · Reach · AI content generator.
//
// Pick a template + entity + optional context, hit generate, get three draft
// variants back. Save the one you like as a social_posts draft — the calendar
// picks it up in the backlog strip.

const ENTITY_CODE: Record<EntityKey, "IFL" | "BM" | "BBH"> = {
  utopia: "IFL", taller: "IFL", bistro_mondo: "BM", holdings: "BBH",
};

type Channel = "instagram" | "facebook" | "tiktok" | "threads";
const CHANNELS: Channel[] = ["instagram", "facebook", "tiktok", "threads"];
const CHANNEL_LABEL: Record<Channel, string> = {
  instagram: "IG", facebook: "FB", tiktok: "TikTok", threads: "Threads",
};

export default function GeneratorPage() {
  const [entity, setEntity] = useState<EntityKey>("utopia");
  const [type, setType] = useState<ContentTemplateType>("dish_spotlight");
  const [label, setLabel] = useState("");
  const [detail, setDetail] = useState("");
  const [when, setWhen] = useState("");
  const [price, setPrice] = useState("");
  const [drafts, setDrafts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [selectedChannels, setSelectedChannels] = useState<Channel[]>(["instagram"]);

  const ec = ENTITY_CODE[entity];
  const accent = ENTITY_ACCENT[entity];

  useEffect(() => {
    const e = (typeof window !== "undefined" ? localStorage.getItem("fs_entity") : null) as EntityKey | null;
    if (e) setEntity(e);
  }, []);

  const template = useMemo(() => TEMPLATE_LIST.find((t) => t.type === type)!, [type]);

  const generate = async () => {
    setBusy(true); setErr(""); setDrafts([]); setSavedId(null);
    try {
      const context_ref: ContextRef = {
        kind: "free_text",
        label: label.trim() || undefined,
        detail: detail.trim() || undefined,
        when: when || undefined,
        price_eur: price ? Number(price) : null,
      };
      const resp = await fetch("/api/grow/reach/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity: ec, type, context_ref, variants: 3 }),
      });
      const j = await resp.json();
      if (!resp.ok || !j?.ok) throw new Error(j?.error || `generate failed (${resp.status})`);
      setDrafts(j.drafts || []);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = async (text: string) => {
    setErr(""); setSavedId(null);
    if (selectedChannels.length === 0) {
      setErr("Pick at least one channel before saving.");
      return;
    }
    const rows = selectedChannels.map((ch) => ({
      entity_code: ec,
      channel: ch,
      title: label.trim() || null,
      body: text,
      media_urls: [] as string[],
      status: "draft",
    }));
    const { data, error } = await supabaseBrowser.from("social_posts").insert(rows).select("id");
    if (error) { setErr(error.message); return; }
    setSavedId((data && data[0]?.id) || "saved");
  };

  return (
    <main className="mx-auto max-w-4xl px-6 py-12" style={{ ["--accent" as any]: accent }}>
      <Link href="/grow/reach" className="font-sans text-sm text-ink-soft">← Reach</Link>
      <div className="mt-6 flex items-baseline justify-between gap-6">
        <div>
          <p className="font-sans text-xs font-medium" style={{ color: "var(--accent)" }}>Grow · reach · generator</p>
          <h1 className="mt-2 font-serif text-3xl text-ink">AI content generator</h1>
          <p className="mt-2 max-w-2xl font-sans text-[13px] leading-relaxed text-ink-soft">
            Pick a template, hand over the raw material, get three drafts in your voice for {ENTITY_LABEL[entity]}. Save the one you like — it lands in the calendar backlog.
          </p>
        </div>
      </div>

      <section className="mt-8 rounded-2xl border border-line bg-paper p-5">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">1 · template</p>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          {TEMPLATE_LIST.map((t) => (
            <button
              key={t.type}
              onClick={() => setType(t.type)}
              className={`rounded-lg border p-3 text-left ${type === t.type ? "border-ink bg-ink/5" : "border-line hover:border-ink-soft"}`}
            >
              <p className="font-serif text-[14px] text-ink">{t.label}</p>
              <p className="mt-1 font-sans text-[12px] text-ink-soft">{t.blurb}</p>
              <p className="mt-2 font-mono text-[9px] uppercase tracking-wide text-muted">{t.category.replace("_", " ")}</p>
            </button>
          ))}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="font-mono text-[10px] uppercase tracking-wide text-muted">headline / subject</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1 w-full rounded border border-line bg-paper px-3 py-2 font-sans text-[13px] text-ink" placeholder="dish name, wine, event title, team member…" />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-wide text-muted">price € (optional)</label>
            <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" className="mt-1 w-full rounded border border-line bg-paper px-3 py-2 font-sans text-[13px] text-ink" placeholder="0" />
          </div>
          <div className="md:col-span-2">
            <label className="font-mono text-[10px] uppercase tracking-wide text-muted">context / raw material</label>
            <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={4} className="mt-1 w-full rounded border border-line bg-paper px-3 py-2 font-sans text-[13px] text-ink" placeholder="Everything the model needs — origin, technique, a personal detail, the point of view…" />
          </div>
          <div>
            <label className="font-mono text-[10px] uppercase tracking-wide text-muted">when (event / seasonal)</label>
            <input value={when} onChange={(e) => setWhen(e.target.value)} type="datetime-local" className="mt-1 w-full rounded border border-line bg-paper px-3 py-2 font-sans text-[13px] text-ink" />
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-muted">save channel(s)</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {CHANNELS.map((c) => (
                <button
                  key={c}
                  onClick={() => setSelectedChannels((cs) => cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c])}
                  className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-wide ${selectedChannels.includes(c) ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink hover:border-ink-soft"}`}
                >
                  {CHANNEL_LABEL[c]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-baseline justify-end gap-2">
          <button onClick={generate} disabled={busy} className="rounded-full border border-ink bg-ink px-4 py-1.5 font-mono text-[10px] uppercase tracking-wide text-paper disabled:opacity-50">
            {busy ? "drafting…" : "generate 3 drafts →"}
          </button>
        </div>

        {err ? <p className="mt-3 rounded border border-tomato/40 bg-tomato/10 px-2 py-1 font-mono text-[10px] text-tomato">⚠ {err}</p> : null}
      </section>

      <section className="mt-8">
        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">2 · drafts</p>
        {drafts.length === 0 && !busy ? (
          <div className="mt-3 rounded-lg border border-dashed border-line bg-paper-deep p-8 text-center">
            <p className="font-sans text-[13px] italic text-ink-soft">No drafts yet.</p>
            <p className="mt-2 font-sans text-[12px] text-ink-soft">
              Pick a template, drop your raw material, and hit generate. Each pass gives you three variants — keep the one you like.
            </p>
          </div>
        ) : busy ? (
          <p className="mt-4 font-sans text-[13px] italic text-ink-soft">Writing three variants in your voice…</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
            {drafts.map((d, i) => (
              <article key={i} className="flex flex-col rounded-lg border border-line bg-paper p-4">
                <p className="font-mono text-[9px] uppercase tracking-wide text-muted">variant {i + 1}</p>
                <p className="mt-2 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink">{d}</p>
                <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                  <button
                    onClick={() => navigator.clipboard?.writeText(d)}
                    className="font-mono text-[10px] uppercase tracking-wide text-ink-soft hover:text-ink"
                  >
                    copy
                  </button>
                  <button
                    onClick={() => saveDraft(d)}
                    className="rounded-full border border-ink bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-paper"
                  >
                    save as draft →
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
        {savedId ? (
          <p className="mt-4 rounded border border-basil/40 bg-basil/10 px-3 py-2 font-mono text-[10px] uppercase tracking-wide text-basil">
            saved to calendar backlog · <Link href={`/grow/reach/calendar?entity=${entity}`} className="underline">open calendar →</Link>
          </p>
        ) : null}
      </section>

      <p className="mt-10 font-mono text-[10px] uppercase tracking-wide text-muted">
        template: {template.label} · length ≈ {template.target_length.min}-{template.target_length.max} chars
      </p>
    </main>
  );
}
