"use client";

// ChefRoot — Chef v3 Phase 1, the OS front door (brief Part 2).
//
// Mounted once from app/layout.tsx. Owns the state machine
// (idle | listening | thinking | result | confirm | error), the voice loop
// (lib/chef/voice), the one-line type field, the result card and the
// confirm gate. No chat drawer, no scrollback, no close button.
//
// Layout contract:
//   • Phone: the control sits bottom-centre inside a 96 px reserve
//     (`--chef-dock`, body[data-chef="on"] padding — see globals.css). The
//     card is a sheet that rises from the reserve. A page-dim shows while
//     listening.
//   • Desktop (lg+): the control sits at the bottom of the sidebar column;
//     cards open in a 380 px column right of the sidebar and PUSH the page
//     (body[data-chef-panel="open"] → .fs-main padding), never overlay it.
//   • FabHidden (body[data-fab="hidden"]) collapses the reserve and hides
//     everything — the /capture live camera needs the space.
//
// Writes: undoable ones (remember, feedback, prep/todo add) execute at once
// and show Undo for 10 s; anything that leaves the account (run_agent)
// shows the read-back and waits for a tap on Yes. No voice-yes in Phase 1.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import ChefControl, { type ChefState } from "@/components/chef/ChefControl";
import ChefCard from "@/components/chef/ChefCard";
import { ChefVoice, type VoiceBackend } from "@/lib/chef/voice";
import type { ChefTurn, ChefAction, ChefActResult, ChefCard as CardT, ChefCardAction } from "@/lib/chef/types";
import { getMyProfile, type MyProfile } from "@/lib/profile";
import { E_HOLDINGS, type EntityKey, isPrimaryEntity } from "@/lib/entities";
import { readEntityCookie } from "@/lib/ctx";
import { pillarForRoute } from "@/lib/routing/pillar-map";
import { scopeForUrl } from "@/lib/scope";
import { HOUSE_SLUG_TO_ENTITY, houseSlugForEntity, listHouses } from "@/lib/houses";
import { isChefHiddenRoute } from "@/lib/routing/public-routes";
import { t, getLang } from "@/lib/i18n";
import { Z } from "@/lib/ui/z";

const UNDO_MS = 10_000;
const READ_DISSOLVE_MS = 6_000;
const STILL_WORKING_MS = 4_000;
const SILENCE_MS = 8_000;

type Pending = { turn: ChefTurn; voice: boolean };

// Spoken replies can be switched off by voice ("silencio" / "mute") — the iOS
// silent switch does NOT mute <audio> elements, so this is the kitchen's mute.
const SPEECH_KEY = "fs_chef_speech";
export function speechOn(): boolean {
  try { return typeof localStorage === "undefined" || localStorage.getItem(SPEECH_KEY) !== "off"; } catch { return true; }
}
export function setSpeechOn(on: boolean) {
  try { if (on) localStorage.removeItem(SPEECH_KEY); else localStorage.setItem(SPEECH_KEY, "off"); } catch {}
}

// The turn log carries how each turn ended (chef-log page, wrong-action rate).
async function logResolution(turnId: string | null | undefined, resolution: string, result?: string | null) {
  if (!turnId) return;
  try {
    await fetch("/api/chef/turn", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ turn_id: turnId, resolution, result: result || null }), keepalive: true });
  } catch {}
}

export default function ChefRoot() {
  const pathname = usePathname() || "";
  const router = useRouter();

  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [hidden, setHidden] = useState(false);
  const [state, setState] = useState<ChefState>("idle");
  const [level, setLevel] = useState(0);
  const [partial, setPartial] = useState("");
  const [transcript, setTranscript] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [stillWorking, setStillWorking] = useState(false);
  const [card, setCard] = useState<CardT | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [undoToken, setUndoToken] = useState<string | null>(null);
  const [undoLeft, setUndoLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [housePick, setHousePick] = useState(false);
  const [entitySel, setEntitySel] = useState<string | null>(null);
  const [desktop, setDesktop] = useState(false);

  const voiceRef = useRef<ChefVoice | null>(null);
  const sessionRef = useRef("");
  const dissolveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const captureParent = useRef<string | null>(null); // multi-shot: the invoice_inbox row the next photo appends to
  const turnSeq = useRef(0);
  const lastTurnId = useRef<string | null>(null);

  const lang = (getLang() === "es" ? "es" : "en") as "es" | "en";

  // --- identity + scope ----------------------------------------------------
  useEffect(() => {
    getMyProfile().then(setProfile).catch(() => setProfile(null));
    try { sessionRef.current = (crypto as any).randomUUID?.() || String(Date.now()); } catch { sessionRef.current = String(Date.now()); }
  }, []);

  useEffect(() => {
    const read = () => setEntitySel(readEntityCookie());
    read();
  }, [pathname]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const upd = () => setDesktop(mq.matches);
    upd();
    mq.addEventListener("change", upd);
    return () => mq.removeEventListener("change", upd);
  }, []);

  const scope = useMemo(() => {
    const s = scopeForUrl(pathname);
    if (s && (s.level === "house" || s.level === "room")) {
      const ent = HOUSE_SLUG_TO_ENTITY[s.houseSlug];
      return { entityId: (ent as string) || null, house: s.houseSlug as string };
    }
    const c = entitySel && isPrimaryEntity(entitySel) ? (entitySel as EntityKey) : null;
    const ent = c || profile?.entity || null;
    return { entityId: ent as string | null, house: houseSlugForEntity(ent as EntityKey | null) };
  }, [pathname, entitySel, profile]);

  const entityId = scope.entityId || E_HOLDINGS;

  // --- visibility gates ----------------------------------------------------
  useEffect(() => {
    if (typeof document === "undefined") return;
    const check = () => setHidden(document.body.getAttribute("data-fab") === "hidden");
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { attributes: true, attributeFilter: ["data-fab"] });
    return () => mo.disconnect();
  }, [pathname]);

  const routeHidden = isChefHiddenRoute(pathname);
  const visible = !!profile && !routeHidden && !hidden;

  // The layout reserve follows the mount: body[data-chef="on"] pads the
  // bottom 96 px; FabHidden zeroes --chef-dock (globals.css).
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (visible) document.body.setAttribute("data-chef", "on");
    else document.body.removeAttribute("data-chef");
    return () => { document.body.removeAttribute("data-chef"); };
  }, [visible]);

  const panelOpen = visible && (state !== "idle" || typing);
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (panelOpen) document.body.setAttribute("data-chef-panel", "open");
    else document.body.removeAttribute("data-chef-panel");
  }, [panelOpen]);

  // --- timers ---------------------------------------------------------------
  const clearTimers = useCallback(() => {
    if (dissolveTimer.current) { clearTimeout(dissolveTimer.current); dissolveTimer.current = null; }
    if (undoTimer.current) { clearInterval(undoTimer.current); undoTimer.current = null; }
    if (silenceTimer.current) { clearTimeout(silenceTimer.current); silenceTimer.current = null; }
    if (workingTimer.current) { clearTimeout(workingTimer.current); workingTimer.current = null; }
  }, []);

  const toIdle = useCallback(() => {
    clearTimers();
    setState("idle"); setCard(null); setPending(null); setTranscript(null); setPartial("");
    setUndoToken(null); setUndoLeft(0); setStillWorking(false); setSlow(false); setBusy(false);
  }, [clearTimers]);

  const scheduleDissolve = useCallback((ms: number) => {
    if (dissolveTimer.current) clearTimeout(dissolveTimer.current);
    dissolveTimer.current = setTimeout(() => toIdle(), ms);
  }, [toIdle]);

  const showResult = useCallback((c: CardT, opts?: { undo?: string | null; keep?: boolean }) => {
    clearTimers();
    setCard(c); setState(c.kind === "error" ? "error" : "result"); setBusy(false); setStillWorking(false);
    const persist = !!c.persist;
    if (opts?.undo) {
      setUndoToken(opts.undo); setUndoLeft(UNDO_MS);
      const t0 = Date.now();
      undoTimer.current = setInterval(() => {
        const left = UNDO_MS - (Date.now() - t0);
        setUndoLeft(left > 0 ? left : 0);
        if (left <= 0) {
          if (undoTimer.current) clearInterval(undoTimer.current); undoTimer.current = null; setUndoToken(null);
          // A persistent card (capture result) stays until "Looks right" / "Fix"; only the Undo goes.
          if (!persist) toIdle();
        }
      }, 250);
      return;
    }
    if (!opts?.keep && !persist) scheduleDissolve(READ_DISSOLVE_MS);
  }, [clearTimers, scheduleDissolve, toIdle]);

  // --- TTS (voice turns only) ------------------------------------------------
  const unlockAudio = useCallback(() => {
    // iOS only plays <audio> that was touched inside a gesture; touch it now.
    try {
      if (!audioRef.current) return;
      const a = audioRef.current;
      if (!a.src) a.src = "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQxAADB8AhSmxhIIEVCSiJrDCQBTcu3UrAIwUdkRgQbFAZC1CQEwTJ9mjRvBA4UOLD8nKVOWfh+UlK3z/177OXrfOdKl7pyn3Xf//WreyTRUoAWgBgkOAGbZHBgG1OF6zM82DWbZaUmMBptgQhGjsyYqc9ae8XmDgCUHW1CqFO+gHNCXGgDD4LZ4gVX0mGWU+8yJP9AEIABQhr0ozEIHMBmvv1aaP//gcDIUjYAABAAAAsWkB/f6Xy1eaqjCu0E6A6SSy13vKHy1kUlmsNvETDvDrJnQQdTqDU//NkxBQ8s3xUAAAAEnAYAAAA";
      void a.play().catch(() => {});
    } catch {}
  }, []);

  const speak = useCallback(async (text: string) => {
    try {
      const r = await fetch("/api/chef/say", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, lang }) });
      if (r.status !== 200) return;
      const blob = await r.blob();
      const a = audioRef.current; if (!a) return;
      a.src = URL.createObjectURL(blob);
      await a.play().catch(() => {});
    } catch {}
  }, [lang]);

  const stopSpeaking = useCallback(() => {
    try { const a = audioRef.current; if (a && !a.paused) a.pause(); } catch {}
  }, []);

  // --- executing writes -----------------------------------------------------
  const act = useCallback(async (action: ChefAction): Promise<ChefActResult> => {
    try {
      const r = await fetch("/api/chef/act", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, language: lang }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) return { ok: false, error: d?.error || ("HTTP " + r.status) };
      return d as ChefActResult;
    } catch (e: any) {
      return { ok: false, error: e?.message || "network" };
    }
  }, [lang]);

  const runAction = useCallback(async (action: ChefAction, voice: boolean) => {
    setBusy(true);
    const res = await act(action);
    if (!res.ok) {
      showResult({ title: t("chef.error"), lines: [res.error || t("chef.offline")], kind: "error" }, { keep: false });
      return;
    }
    if (res.navigate) { toIdle(); router.push(res.navigate); return; }
    const c: CardT = res.card || { title: t("chef.done"), lines: [], kind: "write" };
    void logResolution(lastTurnId.current, "done", c.title);
    showResult(c, { undo: res.undo_token || null, keep: !res.undo_token });
    if (voice) void speak(c.title);
    if (!res.undo_token) scheduleDissolve(READ_DISSOLVE_MS);
  }, [act, router, scheduleDissolve, showResult, speak, toIdle]);

  const onUndo = useCallback(async () => {
    if (!undoToken) return;
    const tok = undoToken;
    void logResolution(lastTurnId.current, "undone");
    setUndoToken(null); setUndoLeft(0);
    if (undoTimer.current) { clearInterval(undoTimer.current); undoTimer.current = null; }
    setBusy(true);
    const res = await act({ type: "undo", undo_token: tok });
    showResult(res.ok ? (res.card || { title: t("chef.undone"), lines: [], kind: "write" }) : { title: t("chef.error"), lines: [res.error || ""], kind: "error" });
  }, [act, showResult, undoToken]);

  // --- the turn ---------------------------------------------------------------
  const applyTurn = useCallback(async (turn: ChefTurn, voice: boolean) => {
    setTranscript(turn.transcript || null);
    lastTurnId.current = turn.turn_id || null;
    if (turn.navigate && turn.intent.kind !== "capture") {
      toIdle();
      if (voice && turn.say) void speak(turn.say);
      router.push(turn.navigate);
      return;
    }
    if (turn.intent.kind === "capture") {
      // A file input only opens inside a user gesture; a voice turn ends
      // long after the tap. Offer the shutter as the card's one button.
      clearTimers();
      setCard({ title: turn.say, lines: [t("chef.tap_to_talk").split("·")[1]?.trim() || ""], kind: "read", primary: { label: "📷 " + t("capture.title"), kind: "capture_page", capture_id: "" } });
      setState("result"); setBusy(false);
      if (voice && speechOn()) void speak(turn.say);
      return;
    }
    if (turn.needs_confirm && turn.action) {
      clearTimers();
      setPending({ turn, voice });
      setCard(turn.card || { title: turn.say, lines: [], kind: "confirm", entity_label: undefined });
      setState("confirm");
      setBusy(false);
      if (voice) void speak(turn.readback || turn.say);
      return;
    }
    if (turn.action && turn.undoable) {
      // Low-stakes write: do it now, offer Undo.
      setCard(turn.card || null);
      await runAction(turn.action, voice);
      return;
    }
    const c: CardT = turn.card || { title: turn.say || "…", lines: [], kind: "read", entity_label: undefined };
    showResult(c, { keep: turn.intent.kind === "clarify" || c.kind === "error" });
    if (voice && turn.say) void speak(turn.say);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTimers, router, runAction, showResult, speak, toIdle]);

  const submit = useCallback(async (text: string, voice: boolean) => {
    const trimmed = text.trim();
    if (!trimmed) { toIdle(); return; }
    const seq = ++turnSeq.current;
    clearTimers();
    setState("thinking"); setTranscript(trimmed); setPartial(""); setCard(null); setPending(null);
    workingTimer.current = setTimeout(() => setStillWorking(true), STILL_WORKING_MS);
    try {
      const basePageCtx = (typeof window !== "undefined" ? (window as any).__fsAssistantContext : null) || {};
      const r = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          route: pathname,
          session_id: sessionRef.current,
          entity_id: entityId,
          house: scope.house || undefined,
          language: lang,
          voice,
          page_context: { ...basePageCtx, active_pillar: pillarForRoute(pathname) },
        }),
      });
      const d = (await r.json().catch(() => ({}))) as ChefTurn;
      if (seq !== turnSeq.current) return; // a newer turn superseded this one
      if (!r.ok || !d || !d.intent) {
        showResult({ title: t("chef.error"), lines: [(d as any)?.reply || t("chef.offline")], kind: "error" });
        return;
      }
      await applyTurn(d, voice);
    } catch (e: any) {
      if (seq !== turnSeq.current) return;
      showResult({ title: t("chef.offline"), lines: [e?.message || "network"], kind: "error" });
    }
  }, [applyTurn, clearTimers, entityId, lang, pathname, scope.house, showResult, toIdle]);

  // --- voice loop ---------------------------------------------------------------
  const getVoice = useCallback(() => {
    if (voiceRef.current) return voiceRef.current;
    const v = new ChefVoice({
      lang, entityId, route: pathname,
      events: {
        onLevel: (l) => setLevel(l),
        onPartial: (p) => setPartial(p),
        onFinal: (text, meta) => {
          setLevel(0);
          setSlow(!!meta.slow && meta.backend === "whisper" && meta.ms > 1200);
          if (!text) { toIdle(); return; }
          void submit(text, true);
        },
        onError: (msg) => {
          setLevel(0);
          showResult({ title: t("chef.mic_needed"), lines: [msg], kind: "error" });
        },
      },
    });
    voiceRef.current = v;
    return v;
  }, [entityId, lang, pathname, showResult, submit, toIdle]);

  useEffect(() => () => { voiceRef.current?.dispose(); voiceRef.current = null; }, []);

  const startListening = useCallback(() => {
    stopSpeaking();
    unlockAudio();
    clearTimers();
    setTyping(false);
    setCard(null); setPending(null); setTranscript(null); setPartial(""); setSlow(false); setStillWorking(false);
    setState("listening");
    const v = getVoice();
    void v.start();
    // 8 s of nothing → back to idle, nothing sent.
    silenceTimer.current = setTimeout(() => { if (v.listening) { v.cancel(); toIdle(); } }, SILENCE_MS);
  }, [clearTimers, getVoice, stopSpeaking, toIdle, unlockAudio]);

  const stopListening = useCallback(() => {
    const v = voiceRef.current;
    if (silenceTimer.current) { clearTimeout(silenceTimer.current); silenceTimer.current = null; }
    // "heard: …" locks NOW (≤ 200 ms): the partial we have, or the
    // placeholder while Whisper finishes. The final overwrites it.
    setState("thinking");
    setTranscript(partial || "…");
    workingTimer.current = setTimeout(() => setStillWorking(true), STILL_WORKING_MS);
    v?.stop();
  }, [partial]);

  // --- gestures -------------------------------------------------------------------
  const onTap = useCallback(() => {
    if (state === "listening") { stopListening(); return; }
    if (state === "confirm") return; // Yes / No are on the card; a tap on the control does nothing
    startListening();
  }, [startListening, state, stopListening]);

  const houses = useMemo(() => listHouses(), []);
  const captureEntity = useRef<string | null>(null);

  // Phase 2: hold = the camera itself (a capture-enabled file input → the
  // iOS camera sheet), not a trip to /capture. The photo posts to the
  // existing /api/capture/rich pipeline (Sonnet vision → invoice_inbox +
  // purchase_lines) and comes back as a card with the parsed lines,
  // "Looks right" / "Fix" / "Add page", and Undo (24 h server-side).
  const openCamera = useCallback((entity: string, parent: string | null) => {
    captureEntity.current = entity;
    captureParent.current = parent;
    const el = fileRef.current;
    if (!el) return;
    el.value = "";
    el.click();
  }, []);

  const startCapture = useCallback((parent: string | null = null) => {
    const ent = scope.entityId;
    if (ent && ent !== E_HOLDINGS) { openCamera(ent, parent); return; }
    if (houses.length === 1) { openCamera(houses[0].entity, parent); return; }
    setHousePick(true);
  }, [houses, openCamera, scope.entityId]);

  const captureCard = useCallback((j: any, entityLabel: string | undefined): CardT => {
    const typeLabel = j.type === "albaran" ? (lang === "es" ? "Albarán" : "Delivery note")
      : j.type === "invoice" ? (lang === "es" ? "Factura" : "Invoice")
      : j.type === "eod" ? (lang === "es" ? "Cierre" : "EOD report") : (lang === "es" ? "Documento" : "Document");
    const lines: string[] = [];
    const n = Number(j.lines_stored ?? (j.lines || []).length);
    const total = j.grand_total_eur != null ? "€" + Number(j.grand_total_eur).toFixed(2) : null;
    lines.push([typeLabel, j.document_date, n + " " + t("chef.lines"), total, j.pages > 1 ? j.pages + " " + t("chef.pages") : null].filter(Boolean).join(" · "));
    for (const ln of (j.lines || []).slice(0, 3)) {
      const q = [ln.quantity, ln.unit, ln.product_name].filter((x: any) => x != null && x !== "").join(" ");
      const lt = ln.line_total_eur != null ? " · €" + Number(ln.line_total_eur).toFixed(2) : "";
      lines.push((q || "—") + lt);
    }
    const id = String(j.capture_id || "");
    return {
      title: j.supplier_name || typeLabel,
      lines: lines.slice(0, 4),
      kind: "write",
      entity_label: entityLabel,
      persist: true,
      primary: { label: t("chef.looks_right"), kind: "none" },
      chip: { label: t("chef.fix"), kind: "navigate", href: "/administrate/finance/scans?id=" + encodeURIComponent(id) },
      secondary: id ? { label: t("chef.add_page"), kind: "capture_page", capture_id: id } : undefined,
    };
  }, [lang]);

  const onFilePicked = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const entity = captureEntity.current;
    const parent = captureParent.current;
    if (!file || !entity) return;
    const seq = ++turnSeq.current;
    clearTimers();
    setState("thinking"); setTranscript("📷 " + t("chef.photo")); setPartial(""); setCard(null); setPending(null);
    workingTimer.current = setTimeout(() => setStillWorking(true), STILL_WORKING_MS);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name || "capture.jpg");
      fd.append("type", "auto");
      fd.append("entity", entity);
      fd.append("via", "chef");
      if (parent) fd.append("parent_capture_id", parent);
      const r = await fetch("/api/capture/rich", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (seq !== turnSeq.current) return;
      if (!r.ok || !j?.ok) { showResult({ title: t("chef.capture_failed"), lines: [j?.error || ("HTTP " + r.status)], kind: "error" }); return; }
      const label = houses.find((h) => h.entity === entity)?.name;
      const c = captureCard(j, label);
      // The parent's undo (first page) already covers later pages.
      showResult(c, { undo: parent ? (undoToken || null) : (j.undo_token || null), keep: true });
      if (speechOn()) void speak(c.title + (j.lines_stored ? ", " + j.lines_stored + " " + t("chef.lines") : ""));
      void logResolution(null, "done", c.title);
    } catch (err: any) {
      if (seq !== turnSeq.current) return;
      showResult({ title: t("chef.capture_failed"), lines: [err?.message || "network"], kind: "error" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureCard, clearTimers, houses, showResult, speak, undoToken]);

  const onHold = useCallback(() => {
    if (state === "listening") return;
    toIdle();
    startCapture();
  }, [startCapture, state, toIdle]);

  const openType = useCallback(() => {
    if (state === "listening") { voiceRef.current?.cancel(); }
    clearTimers();
    setState("idle"); setCard(null); setPending(null);
    setTyping(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  }, [clearTimers, state]);

  // ⌘J / Ctrl+J = type; Escape closes the field or cancels listening.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") { e.preventDefault(); if (visible) openType(); return; }
      if (e.key === "Escape") {
        if (typing) { setTyping(false); setTyped(""); return; }
        if (state === "listening") { voiceRef.current?.cancel(); toIdle(); return; }
        if (state === "confirm") { toIdle(); return; }
      }
    };
    const onOpen = () => { if (visible) openType(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("fs:chef:open", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("fs:chef:open", onOpen); };
  }, [openType, state, toIdle, typing, visible]);

  const onTypedSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const v = typed.trim();
    if (!v) return;
    setTyped(""); setTyping(false);
    void submit(v, false);
  }, [submit, typed]);

  // --- card handlers -----------------------------------------------------------------
  const onCardAction = useCallback((a: ChefCardAction) => {
    if (a.kind === "navigate") { toIdle(); router.push(a.href); return; }
    if (a.kind === "none") { toIdle(); return; }
    if (a.kind === "capture_page") { startCapture(a.capture_id || null); return; }
    if (a.kind === "act") { void runAction(a.action, false); }
  }, [router, runAction, startCapture, toIdle]);

  const onYes = useCallback(() => {
    if (!pending?.turn.action) return;
    const { turn, voice } = pending;
    setPending(null);
    void logResolution(turn.turn_id, "confirmed_tap");
    void runAction(turn.action!, voice);
  }, [pending, runAction]);

  const onNo = useCallback(() => {
    void logResolution(pending?.turn.turn_id, "declined");
    toIdle();
  }, [pending, toIdle]);

  const onBody = useCallback(() => {
    if (card?.href) { const h = card.href; toIdle(); router.push(h); }
  }, [card, router, toIdle]);

  if (!visible) return null;

  const showCard = !!card && (state === "result" || state === "confirm" || state === "error");
  const showHeard = state === "thinking" || (state === "listening" && !!partial);
  const surface = showCard || showHeard || typing || state === "listening";

  return (
    <>
      <audio ref={audioRef} playsInline preload="none" className="hidden" />
      {/* Hold → camera. `capture` opens the rear camera directly on iOS/Android; desktop gets a file picker. */}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFilePicked} />

      {/* Page-dim while listening (phone + desktop). Tap = cancel. */}
      {state === "listening" ? (
        <div
          aria-hidden
          className="fixed inset-0 bg-ink/30"
          style={{ zIndex: Z.chefDock - 1 }}
          onClick={() => { voiceRef.current?.cancel(); toIdle(); }}
        />
      ) : null}

      {/* Result surface — phone: sheet above the reserve; desktop: 380 px column beside the sidebar */}
      {surface ? (
        <div
          data-chef-surface
          className={
            "fixed inset-x-0 flex flex-col justify-end px-3 pointer-events-none " +
            "lg:inset-x-auto lg:top-0 lg:bottom-0 lg:justify-start lg:border-r lg:border-line lg:bg-paper lg:px-4 lg:pt-6 lg:pointer-events-auto"
          }
          style={{
            zIndex: Z.chefCard,
            bottom: "var(--chef-dock)",
            // On lg the column starts right of the sidebar and has the fixed width.
            ...(desktop ? { left: "var(--chef-sidebar, 15rem)", width: "var(--chef-panel, 380px)", bottom: 0 } : {}),
          }}
        >
          <div className="pointer-events-auto flex flex-col gap-2 pb-2 lg:pb-0">
            {state === "listening" ? (
              <p className="rounded-xl bg-paper px-4 py-3 font-sans text-[17px] leading-snug text-ink shadow-lg">
                {partial || t("chef.listening")}
              </p>
            ) : null}
            {showHeard && state === "thinking" ? (
              <div className="rounded-xl bg-paper px-4 py-3 shadow-lg">
                <p className="font-mono text-[13px] leading-snug text-clay">
                  <span className="uppercase tracking-wide">{t("chef.heard")}</span>{" "}
                  <span className="text-ink-soft">{transcript || "…"}</span>
                </p>
                <p className="mt-1 flex items-center gap-2 font-sans text-[15px] text-ink-soft">
                  {stillWorking ? t("chef.still_working") : t("chef.thinking")}
                  {slow ? (
                    <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[11px] uppercase tracking-wide text-clay">{t("chef.slow")}</span>
                  ) : null}
                </p>
              </div>
            ) : null}
            {showCard && card ? (
              <ChefCard
                card={card}
                transcript={transcript}
                readback={pending?.turn.readback || null}
                mode={state === "confirm" ? "confirm" : state === "error" ? "error" : "result"}
                undoLeftMs={undoLeft}
                busy={busy}
                onPrimary={onCardAction}
                onChip={onCardAction}
                onBody={onBody}
                onYes={onYes}
                onNo={onNo}
                onUndo={onUndo}
              />
            ) : null}
            {typing ? (
              <form onSubmit={onTypedSubmit} className="flex items-center gap-2 rounded-2xl border border-line bg-paper px-3 py-2 shadow-lg">
                <input
                  ref={inputRef}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={t("chef.type_placeholder")}
                  enterKeyHint="send"
                  autoComplete="off"
                  className="h-11 flex-1 bg-transparent font-sans text-[17px] text-ink outline-none placeholder:text-clay"
                />
                <button type="submit" disabled={!typed.trim()} className="h-11 rounded-xl px-4 font-sans text-[15px] font-medium text-paper disabled:opacity-40" style={{ background: "var(--accent)" }}>
                  {t("chef.send")}
                </button>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* The control — the only fixed element in the bottom 96 px. */}
      <div
        data-chef-dock
        className="fixed inset-x-0 bottom-0 flex items-end justify-center pointer-events-none lg:inset-x-auto lg:left-0"
        style={{
          zIndex: Z.chefDock,
          height: "var(--chef-dock)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          width: desktop ? "var(--chef-sidebar, 15rem)" : undefined,
        }}
      >
        <div className="pointer-events-auto">
          <ChefControl state={state} level={level} onTap={onTap} onHold={onHold} onDragUp={openType} />
        </div>
      </div>

      {/* House picker for capture from Studio scope. */}
      {housePick ? (
        <div role="dialog" aria-modal="true" className="fixed inset-0 flex items-center justify-center bg-ink/40 p-4" style={{ zIndex: Z.modal }} onClick={() => setHousePick(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-line bg-paper shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-line px-5 py-3">
              <p className="font-mono text-[11px] uppercase tracking-wide text-clay">{t("capture.title")}</p>
              <h2 className="mt-1 font-serif text-[20px] text-ink">{t("chef.which_house")}</h2>
            </div>
            <ul className="p-2">
              {houses.map((h) => (
                <li key={h.slug}>
                  <button
                    onClick={() => { setHousePick(false); openCamera(h.entity, null); }}
                    className="flex h-14 w-full items-center justify-between rounded-xl px-3 text-left font-sans text-[17px] text-ink active:bg-paper-deep"
                  >
                    <span>{h.name}</span>
                    <span className="font-mono text-[11px] uppercase text-clay">/{h.slug}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
