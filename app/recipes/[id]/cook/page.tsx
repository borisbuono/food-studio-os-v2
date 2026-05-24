import CookMode from "@/components/CookMode";
import { supabase } from "@/lib/supabase";
import { noEmoji } from "@/lib/text";

export const dynamic = "force-dynamic";

export default async function Cook({ params }: { params: { id: string } }) {
  const r: any = (await supabase.from("recipes").select("*").eq("id", params.id).maybeSingle()).data;
  if (!r) return <div className="p-12 font-serif text-2xl text-ink">Recipe not found.</div>;
  const ings: any[] = (await supabase.from("recipe_ingredients").select("name,quantity,unit,sort_order").eq("recipe_id", r.id).order("sort_order")).data || [];

  const panels: { label: string; lines: string[] }[] = [];
  if (ings.length) {
    panels.push({ label: "Mise en place", lines: ings.map((i: any) => `${i.quantity ?? ""} ${i.unit ?? ""} ${noEmoji(i.name)}`.replace(/\s+/g, " ").trim()) });
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

  return <CookMode name={noEmoji(r.name)} panels={panels} backHref={`/recipes/${r.id}`} />;
}
