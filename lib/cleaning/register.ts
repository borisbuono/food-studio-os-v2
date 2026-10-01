// lib/cleaning/register.ts — month helpers + the PDF body for the register.
import type { CleaningRun } from "@/lib/cleaning/types";
import { RegisterPdf } from "@/lib/cleaning/pdf";

export function monthBounds(month: string): { from: string; to: string } | null {
  const m = String(month || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}` };
}
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}
export function monthLabel(month: string, lang: "en" | "es" | "nl"): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "es" ? "es-ES" : lang === "nl" ? "nl-NL" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}
export function hhmm(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  try { return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(iso)); } catch { return ""; }
}
export function dmy(iso: string): string { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; }

const SHIFT_ES: Record<string, string> = { opening: "Apertura", closing: "Cierre", daily: "Diario", weekly: "Semanal", monthly: "Mensual" };

// The Sanidad-style register: a month summary table, then every run with its
// lines, who did each, when, and the responsible person's sign-off.
export function buildRegisterPdf(opts: { entityName: string; legalName?: string | null; month: string; area: string | null; tz: string; runs: CleaningRun[] }): Buffer {
  const { entityName, month, tz } = opts;
  const runs = [...opts.runs].sort((a, b) => a.service_date.localeCompare(b.service_date) || a.template_name.localeCompare(b.template_name));
  const pdf = new RegisterPdf(`${entityName} · Registro de limpieza y desinfección (APPCC) · ${monthLabel(month, "es")} · generado ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · Food Studio OS`);
  pdf.title(`Registro de limpieza y desinfección · ${monthLabel(month, "es")}`,
    [entityName, opts.legalName && opts.legalName !== entityName ? opts.legalName : null, opts.area ? `Área: ${opts.area}` : "Todas las áreas", "Plan APPCC — Plan de limpieza y desinfección / control de temperaturas"].filter(Boolean).join(" · "));

  pdf.heading("Resumen del mes", `${runs.length} listas · ${runs.filter((r) => r.status === "signed").length} firmadas`);
  pdf.table(
    [{ label: "Fecha", w: 60 }, { label: "Lista", w: 185, bold: true }, { label: "Turno", w: 55 }, { label: "Hechas / total", w: 70 }, { label: "Firmado por", w: 100 }, { label: "Hora", w: 41 }],
    runs.map((r) => [dmy(r.service_date), r.template_name + (r.area ? ` (${r.area})` : ""), SHIFT_ES[r.shift] || r.shift, `${r.items.filter((i) => i.done).length} / ${r.items.length}`, r.status === "signed" ? r.signed_by_name || "—" : "SIN FIRMAR", r.status === "signed" ? hhmm(r.signed_at, tz) : ""]),
  );
  if (!runs.length) { pdf.gap(6); pdf.signoff("Sin registros", "No hay listas en este mes."); }

  for (const r of runs) {
    pdf.gap(6);
    pdf.heading(`${dmy(r.service_date)} · ${r.template_name}${r.area ? ` · ${r.area}` : ""}`, `${SHIFT_ES[r.shift] || r.shift} · ${r.items.filter((i) => i.done).length} / ${r.items.length}`);
    pdf.items(r.items.map((i) => {
      const temp = i.kind === "temp" && i.temperature_c != null ? `${i.temperature_c} °C` + (i.target_min_c != null || i.target_max_c != null ? ` (${i.target_min_c ?? "…"}–${i.target_max_c ?? "…"})` : "") + (i.in_range === false ? " FUERA DE RANGO" : "") : i.kind === "temp" ? "°C —" : "";
      const label = (i.kind === "corrective" ? "Acción correctiva — " : "") + i.label;
      return { label, done: i.done, by: i.done ? i.done_by_name || "" : "", time: i.done ? hhmm(i.done_at, tz) : "", note: i.note || "", flag: temp };
    }));
    pdf.signoff("Responsable (firma)", r.status === "signed" ? `${r.signed_by_name || "—"} · ${dmy(r.service_date)} ${hhmm(r.signed_at, tz)}` : "SIN FIRMAR");
  }
  return pdf.build();
}
