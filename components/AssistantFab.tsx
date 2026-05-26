"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile, MyProfile } from "@/lib/profile";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";

type Msg = { role: "you" | "chef" | "sys"; text: string };

// One button, like Siri — but it's Chef. Tap it, talk, and it works out whether
// you're asking, want a recipe, drafting an order, or leaving feedback — and routes it.
export default function AssistantFab() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [status, setStatus] = useState("");
  const [log, setLog] = useState<Msg[]>([]);
  const [orderDraft, setOrderDraft] = useState<any[] | null>(null);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const recRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef("");
  const sendRef = useRef<() => void>(() => {});
  const autoRef = useRef(false);
  const silenceTimer = useRef<any>(null);

  useEffect(() => { getMyProfile().then(setProfile); }, []);

  useEffect(() => {
    const SR = (typeof window !== "undefined") && ((window as any).webkitSpeechRecognition || (window as any).SpeechRecognition);
    if (!SR) { setSupported(false); return; }
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = "en-GB";
    r.onstart = () => { setListening(true); setStatus("Listening…"); };
    r.onresult = (e: any) => {
      let t = ""; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      setText(t); textRef.current = t; setStatus("Listening — pause when done");
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      silenceTimer.current = setTimeout(() => { try { r.stop(); } catch {} }, 1500);
    };
    r.onerror = (e: any) => {
      const code = e?.error || ""; setListening(false); autoRef.current = false;
      if (code === "not-allowed" || code === "service-not-allowed") setStatus("Mic is blocked — allow it for this site, then tap Chef again. Or type below.");
      else if (code === "no-speech") setStatus("Didn’t catch that — tap to talk, or type below.");
      else if (code === "audio-capture") setStatus("No microphone found — type below.");
      else if (code === "aborted") setStatus("");
      else setStatus("Voice error: " + code);
    };
    r.onend = () => { setListening(false); if (autoRef.current && textRef.current.trim()) { autoRef.current = false; setStatus(""); sendRef.current(); } };
    recRef.current = r;
  }, []);

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [log, text]);

  const listen = () => { const r = recRef.current; if (!r || listening) return; setText(""); textRef.current = ""; autoRef.current = true; try { r.start(); } catch {} };
  const stop = () => { const r = recRef.current; if (!r) return; autoRef.current = false; try { r.stop(); } catch {} setListening(false); };

  const openFab = () => {
    setOpen(true);
    // Only auto-listen when mic permission is already granted (desktop). On iOS/Safari
    // permission query is unsupported → we DON'T auto-prompt; the user taps TALK instead.
    if (supported && (navigator as any).permissions?.query) {
      (navigator as any).permissions.query({ name: "microphone" as any }).then((p: any) => { if (p.state === "granted") setTimeout(listen, 200); }).catch(() => {});
    }
  };
  const closeFab = () => { stop(); setOpen(false); };

  const send = async () => {
    const t = (textRef.current.trim() || text.trim()); if (!t) return;
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    if (listening) stop();
    setText(""); textRef.current = ""; setStatus("");
    setLog((l) => [...l, { role: "you", text: t }, { role: "chef", text: "…" }]);
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: t, route: pathname || "" }) });
      const d = await r.json();
      const reply = d.reply || "…";
      setLog((l) => { const n = [...l]; n[n.length - 1] = { role: "chef", text: reply }; return n; });
      // feedback intent → log to the board (client has the session), with a VISIBLE result
      if (d.feedback && d.feedback.body) {
        if (!profile) {
          setLog((l) => [...l, { role: "sys", text: "⚠ Sign in to save this to the feedback board." }]);
        } else {
          const ent = (!profile.isAdmin ? profile.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
          const rid = profile.restaurantId || ENTITY_TO_RESTAURANT[ent as EntityKey] || ENTITY_TO_RESTAURANT.utopia!;
          const { error } = await supabaseBrowser.from("feedback").insert({ restaurant_id: rid, route: pathname || "", author_id: profile.id, author_name: profile.name, author_role: profile.dbRole, kind: d.feedback.kind || "idea", body: d.feedback.body });
          setLog((l) => [...l, { role: "sys", text: error ? ("⚠ Couldn’t save to the board: " + error.message) : "✓ Saved to the feedback board" }]);
        }
      }
      if (Array.isArray(d.order) && d.order.length) setOrderDraft(d.order);
    } catch { setLog((l) => { const n = [...l]; n[n.length - 1] = { role: "chef", text: "Couldn’t reach Chef — try again." }; return n; }); }
  };
  useEffect(() => { sendRef.current = send; });

  return (
    <>
      <button onClick={() => (open ? closeFab() : openFab())} aria-label="Chef" style={{ background: "var(--accent)" }}
        className={"fixed bottom-5 right-5 z-[60] h-16 w-16 rounded-full font-serif text-[15px] text-[#FCEFE7] shadow-lg shadow-black/25 transition hover:scale-105 active:scale-95 " + (open ? "ring-2 ring-white/70" : "")}>
        Chef
      </button>

      {open ? (
        <div className="fixed bottom-24 right-5 z-50 flex max-h-[min(64vh,560px)] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl rounded-br-md border border-black/10 bg-card shadow-2xl shadow-black/25">
          <div className="flex items-center justify-between border-b border-black/10 px-4 py-2">
            <span className="font-serif text-[15px] text-ink">Chef</span>
            <button onClick={closeFab} aria-label="close" className="font-mono text-[12px] text-clay hover:text-ink">close ×</button>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5">
            {log.length === 0 && !text ? (
              <p className="font-serif text-[16px] leading-relaxed text-clay">Talk to Chef. “Chef, give me a recipe for romesco.” · “Order 5 kilos of carrots for tomorrow.” · “This screen is confusing because…”</p>
            ) : null}
            {log.map((m, i) => m.role === "sys" ? <p key={i} className="mb-3 font-mono text-[11px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>{m.text}</p> : <p key={i} className={"mb-3 whitespace-pre-line font-serif text-[17px] leading-relaxed " + (m.role === "you" ? "text-ink" : "text-ink-soft")}>{m.text}</p>)}
            {text ? <p className="font-serif text-[17px] leading-relaxed text-ink">{text}</p> : null}
          </div>

          {orderDraft ? (
            <button onClick={() => { localStorage.setItem("fs_order_draft", JSON.stringify(orderDraft)); window.location.href = "/order"; }} style={{ background: "var(--accent)" }} className="mx-3 mb-2 rounded-xl px-4 py-2.5 text-center font-sans text-[13px] font-medium text-[#FCEFE7]">Draft this order in Ordering →</button>
          ) : null}

          {/* tap big mic to talk again; type field always there as fallback — no modes */}
          <div className="flex items-center gap-3 border-t border-black/10 p-3">
            <button onClick={() => (listening ? stop() : listen())} disabled={!supported} aria-label="talk"
              style={listening ? { background: "var(--accent)" } : undefined}
              className={"h-12 w-12 shrink-0 rounded-full font-mono text-[11px] uppercase tracking-wide transition " + (listening ? "scale-110 animate-pulse text-[#FCEFE7]" : "border border-black/20 text-ink-soft disabled:opacity-50")}>
              {supported ? (listening ? "●" : "talk") : "—"}
            </button>
            <input value={text} onChange={(e) => { setText(e.target.value); textRef.current = e.target.value; }} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder="…or type to Chef" className="min-w-0 flex-1 rounded-full border border-black/15 bg-paper px-4 py-2 font-sans text-[14px] text-ink outline-none focus:border-ember" />
            {text ? <button onClick={send} style={{ background: "var(--accent)" }} className="shrink-0 rounded-full px-4 py-2 font-sans text-[13px] font-medium text-[#FCEFE7]">Send</button> : null}
          </div>
          {status ? <p className="px-4 pb-2 text-center font-mono text-[9px] uppercase tracking-wide text-clay">{status}</p> : null}
        </div>
      ) : null}
    </>
  );
}
