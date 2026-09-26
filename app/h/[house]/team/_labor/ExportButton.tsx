"use client";

type Row = {
  id: string;
  name: string | null;
  role: string | null;
  station: string | null;
  clock_in: string | null;
  clock_out: string | null;
  break_minutes: number | null;
  hourly_rate_eur: number | null;
  paid_minutes: number;
  cost_eur: number | null;
};

type Props = {
  rows: Row[];
  filename: string;
};

// CSV export — client-side, straight download. Kept plain (no XLSX
// styling) so payroll can paste into Sheets or their gestoría's template
// without gymnastics.
export default function ExportButton({ rows, filename }: Props) {
  function download() {
    const header = ["shift_id","name","role","station","clock_in","clock_out","break_minutes","paid_hours","rate_eur","cost_eur"];
    const lines = [header.join(",")];
    for (const r of rows) {
      const csvRow = [
        r.id,
        csvCell(r.name),
        csvCell(r.role),
        csvCell(r.station),
        r.clock_in || "",
        r.clock_out || "",
        String(r.break_minutes ?? 0),
        (r.paid_minutes / 60).toFixed(2),
        r.hourly_rate_eur == null ? "" : String(r.hourly_rate_eur),
        r.cost_eur == null ? "" : r.cost_eur.toFixed(2),
      ];
      lines.push(csvRow.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  return (
    <button
      onClick={download}
      className="rounded border border-black/15 px-3 py-1.5 text-xs hover:bg-black/[.03]"
      disabled={!rows.length}
    >
      Export CSV
    </button>
  );
}

function csvCell(v: string | null): string {
  if (!v) return "";
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
