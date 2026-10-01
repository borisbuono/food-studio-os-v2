// lib/cleaning/pdf.ts — a tiny PDF writer for the monthly cleaning register.
//
// Why hand-rolled: the repo has no PDF dependency and the register needs
// nothing but Helvetica, black text and black hairlines on bare paper
// (CLAUDE.md printing rule: no background, no colour — Boris's printer is
// black-and-white). Standard-14 fonts, WinAnsi encoding, one content stream
// per page. Output is a Buffer the route streams as application/pdf.

type Op = string;

const A4 = { w: 595.28, h: 841.89 };
const M = { l: 42, r: 42, t: 48, b: 48 };

// WinAnsi (cp1252) for the characters the sheets actually use.
const WINANSI: Record<string, number> = { "€": 0x80, "…": 0x85, "–": 0x96, "—": 0x97, "“": 0x93, "”": 0x94, "‘": 0x91, "’": 0x92, "·": 0xb7, "°": 0xb0, "×": 0xd7 };
function enc(s: string): string {
  let out = "";
  for (const ch of String(s || "")) {
    const c = ch.codePointAt(0) || 32;
    let b: number;
    if (c < 0x80) b = c;
    else if (WINANSI[ch] != null) b = WINANSI[ch];
    else if (c >= 0xa0 && c <= 0xff) b = c;
    else if (ch === "✓") b = 0x58; // X
    else b = 0x3f; // ?
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += "\\" + String.fromCharCode(b);
    else if (b < 0x20 || b > 0x7e) out += "\\" + b.toString(8).padStart(3, "0");
    else out += String.fromCharCode(b);
  }
  return out;
}
// Helvetica average advance ≈ 0.52 em; bold ≈ 0.56 — enough for wrapping.
function width(s: string, size: number, bold = false) { return String(s || "").length * size * (bold ? 0.56 : 0.52); }
function wrap(s: string, size: number, maxW: number, bold = false): string[] {
  const words = String(s || "").split(/\s+/).filter(Boolean);
  const lines: string[] = []; let cur = "";
  for (const w of words) {
    const next = cur ? cur + " " + w : w;
    if (width(next, size, bold) <= maxW || !cur) cur = next; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

export class RegisterPdf {
  private pages: Op[][] = [];
  private ops: Op[] = [];
  private y = A4.h - M.t;
  private pageNo = 0;
  constructor(private footer: string) { this.newPage(); }

  private newPage() {
    if (this.ops.length) this.pages.push(this.ops);
    this.ops = [];
    this.pageNo += 1;
    this.y = A4.h - M.t;
    // footer: left = document line, right = page number
    this.textAt(M.l, M.b - 18, this.footer, 7.5);
    this.textAt(A4.w - M.r - width(String(this.pageNo), 7.5), M.b - 18, String(this.pageNo), 7.5);
  }
  private ensure(h: number) { if (this.y - h < M.b) this.newPage(); }
  private textAt(x: number, y: number, s: string, size: number, bold = false) {
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${enc(s)}) Tj ET`);
  }
  private hline(y: number, x1 = M.l, x2 = A4.w - M.r, w = 0.5) {
    this.ops.push(`${w} w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`);
  }
  private box(x: number, y: number, s: number, filled: boolean) {
    this.ops.push(`0.6 w ${x.toFixed(2)} ${y.toFixed(2)} ${s} ${s} re S`);
    if (filled) { this.ops.push(`0.9 w ${(x + 1.5).toFixed(2)} ${(y + 1.5).toFixed(2)} m ${(x + s - 1.5).toFixed(2)} ${(y + s - 1.5).toFixed(2)} l S ${(x + 1.5).toFixed(2)} ${(y + s - 1.5).toFixed(2)} m ${(x + s - 1.5).toFixed(2)} ${(y + 1.5).toFixed(2)} l S`); }
  }

  title(s: string, sub?: string) {
    this.ensure(40);
    this.textAt(M.l, this.y - 14, s, 16, true); this.y -= 20;
    if (sub) { this.textAt(M.l, this.y - 10, sub, 9); this.y -= 14; }
    this.hline(this.y - 4, M.l, A4.w - M.r, 1); this.y -= 14;
  }
  heading(s: string, right?: string) {
    this.ensure(28);
    this.y -= 8;
    this.textAt(M.l, this.y - 11, s, 11, true);
    if (right) this.textAt(A4.w - M.r - width(right, 8.5), this.y - 11, right, 8.5);
    this.y -= 16;
    this.hline(this.y, M.l, A4.w - M.r, 0.8); this.y -= 4;
  }
  // A table with fixed column widths (pt) and header row; cells wrap.
  table(cols: { label: string; w: number; bold?: boolean }[], rows: string[][], size = 8.5) {
    const lineH = size * 1.3;
    const drawHeader = () => {
      this.ensure(lineH + 6);
      let x = M.l;
      for (const c of cols) { this.textAt(x + 2, this.y - size, c.label, size - 0.5, true); x += c.w; }
      this.y -= lineH + 1; this.hline(this.y, M.l, A4.w - M.r, 0.6); this.y -= 2;
    };
    drawHeader();
    for (const r of rows) {
      const cells = cols.map((c, i) => wrap(r[i] ?? "", size, c.w - 4, !!c.bold));
      const h = Math.max(...cells.map((c) => c.length)) * lineH + 3;
      if (this.y - h < M.b) { this.newPage(); drawHeader(); }
      let x = M.l;
      cols.forEach((c, i) => {
        cells[i].forEach((ln, k) => this.textAt(x + 2, this.y - size - k * lineH, ln, size, !!c.bold));
        x += c.w;
      });
      this.y -= h; this.hline(this.y, M.l, A4.w - M.r, 0.3); this.y -= 1;
    }
  }
  // Items of one run: box · label · by · time · note
  items(rows: { label: string; done: boolean; by: string; time: string; note: string; flag?: string }[]) {
    const size = 8.5, lineH = size * 1.3;
    const wLabel = 250, wBy = 110, wTime = 40;
    for (const r of rows) {
      const lab = wrap(r.label + (r.flag ? "  " + r.flag : ""), size, wLabel - 6);
      const note = r.note ? wrap(r.note, size - 0.5, A4.w - M.l - M.r - 16 - 20) : [];
      const h = (lab.length + note.length) * lineH + 4;
      if (this.y - h < M.b) this.newPage();
      this.box(M.l + 2, this.y - size - 1.5, size + 1.5, r.done);
      lab.forEach((ln, k) => this.textAt(M.l + 18, this.y - size - k * lineH, ln, size));
      this.textAt(M.l + 18 + wLabel, this.y - size, r.by, size);
      this.textAt(M.l + 18 + wLabel + wBy, this.y - size, r.time, size);
      note.forEach((ln, k) => this.textAt(M.l + 36, this.y - size - (lab.length + k) * lineH, ln, size - 0.5));
      this.y -= h; this.hline(this.y, M.l, A4.w - M.r, 0.25); this.y -= 1;
    }
  }
  signoff(label: string, value: string) {
    this.ensure(22);
    this.y -= 6;
    this.textAt(M.l, this.y - 9, label, 8.5, true);
    this.textAt(M.l + 120, this.y - 9, value, 8.5);
    this.y -= 14;
  }
  gap(h = 10) { this.y -= h; }

  build(): Buffer {
    if (this.ops.length) this.pages.push(this.ops);
    this.ops = [];
    const objs: string[] = [];
    const add = (s: string) => { objs.push(s); return objs.length; };
    const fontR = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const fontB = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const pagesId = objs.length + 1 + this.pages.length * 2; // reserved after page+content pairs
    const pageIds: number[] = [];
    for (const p of this.pages) {
      const stream = p.join("\n");
      const contentId = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
      const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Resources << /Font << /F1 ${fontR} 0 R /F2 ${fontB} 0 R >> >> /Contents ${contentId} 0 R >>`);
      pageIds.push(pageId);
    }
    const realPagesId = add(`<< /Type /Pages /Kids [${pageIds.map((i) => i + " 0 R").join(" ")}] /Count ${pageIds.length} >>`);
    if (realPagesId !== pagesId) throw new Error("pdf: object numbering drifted");
    const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
    const offsets: number[] = [];
    objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = Buffer.byteLength(out, "latin1");
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += String(off).padStart(10, "0") + " 00000 n \n";
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, "latin1");
  }
}
