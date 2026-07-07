import FabHidden from "@/components/FabHidden";
import CookMode from "@/components/CookMode";
import { supabaseServer } from "@/lib/supabaseServer";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function Cook({ params, searchParams }: { params: { id: string }; searchParams: { p?: string } }) {
  
  const supabase = supabaseServer();const r: any = (await supabase.from("recipes").select("*").eq("id", params.id).maybeSingle()).data;
  if (!r) return <div className="p-12 font-serif text-2xl text-ink"><FabHidden />Recipe not found.</div>;
  const ings: any[] = (await supabase.from("recipe_ingredients").select("name,quantity,unit,sort_order").eq("recipe_id", r.id).order("sort_order")).data || [];

  const base = Number(r.portions) > 0 ? Number(r.portions) : null;
  const target = Number(searchParams?.p);
  const factor = base && target > 0 ? target / base : 1;
  const sc = (q: any) => { const n = Number(q); return isFinite(n) ? (Math.round(n * factor * 100) / 100).toString() : (q ?? ""); };

  const panels: { label: string; lines: string[] }[] = [];
  if (ings.length) {
    const miseLabel = base && target > 0 && target !== base ? `Mise en place — for ${target}` : "Mise en place";
    panels.push({ label: miseLabel, lines: ings.map((i: any) => `${sc(i.quantity)} ${i.unit ?? ""} ${noEmoji(i.name)}`.replace(/\s+/g, " ").trim()) });
  }
  const desc = (r.description || "").trim();
  let steps: string[] = [];
  if (desc) {
    steps = (desc.includes("\n") ? desc.split(/\n+/) : desc.split(/(?<=[.!?])\s+/)).map((s: string) => s.trim()).filter(Boolean);
  }
  steps.forEach((s, k) => panels.push({ label: `Step ${k + 1} of ${steps.length}`, lines: [s] }));
  const plating = typeof r.plating_spec === "string" ? r.plating_spec.trim() : "";
  if (plating) panels.push({ label: "Plating", lines: [plating] });
  if (!panels.length) panels.push({ label: "Recipe", lines: ["No method recorded yet — add it from the recipe page."] });

  return <CookMode name={noEmoji(r.name)} panels={panels} backHref={`/develop/menu/${r.id}`} />;
}
