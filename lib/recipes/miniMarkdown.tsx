import React from "react";

// Minimal, XSS-safe markdown for recipe methods: numbered + bulleted lists,
// #/##/### headings, **bold**, *italic*, paragraphs. Builds React nodes —
// never dangerouslySetInnerHTML — so seeded or user text cannot inject HTML.

function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith("**")
      ? <strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong>
      : <em key={`${key}-${i++}`}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function MiniMarkdown({ source, className }: { source: string | null | undefined; className?: string }) {
  const lines = String(source || "").replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { type: "ol" | "ul"; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={`p${blocks.length}`} className="mt-3">{inline(para.join(" "), `p${blocks.length}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const k = `l${blocks.length}`;
    const items = list.items.map((it, i) => <li key={`${k}-${i}`} className="mt-2 pl-1">{inline(it, `${k}-${i}`)}</li>);
    blocks.push(list.type === "ol"
      ? <ol key={k} className="mt-3 list-decimal pl-6">{items}</ol>
      : <ul key={k} className="mt-3 list-disc pl-6">{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (h) { flushPara(); flushList(); blocks.push(<h3 key={`h${blocks.length}`} className="mt-6 font-serif text-[19px]">{inline(h[2], `h${blocks.length}`)}</h3>); continue; }
    if (ol || ul) {
      flushPara();
      const type = ol ? "ol" : "ul";
      if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push((ol || ul)![1]);
      continue;
    }
    if (list && /^\s{2,}/.test(raw)) { list.items[list.items.length - 1] += " " + line.trim(); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return <div className={className}>{blocks}</div>;
}
