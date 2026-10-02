import { notFound } from "next/navigation";
import Link from "next/link";
import FabHidden from "@/components/FabHidden";
import { supabase } from "@/lib/supabase";
import { getGuestBrand } from "@/lib/guest/brand";
import { normaliseEntitySlug } from "@/lib/leads/entityResolve";
import ProposalForm, { type ProposalPrefill } from "./ProposalForm";

export const dynamic = "force-dynamic";

// /m/<public_slug>/proposal?date&pax&budget_pp&venue&shape&lang&ref=
//
// E5 (2026-10-02): the page the email draft links to. The few details the OS
// already read from the guest's mail arrive in the query and are PREFILLED —
// the guest confirms or corrects, adds what is missing, and the same lead the
// enquiry opened (ref = thread id prefix) is completed through
// POST /api/leads/capture. No price anywhere on this page: pricing is Boris's
// proposal, written from brand_kits / the pricing rules, never from a form.

const COPY = {
  es: {
    kicker: "Propuesta personal", title: "Unos pocos detalles y te preparamos una propuesta",
    lead: "Ya tenemos tu correo. Confirma o corrige lo que leímos y añade lo que falte — Boris te responde con una propuesta hecha a medida.",
    back: "‹ volver",
  },
  en: {
    kicker: "Personal proposal", title: "A few details and we will prepare your proposal",
    lead: "We have your email. Confirm or correct what we read and add what is missing — Boris comes back with a proposal written for you.",
    back: "‹ back",
  },
} as const;

function clean(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  const t = String(s ?? "").trim();
  return t ? t.slice(0, 80) : null;
}

export default async function ProposalPage({ params, searchParams }: { params: { slug: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const { data: r } = await supabase.from("restaurants").select("id,name,public_slug").eq("public_slug", params.slug).maybeSingle();
  if (!r) notFound();
  const brand = getGuestBrand(params.slug, r.name || undefined);
  const lang: "es" | "en" = String(clean(searchParams.lang) || "").toLowerCase().startsWith("es") ? "es" : "en";
  const c = COPY[lang];
  const entitySlug = normaliseEntitySlug(params.slug) || params.slug;
  const pax = Number(clean(searchParams.pax));
  const budget = Number(clean(searchParams.budget_pp));
  const prefill: ProposalPrefill = {
    date: /^\d{4}-\d{2}-\d{2}$/.test(clean(searchParams.date) || "") ? (clean(searchParams.date) as string) : "",
    pax: Number.isFinite(pax) && pax >= 1 && pax <= 200 ? String(Math.floor(pax)) : "",
    budget_pp: Number.isFinite(budget) && budget > 0 ? String(Math.round(budget)) : "",
    venue: ["ours", "provider", "help"].includes(clean(searchParams.venue) || "") ? (clean(searchParams.venue) as "ours" | "provider" | "help") : "",
    shape: ["set", "sharing", "buffet", "canapes"].includes(clean(searchParams.shape) || "") ? (clean(searchParams.shape) as "set" | "sharing" | "buffet" | "canapes") : "",
    ref: /^[0-9a-f]{8}$/i.test(clean(searchParams.ref) || "") ? (clean(searchParams.ref) as string).toLowerCase() : "",
  };

  return (
    <main className="min-h-screen" style={{ background: brand.bg, color: brand.ink, ["--accent" as any]: brand.accent } as any}>
      <FabHidden />
      <div className="mx-auto max-w-lg px-8 pt-12 pb-16">
        <Link href={`/m/${params.slug}`} className="font-mono text-[11px] uppercase tracking-[0.2em]" style={{ color: brand.clay }}>{c.back}</Link>
        <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: brand.accent }}>{c.kicker}</p>
        <h1 className={`mt-3 text-[34px] leading-[1.05] ${brand.wordmarkClass}`} style={{ color: brand.ink }}>{c.title}</h1>
        <p className="mt-4 font-serif italic text-[17px] leading-relaxed" style={{ color: brand.inkSoft }}>{c.lead}</p>
        <ProposalForm slug={params.slug} entitySlug={entitySlug} brand={brand} lang={lang} prefill={prefill} />
      </div>
    </main>
  );
}
