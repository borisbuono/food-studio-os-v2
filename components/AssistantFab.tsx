"use client";
import { useEffect, useRef, useState } from "react";

type Msg = { role: "you" | "fs"; text: string };

export default function AssistantFab() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"type" | "talk">("type");
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [log, setLog] = useState<Msg[]>([]);
  const recRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const SR = (typeof window !== "undefined") && ((window as any).webkitSpeechRecognition || (window as any).SpeechRecognition);
    if (!SR) { setSupported(false); return; }
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = "en-GB";
    r.onresult = (e: any) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      setText(t);
    };
    r.onend = () => setListening(false);
    recRef.current = r;
  }, []);

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [log, text]);

  const startStop = () => {
    const r = recRef.current; if (!r) return;
    if (listening) { r.stop(); setListening(false); }
    else { setText(""); try { r.start(); setListening(true); } catch { /* already started */ } }
  };

  const send = () => {
    const t = text.trim(); if (!t) return;
    if (listening) { recRef.current?.stop(); setListening(false); }
    setLog((l) => [...l, { role: "you", text: t }, { role: "fs", text: "Captured. Turning this into an action — an order draft, a task, a note — connects when the assistant is wired up." }]);
    setText("");
  };

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Assistant"
        style={{ background: "var(--accent)" }}
        className="fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full font-sans text-[13px] font-medium text-[#FCEFE7] shadow-lg shadow-black/25 transition hover:scale-105 active:scale-95"
      >
        {open ? "Close" : "Ask"}
      </button>

      {open ? (
        <div className="fixed bottom-24 right-5 z-50 flex h-[62vh] max-h-[540px] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl border border-black/10 bg-card shadow-2xl shadow-black/25">
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5">
            {log.length === 0 && !text ? (
              <p className="font-serif text-[16px] leading-relaxed text-clay">Ask anything — or say it. Try: “Order 5 kilos of oranges from a veg supplier for tomorrow.”</p>
            ) : null}
            {log.map((m, i) => (
              <p key={i} className={"mb-3 font-serif text-[17px] leading-relaxed " + (m.role === "you" ? "text-ink" : "text-ink-soft")}>{m.text}</p>
            ))}
            {text ? <p className="font-serif text-[17px] leading-relaxed text-ink">{text}</p> : null}
          </div>

          <div className="border-t border-black/10 p-3">
            {mode === "type" ? (
              <div className="flex items-center gap-2">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                  placeholder="Type a message"
                  className="flex-1 rounded-full border border-black/15 bg-paper px-4 py-2 font-sans text-[14px] text-ink outline-none focus:border-ember"
                />
                <button onClick={() => setMode("talk")} className="shrink-0 font-mono text-[11px] uppercase tracking-wide text-clay hover:text-ember">talk</button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <button onClick={() => setMode("type")} className="font-mono text-[11px] uppercase tracking-wide text-clay hover:text-ember">type</button>
                <button
                  onClick={startStop}
                  disabled={!supported}
                  style={listening ? { background: "var(--accent)" } : undefined}
                  className={"h-12 w-12 rounded-full font-mono text-[10px] uppercase tracking-wide transition " + (listening ? "animate-pulse text-[#FCEFE7]" : "border border-black/20 text-ink-soft disabled:opacity-50")}
                >
                  {supported ? (listening ? "stop" : "mic") : "—"}
                </button>
              </div>
            )}
            {text ? <button onClick={send} style={{ background: "var(--accent)" }} className="mt-2 w-full rounded-full px-4 py-2 font-sans text-[13px] font-medium text-[#FCEFE7]">Send</button> : null}
            {mode === "talk" && !supported ? <p className="mt-2 font-mono text-[10px] text-clay">Voice needs Chrome or Safari.</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
