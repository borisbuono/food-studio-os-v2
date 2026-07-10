"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { getMyProfile, MyProfile } from "@/lib/profile";
import { ENTITY_TO_RESTAURANT, EntityKey } from "@/lib/entities";

// Assistant FAB (formerly Chef FAB v2) — Siri-style tap-to-start, bottom-sheet
// drawer, long-press = camera, confidence-gated intent chips with autolearning.
// Language follows the OS i18n setting (fs_lang cookie), hides on pages that set
// data-fab="hidden" on <body>.
//
// Foundation contract: /api/ask delegates to the Assistant Layer orchestrator
// and returns { reply, intent, confidence, order, feedback, memory,
// user_turn_id }. /api/chef/{confirm-intent,save-memory,log-action} continue
// to work (kept for continuity; write to the renamed assistant_* tables).
//
// Persona label ("Chef") is intentionally preserved — that's how operators
// address the assistant. Under the hood, everything is now Assistant Layer.

type Msg = { role: "you" | "chef" | "sys"; text: string; intent?: string | null; confidence?: number | null; userText?: string; turnId?: string; needsConfirm?: boolean; memoryProposal?: any; orderDraft?: any; feedback?: any };
const CONFIDENCE_THRESHOLD = 0.75;
const SNAP_POINTS = [0.4, 0.7, 0.95]; // viewport fractions

function readLang(): "en" | "es" {
  if (typeof document === "undefined") return "en";
  const m = document.cookie.match(/(?:^|;\s*)fs_lang=(en|es)/);
  return (m?.[1] as any) || "en";
}
function newSessionId() { return (typeof crypto !== "undefined" && (crypto as any).randomUUID) ? (crypto as any).randomUUID() : String(Date.now()) + "-" + Math.random().toString(36).slice(2); }

export default function AssistantFab() {
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [snap, setSnap] = useState(0); // index into SNAP_POINTS
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [errorPulse, setErrorPulse] = useState(false);
  const [supported, setSupported] = useState(true);
  const [status, setStatus] = useState("");
  const [log, setLog] = useState<Msg[]>([]);
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [orderDraft, setOrderDraft] = useState<any[] | null>(null);
  const [lang, setLang] = useState<"en" | "es">("en");
  const sessionRef = useRef<string>(newSessionId());
  const recRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ y: number; height: number } | null>(null);
  const textRef = useRef("");
  const finalRef = useRef("");
  const silenceTimer = useRef<any>(null);
  const pressTimer = useRef<any>(null);
  const longPressFired = useRef(false);
  const captureInputRef = useRef<HTMLInputElement>(null);
  const wineInputRef = useRef<HTMLInputElement>(null);
  const [wineDraft, setWineDraft] = useState<any | null>(null);
  const [wineBusy, setWineBusy] = useState(false);

  useEffect(() => { getMyProfile().then(setProfile); setLang(readLang()); }, []);

  // Hide-on-route via body[data-fab="hidden"] (read on path change)
  useEffect(() => {
    if (typeof document === "undefined") return;
    const check = () => setHidden(document.body.getAttribute("data-fab") === "hidden");
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { attributes: true, attributeFilter: ["data-fab"] });
    return () => mo.disconnect();
  }, [pathname]);

  // Speech recognition — language from i18n
  useEffect(() => {
    const SR = (typeof window !== "undefined") && ((window as any).webkitSpeechRecognition || (window as any).SpeechRecognition);
    if (!SR) { setSupported(false); return; }
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = lang === "es" ? "es-ES" : "en-GB";
    r.onstart = () => { setListening(true); setStatus(lang === "es" ? "Escuchando" : "Listening"); };
    r.onresult = (e: any) => {
      let t = ""; for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      const full = (finalRef.current + t).replace(/\s+/g, " ").trim();
      setText(full); textRef.current = full;
      // Auto-send-on-pause: reset 1.5s silence timer on every new chunk
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      if (full) silenceTimer.current = setTimeout(() => stopAndSend(), 1500);
    };
    r.onerror = (e: any) => {
      const code = e?.error || "";
      if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") {
        setListening(false);
        setStatus(code === "audio-capture" ? (lang === "es" ? "Sin micrófono — escribe abajo." : "No microphone — type below.") : (lang === "es" ? "Permiso del micro bloqueado — tócalo para permitir." : "Mic blocked — tap to allow."));
        setErrorPulse(true); setTimeout(() => setErrorPulse(false), 4000);
      }
    };
    r.onend = () => {
      // Auto-restart only if we still want to listen (defeats iOS Safari early stop)
      if (listening && !silenceTimer.current) {
        finalRef.current = textRef.current ? textRef.current + " " : finalRef.current;
        try { r.start(); } catch { setTimeout(() => { try { r.start(); } catch {} }, 300); }
        return;
      }
      setListening(false);
    };
    recRef.current = r;
    return () => { try { r.stop(); } catch {} };
  }, [lang, listening]);

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [log, text]);

  const startListen = useCallback(() => {
    const r = recRef.current; if (!r) return;
    finalRef.current = ""; textRef.current = ""; setText("");
    setStatus(lang === "es" ? "Escuchando" : "Listening");
    try { r.start(); setListening(true); } catch {}
  }, [lang]);

  const stopAndSend = useCallback(() => {
    if (silenceTimer.current) { clearTimeout(silenceTimer.current); silenceTimer.current = null; }
    const r = recRef.current; if (r) { try { r.stop(); } catch {} }
    setListening(false);
    if (textRef.current.trim()) send();
  }, []);

  const fabTap = () => {
    if (!open) setOpen(true);
    if (listening) { stopAndSend(); return; }
    if (supported) startListen();
  };

  // Long-press → open sheet with camera actions strip (Collapse #2 redo)
  const fabPressDown = () => {
    longPressFired.current = false;
    pressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      // Haptic
      if (navigator.vibrate) navigator.vibrate(15);
      setOpen(true);
    }, 500);
  };
  const fabPressUp = () => {
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
    if (!longPressFired.current) fabTap();
  };
  const fabPressCancel = () => { if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; } };

  const send = async () => {
    const t = (textRef.current.trim() || text.trim()); if (!t) return;
    setText(""); textRef.current = ""; finalRef.current = ""; setStatus("");
    setLog((l) => [...l, { role: "you", text: t }, { role: "chef", text: "···", userText: t }]);
    setThinking(true);
    // Sprint 3 · #3 — /grow/inbox integration. Pages can expose
    //   window.__fsAssistantInboxHooks.draftForHint(text) → { ok, ... }
    // and the FAB will run page-owned execution before falling through to the
    // orchestrator when the phrasing sounds like an email-draft request.
    //
    // Sprint 4 · #3 — the WhatsApp tab exposes __fsAssistantWhatsAppHooks with
    // the same shape. If the phrase mentions WhatsApp we prefer that hook.
    try {
      const waHooks = (typeof window !== "undefined" ? (window as any).__fsAssistantWhatsAppHooks : null) as any;
      const emailHooks = (typeof window !== "undefined" ? (window as any).__fsAssistantInboxHooks : null) as any;
      const onInbox = (pathname || "").startsWith("/grow/inbox");
      const looksLikeDraft = /\b(draft|reply|respond|answer|write|message|text)\b/i.test(t);
      const looksLikeWa = /\b(whatsapp|wa|voice ?note)\b/i.test(t);

      if (onInbox && looksLikeDraft && looksLikeWa && waHooks?.draftForHint) {
        const out = await waHooks.draftForHint(t);
        if (out?.ok) {
          const reply = (lang === "es" ? "Borrador de WhatsApp listo abajo" : "WhatsApp draft ready below")
            + (out.chat_id ? "\n" + (lang === "es" ? "Para +" : "To +") + out.chat_id : "");
          setLog((l) => { const n = [...l]; n[n.length - 1] = { role: "chef", text: reply, intent: "order", confidence: 1, userText: t }; return n; });
          setThinking(false);
          return;
        }
        // fall through if the WhatsApp hook couldn't handle it (e.g. no phone number in the phrase)
      }

      if (onInbox && emailHooks?.draftForHint && looksLikeDraft && !looksLikeWa) {
        const out = await emailHooks.draftForHint(t);
        if (out?.ok) {
          const reply = (lang === "es" ? "Borrador listo abajo — asunto: " : "Draft ready below — subject: ") + (out.subject || "(no subject)") + (out.from ? "\n" + (lang === "es" ? "Para " : "To ") + out.from : "");
          setLog((l) => { const n = [...l]; n[n.length - 1] = { role: "chef", text: reply, intent: "order", confidence: 1, userText: t }; return n; });
          setThinking(false);
          return;
        }
        // fall through if the hook couldn't handle it
      }
    } catch {}
    try {
      const ent = (!profile?.isAdmin ? profile?.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
      const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        message: t, route: pathname || "", session_id: sessionRef.current, entity_id: ent, language: lang,
        page_context: (typeof window !== "undefined" ? (window as any).__fsAssistantContext : null),
      })});
      const d = await r.json();
      const reply = d.reply || "…";
      const needsConfirm = d.intent && typeof d.confidence === "number" && d.confidence < CONFIDENCE_THRESHOLD;
      setLog((l) => { const n = [...l]; n[n.length - 1] = { role: "chef", text: reply, intent: d.intent, confidence: d.confidence, userText: t, turnId: d.user_turn_id, needsConfirm, memoryProposal: d.memory, orderDraft: d.order, feedback: d.feedback }; return n; });
      if (d.order) setOrderDraft(d.order);
    } catch (e: any) {
      setLog((l) => { const n = [...l]; n[n.length - 1] = { role: "sys", text: "⚠ " + (e?.message || "Chef offline") }; return n; });
      setErrorPulse(true); setTimeout(() => setErrorPulse(false), 4000);
    }
    setThinking(false);
  };

  const confirmIntent = async (msgIdx: number, confirmedIntent: string) => {
    const m = log[msgIdx]; if (!m?.userText) return;
    setLog((l) => l.map((x, i) => i === msgIdx ? { ...x, needsConfirm: false } : x));
    fetch("/api/chef/confirm-intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: m.userText, classified_intent: m.intent, confirmed_intent: confirmedIntent, classifier_confidence: m.confidence, language: lang }) });
  };

  const saveMemory = async (msgIdx: number) => {
    const m = log[msgIdx]; if (!m?.memoryProposal?.fact) return;
    setLog((l) => l.map((x, i) => i === msgIdx ? { ...x, memoryProposal: null } : x));
    const r = await fetch("/api/chef/save-memory", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fact: m.memoryProposal.fact, scope: m.memoryProposal.scope || "global", source_conversation_id: m.turnId || null, confidence: m.confidence || null })});
    const d = await r.json();
    setLog((l) => [...l, { role: "sys", text: d.ok ? (lang === "es" ? "✓ Recordado" : "✓ Saved to memory") : ("⚠ " + (d.error || "save failed")) }]);
  };

  // Photo capture from long-press
  const onCapture = async (file?: File | null) => {
    if (!file) return;
    setLog((l) => [...l, { role: "sys", text: lang === "es" ? "📷 Subiendo…" : "📷 Uploading…" }]);
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("type", "auto");
      const r = await fetch("/api/capture", { method: "POST", body: fd });
      const d = await r.json();
      if (!d.ok) { setLog((l) => [...l, { role: "sys", text: "⚠ " + (d.error || "upload failed") }]); return; }
      const det = d.detected;
      const summary = det ? `${d.type}${det.supplier_name ? " · " + det.supplier_name : ""}${det.total_eur != null ? " · €" + Number(det.total_eur).toFixed(2) : ""}` : d.type;
      setLog((l) => [...l, { role: "sys", text: `📷 ${lang === "es" ? "Archivado" : "Filed"}: ${summary} → ${d.where}` }]);
    } catch (e: any) { setLog((l) => [...l, { role: "sys", text: "⚠ " + (e?.message || "upload failed") }]); }
  };

  // Wine label scan — Collapse #2 second intent. Uses the same /api/wine-scan
  // endpoint the (now-deleted) /develop/wine/scan page used. Shows the extracted
  // wine in the sheet and hands off to the cellar for edit + full save.
  const onWineCapture = async (file?: File | null) => {
    if (!file) return;
    setWineBusy(true); setWineDraft(null);
    setLog((l) => [...l, { role: "sys", text: lang === "es" ? "🍷 Leyendo etiqueta…" : "🍷 Reading label…" }]);
    try {
      // Downscale in-browser (same recipe the old scan page used)
      const bmp = await new Promise<{ data: string; media_type: string }>((resolve, reject) => {
        const img = new Image(); const url = URL.createObjectURL(file);
        img.onload = () => {
          const max = 1280; let { width, height } = img;
          if (width > max || height > max) { const sc = max / Math.max(width, height); width = Math.round(width * sc); height = Math.round(height * sc); }
          const c = document.createElement("canvas"); c.width = width; c.height = height;
          c.getContext("2d")!.drawImage(img, 0, 0, width, height); URL.revokeObjectURL(url);
          resolve({ data: c.toDataURL("image/jpeg", 0.82).split(",")[1], media_type: "image/jpeg" });
        };
        img.onerror = reject; img.src = url;
      });
      const r = await fetch("/api/wine-scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bmp) });
      const d = await r.json();
      if (!d.ok) { setLog((l) => [...l, { role: "sys", text: "⚠ " + (d.error || "scan failed") }]); setWineBusy(false); return; }
      const w = d.wine || {};
      setWineDraft(w);
      const summary = [w.producer, w.name, w.vintage].filter(Boolean).join(" · ") || "wine";
      setLog((l) => [...l, { role: "sys", text: `🍷 ${lang === "es" ? "Etiqueta leída" : "Label read"}: ${summary}` }]);
    } catch (e: any) { setLog((l) => [...l, { role: "sys", text: "⚠ " + (e?.message || "scan failed") }]); }
    setWineBusy(false);
  };

  const saveWineDraft = async () => {
    if (!wineDraft?.name) return;
    setWineBusy(true);
    try {
      const ent = (!profile?.isAdmin ? profile?.entity : ((localStorage.getItem("fs_entity") as EntityKey) || "utopia")) || "utopia";
      const rid = profile?.restaurantId || ENTITY_TO_RESTAURANT[ent] || ENTITY_TO_RESTAURANT.utopia!;
      const sb = supabaseBrowser;
      const desc = [wineDraft.description, wineDraft.grape ? "Grape: " + wineDraft.grape : "", wineDraft.cuvee ? "Cuvée: " + wineDraft.cuvee : "", wineDraft.classification ? "Classification: " + wineDraft.classification : ""].filter(Boolean).join("\n\n") || null;
      const { data, error } = await sb.from("menu_items").insert({
        restaurant_id: rid, category: "drink", section: "wine",
        name: wineDraft.name, producer: wineDraft.producer || null, region: wineDraft.region || null, vintage: wineDraft.vintage || null,
        wine_style: wineDraft.wine_style || "to_classify",
        tasting_notes: wineDraft.tasting_notes || null, pitch: wineDraft.pitch || null,
        description: desc, is_active: false,
      }).select("id").maybeSingle();
      if (error) { setLog((l) => [...l, { role: "sys", text: "⚠ " + error.message }]); setWineBusy(false); return; }
      const id = data?.id;
      setWineDraft(null);
      setLog((l) => [...l, { role: "sys", text: (lang === "es" ? "✓ Borrador guardado en la bodega. " : "✓ Draft saved to cellar. ") }]);
      if (id) window.location.href = `/develop/wine/${id}`;
    } catch (e: any) { setLog((l) => [...l, { role: "sys", text: "⚠ " + (e?.message || "save failed") }]); }
    setWineBusy(false);
  };

  // Bottom-sheet drag
  const onHandleDown = (e: React.PointerEvent) => {
    if (!sheetRef.current) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragStart.current = { y: e.clientY, height: sheetRef.current.clientHeight };
  };
  const onHandleMove = (e: React.PointerEvent) => {
    if (!dragStart.current || !sheetRef.current) return;
    const dy = e.clientY - dragStart.current.y;
    const h = Math.max(80, dragStart.current.height - dy);
    sheetRef.current.style.height = h + "px";
  };
  const onHandleUp = () => {
    if (!dragStart.current || !sheetRef.current) return;
    const vh = window.innerHeight;
    const ratio = sheetRef.current.clientHeight / vh;
    if (ratio < 0.25) { setOpen(false); sheetRef.current.style.height = ""; dragStart.current = null; return; }
    // Snap to nearest
    let best = 0, bestDelta = Infinity;
    SNAP_POINTS.forEach((p, i) => { const d = Math.abs(ratio - p); if (d < bestDelta) { bestDelta = d; best = i; } });
    setSnap(best);
    sheetRef.current.style.height = (SNAP_POINTS[best] * vh) + "px";
    dragStart.current = null;
  };

  // Hardware/browser back closes
  useEffect(() => {
    if (!open) return;
    const onPop = () => setOpen(false);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open]);

  if (hidden) return null;

  const ringClass = errorPulse ? "ring-4 ring-tomato animate-pulse" : listening ? "ring-4 ring-white/70 animate-pulse" : thinking ? "ring-4 ring-white/40" : open ? "ring-2 ring-white/70" : "";
  const label = errorPulse ? "!" : listening ? "···" : thinking ? "···" : "Chef";

  return (
    <>
      <input ref={captureInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onCapture(e.target.files?.[0])} />
      <input ref={wineInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onWineCapture(e.target.files?.[0])} />

      <button
        aria-label="Chef — tap to talk · hold to open"
        style={{ background: errorPulse ? "#9A3122" : "var(--accent)", touchAction: "manipulation" }}
        className={"fixed bottom-5 right-5 z-[60] h-16 w-16 select-none rounded-full font-serif text-[15px] text-[#F7F7F4] shadow-lg shadow-black/25 transition active:scale-95 " + ringClass}
        onPointerDown={fabPressDown}
        onPointerUp={fabPressUp}
        onPointerCancel={fabPressCancel}
        onPointerLeave={fabPressCancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        {label}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setOpen(false)} />
          <div ref={sheetRef} className="fixed inset-x-0 bottom-0 z-50 flex flex-col overflow-hidden rounded-t-2xl border-t border-black/10 bg-card shadow-2xl shadow-black/25" style={{ height: (SNAP_POINTS[snap] * 100) + "vh" }}>
            <div className="flex items-center justify-between px-4 pt-2 pb-1" onPointerDown={onHandleDown} onPointerMove={onHandleMove} onPointerUp={onHandleUp}>
              <span className="font-mono text-[10px] uppercase tracking-wide text-clay">Chef</span>
              <div className="mx-auto h-1 w-9 rounded-full bg-black/15" />
              <button onClick={() => setOpen(false)} aria-label="close" className="font-mono text-[11px] text-clay hover:text-ink">×</button>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5">
              {log.length === 0 && !text ? (
                <div>
                  <p className="font-serif text-[16px] leading-relaxed text-clay">
                    {lang === "es" ? "Toca Chef y habla. Pausa para enviar." : "Tap Chef and talk. Pause to send."} {" "}
                    <span className="text-muted">{lang === "es" ? "Mantén pulsado = cámara." : "Hold the button = camera."}</span>
                  </p>
                </div>
              ) : null}
              {/* Camera actions strip (Collapse #2 wiring) — always visible when sheet is open */}
              <div className="mb-4 flex flex-wrap gap-2 border-b border-line pb-3">
                <button onClick={() => captureInputRef.current?.click()} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft">📷 {lang === "es" ? "Capturar factura / EOD" : "Capture doc / EOD"}</button>
                <button onClick={() => wineInputRef.current?.click()} disabled={wineBusy} className="rounded-full border border-line bg-paper px-3 py-1.5 font-mono text-[10px] uppercase tracking-wide text-ink hover:border-ink-soft disabled:opacity-50">🍷 {wineBusy ? (lang === "es" ? "leyendo…" : "reading…") : (lang === "es" ? "Escanear vino" : "Scan wine")}</button>
              </div>
              {wineDraft ? (
                <div className="mb-4 rounded-xl border border-line bg-paper-deep/40 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{lang === "es" ? "Vino leído" : "Wine label read"}</p>
                  <p className="mt-1 font-serif text-[15px] text-ink">{[wineDraft.producer, wineDraft.name, wineDraft.vintage].filter(Boolean).join(" · ") || "—"}</p>
                  <p className="mt-1 font-mono text-[10px] text-clay">{[wineDraft.region, wineDraft.wine_style].filter(Boolean).join(" · ")}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button onClick={saveWineDraft} disabled={wineBusy || !wineDraft.name} className="rounded-full border border-ink bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-paper disabled:opacity-40">{wineBusy ? (lang === "es" ? "guardando…" : "saving…") : (lang === "es" ? "✓ guardar borrador · abrir" : "✓ save draft · open")}</button>
                    <button onClick={() => setWineDraft(null)} className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink">× {lang === "es" ? "descartar" : "dismiss"}</button>
                  </div>
                </div>
              ) : null}
              {log.map((m, i) => m.role === "sys"
                ? <p key={i} className="mb-3 font-mono text-[11px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>{m.text}</p>
                : (
                  <div key={i} className="mb-3">
                    <p className={"whitespace-pre-line font-serif text-[17px] leading-relaxed " + (m.role === "you" ? "text-ink" : "text-ink-soft")}>{m.text}</p>
                    {m.needsConfirm ? (
                      <div className="mt-2 rounded-xl border border-line bg-paper p-2">
                        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{lang === "es" ? "¿Qué pediste? Toca para confirmar — me ayuda a aprender." : "What did you mean? Tap to confirm — helps me learn."}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {["ask","order","feedback","memory","capture"].map((opt) => (
                            <button key={opt} onClick={() => confirmIntent(i, opt)} className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide ${m.intent === opt ? "border-ink bg-paper-deep" : "border-line bg-paper hover:border-ink-soft"}`}>{opt}</button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {m.memoryProposal?.fact ? (
                      <div className="mt-2 rounded-xl border border-line bg-paper-deep/40 p-3">
                        <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{lang === "es" ? "¿Recordar?" : "Remember?"}</p>
                        <p className="mt-1 font-serif italic text-[14px] text-ink">{m.memoryProposal.fact}</p>
                        <div className="mt-2 flex gap-2">
                          <button onClick={() => saveMemory(i)} className="rounded-full border border-ink bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-paper">{lang === "es" ? "✓ guardar" : "✓ save"}</button>
                          <button onClick={() => setLog((l) => l.map((x, j) => j === i ? { ...x, memoryProposal: null } : x))} className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink">{lang === "es" ? "× descartar" : "× dismiss"}</button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              {text ? <p className="font-serif text-[17px] leading-relaxed text-ink">{text}</p> : null}
            </div>

            {orderDraft ? (
              <button onClick={() => { localStorage.setItem("fs_order_draft", JSON.stringify(orderDraft)); window.location.href = "/execute/orders"; }} style={{ background: "var(--accent)" }} className="mx-3 mb-2 rounded-xl px-4 py-2.5 text-center font-sans text-[13px] font-medium text-[#F7F7F4]">{lang === "es" ? "Borrador en Pedidos →" : "Draft this order in Ordering →"}</button>
            ) : null}

            <div className="flex items-center gap-3 border-t border-black/10 p-3">
              <input value={text} onChange={(e) => { setText(e.target.value); textRef.current = e.target.value; }} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder={lang === "es" ? "…o escribe a Chef" : "…or type to Chef"} className="min-w-0 flex-1 rounded-full border border-black/15 bg-paper px-4 py-2 font-sans text-[14px] text-ink outline-none focus:border-ink" />
              {text ? <button onClick={send} style={{ background: "var(--accent)" }} className="shrink-0 rounded-full px-4 py-2 font-sans text-[13px] font-medium text-[#F7F7F4]">{lang === "es" ? "Enviar" : "Send"}</button> : null}
            </div>
            <p className="px-4 pb-2 text-center font-mono text-[9px] uppercase tracking-wide text-clay">{status || (supported ? (lang === "es" ? "Toca Chef · mantén = cámara" : "Tap Chef · hold to open") : (lang === "es" ? "Escribe arriba" : "Type above"))}</p>
          </div>
        </>
      ) : null}
    </>
  );
}
