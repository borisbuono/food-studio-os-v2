"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile, MyProfile } from "@/lib/profile";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";

type Msg = { role: "you" | "chef" | "sys"; text: string };

// One button, like Siri — but it's Chef. Tap to talk; it keeps listening (auto-restarts
// under the hood so the browser/iOS can't cut you off mid-sentence) until you tap Chef
// again to send. Then it works out whether you're asking, want a recipe, drafting an
// order, or leaving feedback — and routes it.
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
  const [capBusy, setCapBusy] = useState(false);
  const [capMsg, setCapMsg] = useState<string>("");
  const [lastYou, setLastYou] = useState("");
  const recRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textRef = useRef("");
  const finalRef = useRef("");      // transcript committed across auto-restarts
  const keepRef = useRef(false);    // user wants to keep listening until they tap to send
  const sendRef = useRef<() => void>(() => {});
  const pressStart = useRef<number | null>(null);

  useEffect(() => { getMyProfile().then(setProfile); }, []);

  useEffect(() => {
    const SR = (typeof window !== "undefined") && ((window as any).webkitSpeechRecognition || (window as any).SpeechRecognition);
    if (!SR) { setSupported(false); return; }
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = "en-GB";
    r.onstart = () => { setListening(true); setStatus("Listening… release to send"); };
    r.onresult = (e: any) => {
      let t = ""; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      const full = (finalRef.current + t).replace(/\s+/g, " ").trim();
      setText(full); textRef.current = full;
    };
    r.onerror = (e: any) => {
      const code = e?.error || "";
      if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") {
        keepRef.current = false; setListening(false);
        setStatus(code === "audio-capture" ? "No microphone found — type below." : "Mic is blocked — allow it for this site, or type below.");
      }
      // "no-speech" / "aborted": let onend decide (it will restart while keepRef is true)
    };
    r.onend = () => {
      if (keepRef.current) {
        // commit what we have and keep going — defeats iOS/Safari's early auto-stop
        finalRef.current = textRef.current ? textRef.current + " " : finalRef.current;
        try { r.start(); } catch { setTimeout(() => { try { r.start(); } catch {} }, 300); }
        return;
      }
      setListening(false);
      if (textRef.current.trim()) sendRef.current();
    };
    recRef.current = r;
  }, []);

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [log, text]);

  const listen = () => {
    const r = recRef.current; if (!r) return;
    finalRef.current = ""; textRef.current = ""; setText("");
    keepRef.current = true; setStatus("Listening… release to send");
    try { r.start(); setListening(true); } catch {}
  };
  const stopAndSend = () => { const r = recRef.current; if (!r) return; keepRef.current = false; try { r.stop(); } catch {} };

  const openFab = () => {
    setOpen(true);
    if (supported && (navigator as any).permissions?.query) {
      (navigator as any).permissions.query({ name: "microphone" as any }).then((p: any) => { if (p.state === "granted") setTimeout(listen, 200); }).catch(() => {});
    }
  };
  const onCapture = async (file?: File | null) => {
    if (!file) return; setCapBusy(true); setCapMsg("");
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("type", "auto");
      const r = await fetch("/api/capture", { method: "POST", body: fd });
      const d = await r.json();
      if (!d.ok) { setCapMsg("⚠ " + (d.error || "upload failed")); setCapBusy(false); return; }
      const det = d.detected;
      const summary = det ? `${d.type}${det.supplier_name ? " · " + det.supplier_name : ""}${det.total_eur != null ? " · €" + Number(det.total_eur).toFixed(2) : ""}` : d.type;
      setCapMsg(`✓ Filed: ${summary}`);
      setLog((l) => [...l, { role: "sys", text: `📷 Captured: ${summary} → ${d.where}` }]);
    } catch (e: any) { setCapMsg("⚠ " + (e?.message || "upload failed")); }
    setCapBusy(false);
  };
  const closeFab = () => { keepRef.current = false; try { recRef.current?.stop(); } catch {} setListening(false); setOpen(false); };

  const send = async () => {
    const t = (textRef.current.trim() || text.trim()); if (!t) return;
    keepRef.current = false; if (listening) { try { recRef.current?.stop(); } catch {} setListening(false); }
    setText(""); textRef.current = ""; finalRef.current = ""; setStatus("");
    setLastYou(t);
    setLog((l) => [...l, { role: "you", text: t }, { role: "chef", text: "…" }]);
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: t, route: pathname || "" }) });
      const d = await r.json();
      const reply = d.reply || "…";
      setLog((l) => { const n = [...l]; n[n.length - 1] = { role: "chef", text: reply }; return n; });
      if (d.feedback && d.feedback.body) {
        if (!profile) { setLog((l) => [...l, { role: "sys", text: "⚠ Sign in to save this to the feedback board." }]); }
        else {
          const ent = (!profile.isAdmin ? profile.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
          const rid = profile.restaurantId || ENTITY_TO_RESTAURANT[ent as EntityKey] || ENTITY_TO_RESTAURANT.utopia!;
          const { error } = await supabaseBrowser.from("feedback").insert({ restaurant_id: rid, route: pathname || "", author_id: profile.id, author_name: profile.name, author_role: profile.dbRole, kind: d.feedback.kind || "idea", body: d.feedback.body });
          setLog((l) => [...l, { role: "sys", text: error ? ("⚠ Couldn’t save: " + error.message) : "✓ Saved to the feedback board" }]);
        }
      }
      if (Array.isArray(d.order) && d.order.length) setOrderDraft(d.order);
    } catch { setLog((l) => { const n = [...l]; n[n.length - 1] = { role: "chef", text: "Couldn’t reach Chef — try again." }; return n; }); }
  };
  const fileLast = async () => {
    if (!lastYou) return;
    if (!profile) { setLog((l) => [...l, { role: "sys", text: "⚠ Sign in to save to the board." }]); return; }
    const ent = (!profile.isAdmin ? profile.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
    const rid = profile.restaurantId || ENTITY_TO_RESTAURANT[ent as EntityKey] || ENTITY_TO_RESTAURANT.utopia!;
    const { error } = await supabaseBrowser.from("feedback").insert({ restaurant_id: rid, route: pathname || "", author_id: profile.id, author_name: profile.name, author_role: profile.dbRole, kind: "idea", body: lastYou });
    setLog((l) => [...l, { role: "sys", text: error ? ("⚠ Couldn\u2019t save: " + error.message) : "\u2713 Saved to the feedback board" }]);
    setLastYou("");
  };
  useEffect(() => { sendRef.current = send; });

  return (
    <>
      <button
        aria-label="Chef — hold to speak"
        style={{ background: "var(--accent)", touchAction: "manipulation" }}
        className={"fixed bottom-5 right-5 z-[60] h-16 w-16 select-none rounded-full font-serif text-[15px] text-[#F7F7F4] shadow-lg shadow-black/25 transition hover:scale-105 active:scale-95 " + (listening ? "scale-110 ring-4 ring-white/70" : open ? "ring-2 ring-white/70" : "")}
        onPointerDown={(e) => { e.preventDefault(); pressStart.current = Date.now(); if (!open) setOpen(true); listen(); }}
        onPointerUp={(e) => {
          e.preventDefault();
          const held = Date.now() - (pressStart.current || 0);
          pressStart.current = null;
          if (held < 200) {
            // treated as a tap — just open the panel; don't auto-send
            keepRef.current = false; try { recRef.current?.stop(); } catch {} setListening(false); setStatus("Hold the button to talk · or type below"); setText(""); textRef.current = ""; finalRef.current = "";
            return;
          }
          // press-and-hold released: stop + send if we have anything
          stopAndSend();
        }}
        onPointerLeave={(e) => { if (pressStart.current) { pressStart.current = null; stopAndSend(); } }}
        onPointerCancel={() => { if (pressStart.current) { pressStart.current = null; stopAndSend(); } }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {listening ? "···" : "Chef"}
      </button>

      {open ? (
        <div className="fixed bottom-24 right-5 z-50 flex max-h-[min(64vh,560px)] w-[min(92vw,380px)] flex-col overflow-hidden rounded-2xl rounded-br-md border border-black/10 bg-card shadow-2xl shadow-black/25">
          <div className="flex items-center justify-between border-b border-black/10 px-4 py-2">
            <span className="font-serif text-[15px] text-ink">Chef</span>
            <button onClick={closeFab} aria-label="close" className="font-mono text-[12px] text-clay hover:text-ink">close ×</button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5">
            {log.length === 0 && !text ? (
              <p className="font-serif text-[16px] leading-relaxed text-clay">Hold the Chef button and talk. Release to send. Quick tap opens this panel so you can type. “Chef, give me a recipe for romesco.” · “Order 5 kilos of carrots for tomorrow.” · “This screen is confusing because…”</p>
            ) : null}
            {log.map((m, i) => m.role === "sys"
              ? <p key={i} className="mb-3 font-mono text-[11px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>{m.text}</p>
              : <p key={i} className={"mb-3 whitespace-pre-line font-serif text-[17px] leading-relaxed " + (m.role === "you" ? "text-ink" : "text-ink-soft")}>{m.text}</p>)}
            {text ? <p className="font-serif text-[17px] leading-relaxed text-ink">{text}</p> : null}
          </div>

          {orderDraft ? (
            <button onClick={() => { localStorage.setItem("fs_order_draft", JSON.stringify(orderDraft)); window.location.href = "/order"; }} style={{ background: "var(--accent)" }} className="mx-3 mb-2 rounded-xl px-4 py-2.5 text-center font-sans text-[13px] font-medium text-[#F7F7F4]">Draft this order in Ordering →</button>
          ) : null}

          {lastYou ? <button onClick={fileLast} className="mx-3 mb-1 rounded-lg border border-black/15 px-3 py-1.5 text-left font-mono text-[10px] uppercase tracking-wide text-ink-soft transition hover:border-ink/40">↪ Save that to the feedback board</button> : null}
          <div className="flex items-center gap-2 border-t border-black/10 px-3 pt-2">
            <input id="chef-fab-cap" type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onCapture(e.target.files?.[0])} />
            <label htmlFor="chef-fab-cap" className={"flex-1 cursor-pointer rounded-lg border border-black/15 px-3 py-1.5 text-center font-mono text-[10px] uppercase tracking-wide " + (capBusy ? "bg-paper-deep text-muted" : "bg-paper text-ink hover:border-ink/40")}>{capBusy ? "📷 classifying…" : "📷 capture (auto-file)"}</label>
            <a href="/capture" className="rounded-lg border border-black/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-clay hover:border-ink/40">full</a>
          </div>
          {capMsg ? <p className="px-4 pt-1 font-mono text-[10px] text-clay">{capMsg}</p> : null}
          <div className="flex items-center gap-3 border-t border-black/10 p-3">
            <input value={text} onChange={(e) => { setText(e.target.value); textRef.current = e.target.value; }} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder="…or type to Chef" className="min-w-0 flex-1 rounded-full border border-black/15 bg-paper px-4 py-2 font-sans text-[14px] text-ink outline-none focus:border-ink" />
            {text && !listening ? <button onClick={send} style={{ background: "var(--accent)" }} className="shrink-0 rounded-full px-4 py-2 font-sans text-[13px] font-medium text-[#F7F7F4]">Send</button> : null}
          </div>
          <p className="px-4 pb-2 text-center font-mono text-[9px] uppercase tracking-wide text-clay">{status || (supported ? "Hold Chef to talk · release to send" : "Type to Chef above")}</p>
        </div>
      ) : null}
    </>
  );
}
