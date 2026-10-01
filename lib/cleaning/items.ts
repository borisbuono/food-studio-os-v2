// lib/cleaning/items.ts — normalise a template's items as posted by the editor.
import type { CleaningTemplateItem } from "@/lib/cleaning/types";

export function parseItems(raw: unknown): CleaningTemplateItem[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: CleaningTemplateItem[] = [];
  arr.forEach((x: any) => {
    const label = String(x?.label ?? x ?? "").trim().slice(0, 300);
    if (!label) return;
    const it: CleaningTemplateItem = { label, order: out.length + 1 };
    if (x?.kind === "temp") {
      it.kind = "temp";
      it.equipment = String(x.equipment || label).slice(0, 120);
      it.equipment_type = ["fridge", "freezer", "hot_hold", "other"].includes(x.equipment_type) ? x.equipment_type : "fridge";
      it.min_c = x.min_c == null || x.min_c === "" ? null : Number(x.min_c);
      it.max_c = x.max_c == null || x.max_c === "" ? null : Number(x.max_c);
    }
    out.push(it);
  });
  return out;
}
