// Chef v3 Phase 1 — push-to-talk voice capture.
//
// Two backends behind one class:
//   whisper  — MediaRecorder blob → /api/assistant/voice/transcribe (today's
//              production path; result arrives after release, so the UI shows
//              a placeholder and a "slow" pill).
//   deepgram — PCM over WebSocket to Nova-3 with live partials; enabled the
//              moment /api/chef/voice-token returns a key. Whisper keeps
//              recording underneath as the safety net for a dead socket.
//
// Push-to-talk only. No VAD, no wake word: kitchens run ~85 dBA and any
// open-mic trigger would fire all service. Plain browser module, no React.

import { E_BM, E_HOLDINGS, E_TALLER } from "@/lib/entities";

export type VoiceBackend = "deepgram" | "whisper";

export type VoiceEvents = {
  onLevel?: (rms0to1: number) => void;         // ~20 Hz, for the level ring
  onPartial?: (text: string) => void;           // live partial (deepgram only)
  onFinal: (text: string, meta: { backend: VoiceBackend; ms: number; slow: boolean }) => void;
  onError: (message: string) => void;
};

type ChefVoiceOpts = { lang: "es" | "en"; entityId: string; route: string; events: VoiceEvents };

const MAX_TURN_MS = 60_000;          // Whisper cap; nobody holds the button longer
const DG_OPEN_TIMEOUT_MS = 1500;     // socket must open by then or we fall back
const DG_CLOSE_TIMEOUT_MS = 1500;    // after CloseStream, use what we have
const LEVEL_INTERVAL_MS = 50;
const KEYTERM_TTL_MS = 10 * 60_000;
const KEYTERM_CAP = 100;
const PCM_CHUNK_FRAMES = 2048;       // ~43 ms at 48 kHz: small enough for partials, not chatty

// Whisper hallucinates these on silence / breath. Same list as the v2 drawer.
const WHISPER_JUNK = new Set([
  "thank you for watching", "thanks for watching", "thanks for watching!",
  "thank you.", "thank you", "thank you very much", "you", "bye", "bye.",
  "bye bye", ".", "..", "...", "¡gracias por ver!", "gracias por ver", "gracias",
]);
export function scrubWhisper(raw: string): string {
  const t = (raw || "").trim();
  if (!t) return "";
  const lc = t.toLowerCase().replace(/[!?.,]+$/, "").trim();
  if (WHISPER_JUNK.has(lc)) return "";
  return t;
}

const hasWindow = () => typeof window !== "undefined";

// ---------------------------------------------------------------------------
// Backend probe + short-lived Deepgram token (module cache, one per session)
// ---------------------------------------------------------------------------

type TokenInfo = { token: string; expiresAt: number };
let backendPromise: Promise<VoiceBackend> | null = null;
let tokenCache: TokenInfo | null = null;

async function fetchVoiceToken(): Promise<TokenInfo | null> {
  try {
    const r = await fetch("/api/chef/voice-token", { cache: "no-store" });
    const d: any = await r.json().catch(() => ({}));
    if (r.ok && d?.ok && typeof d.token === "string" && d.token) {
      const ttl = typeof d.ttl_seconds === "number" ? d.ttl_seconds : 120;
      return { token: d.token, expiresAt: Date.now() + ttl * 1000 };
    }
  } catch {}
  return null;
}

export async function probeVoiceBackend(): Promise<VoiceBackend> {
  if (!hasWindow()) return "whisper";
  if (!backendPromise) {
    backendPromise = fetchVoiceToken().then((t) => {
      if (!t) return "whisper";
      tokenCache = t;
      return "deepgram";
    });
  }
  return backendPromise;
}

// Keys live 120 s; refresh when under 15 s so the socket never opens on a
// key that dies mid-turn.
async function getDeepgramToken(): Promise<string | null> {
  if (tokenCache && tokenCache.expiresAt - Date.now() > 15_000) return tokenCache.token;
  const t = await fetchVoiceToken();
  tokenCache = t;
  return t?.token ?? null;
}

// ---------------------------------------------------------------------------
// Keyterms (recipe / staff / provider names) — cached per entity for 10 min
// ---------------------------------------------------------------------------

const keytermCache = new Map<string, { at: number; terms: string[]; p: Promise<string[]> | null }>();

async function getKeyterms(entityId: string): Promise<string[]> {
  const hit = keytermCache.get(entityId);
  if (hit && Date.now() - hit.at < KEYTERM_TTL_MS) return hit.p ?? hit.terms;
  const p = (async () => {
    try {
      const r = await fetch(`/api/chef/keyterms?entity=${encodeURIComponent(entityId)}`);
      const d: any = await r.json().catch(() => ({}));
      const terms = Array.isArray(d?.terms) ? d.terms.filter((x: unknown) => typeof x === "string") : [];
      keytermCache.set(entityId, { at: Date.now(), terms, p: null });
      return terms as string[];
    } catch {
      keytermCache.set(entityId, { at: Date.now(), terms: [], p: null });
      return [];
    }
  })();
  keytermCache.set(entityId, { at: Date.now(), terms: [], p });
  return p;
}

// The transcribe route logs by legacy entity code; anything else maps to IFL.
function legacyEntityCode(entityId: string): string {
  if (entityId === E_BM) return "BM";
  if (entityId === E_HOLDINGS) return "BBH";
  if (entityId === E_TALLER) return "IFL";
  return "IFL";
}

function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {}
  }
  return "";
}

function extForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("mp4")) return "m4a";
  if (m.includes("ogg")) return "ogg";
  return "webm";
}

// Inline AudioWorklet so no extra static file has to be served. Accumulates
// mono Float32 frames and posts Int16 PCM in ~43 ms chunks.
const WORKLET_SRC = `
class ChefPcmProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(${PCM_CHUNK_FRAMES}); this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n++] = s < 0 ? s * 32768 : s * 32767;
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf.buffer.slice(0));
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("chef-pcm", ChefPcmProcessor);
`;

function floatToInt16(f: Float32Array): ArrayBuffer {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const s = Math.max(-1, Math.min(1, f[i]));
    out[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return out.buffer;
}

// ---------------------------------------------------------------------------
// ChefVoice
// ---------------------------------------------------------------------------

type DgTurn = {
  ws: WebSocket | null;
  finals: string[];
  partial: string;
  failed: boolean;             // socket never opened / errored → whisper this turn
  opened: boolean;
  closed: boolean;
  queue: ArrayBuffer[];        // PCM captured before the socket opened
  resolveClose: (() => void) | null;
};

export class ChefVoice {
  private opts: ChefVoiceOpts;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuf: Uint8Array | null = null;
  private levelTimer: ReturnType<typeof setInterval> | null = null;
  private capTimer: ReturnType<typeof setTimeout> | null = null;

  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private blobPromise: Promise<Blob | null> | null = null;
  private resolveBlob: ((b: Blob | null) => void) | null = null;

  private pcmNode: AudioWorkletNode | ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private workletReady: Promise<boolean> | null = null;
  private dg: DgTurn | null = null;

  private _backend: VoiceBackend = "whisper";
  private _listening = false;
  private turnId = 0;          // bumps on start/cancel so stale callbacks are dropped
  private stoppedAt = 0;

  constructor(opts: ChefVoiceOpts) {
    this.opts = opts;
    if (hasWindow()) {
      // Warm the caches so the first tap doesn't pay for the probe.
      void probeVoiceBackend().then((b) => { this._backend = b; });
      void getKeyterms(opts.entityId);
    }
  }

  get listening(): boolean { return this._listening; }
  get backend(): VoiceBackend { return this._backend; }

  // Call inside the pointerdown handler: getUserMedia and AudioContext.resume
  // both need the user gesture on iOS.
  async start(): Promise<void> {
    if (!hasWindow() || this._listening) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.opts.events.onError("Voice not supported in this browser.");
      return;
    }
    const turn = ++this.turnId;
    // Kick getUserMedia synchronously (still inside the gesture) before any await.
    const streamP = this.stream ? Promise.resolve(this.stream) : navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    try {
      this.ensureContext();
      const stream = await streamP;
      if (turn !== this.turnId) { stream.getTracks().forEach((t) => t.stop()); return; }
      this.stream = stream;
    } catch {
      this.opts.events.onError("Mic permission needed.");
      return;
    }
    this._backend = await probeVoiceBackend();
    if (turn !== this.turnId) return;

    this._listening = true;
    this.startLevel();

    // MediaRecorder always runs: primary for whisper, safety net for deepgram.
    this.startRecorder();

    if (this._backend === "deepgram") {
      await this.startDeepgram(turn);
    }
    this.capTimer = setTimeout(() => { if (this._listening) this.stop(); }, MAX_TURN_MS);
  }

  stop(): void {
    if (!this._listening) return;
    this._listening = false;
    this.stoppedAt = performance.now();
    this.clearCap();
    this.stopLevel();
    const turn = this.turnId;

    const blobP = this.stopRecorder();
    const dg = this.dg;
    this.dg = null;

    void (async () => {
      if (dg && !dg.failed) {
        const text = await this.finishDeepgram(dg);
        if (turn !== this.turnId) return;
        if (!dg.failed) {
          this.emitFinal(text, "deepgram", false);
          return;
        }
        // Socket died during the turn — fall through to the blob.
      }
      const blob = await blobP;
      if (turn !== this.turnId) return;
      if (!blob || blob.size < 400) { this.emitFinal("", "whisper", true); return; }
      const text = await this.transcribeWhisper(blob);
      if (turn !== this.turnId) return;
      this.emitFinal(text, "whisper", true);
    })();
  }

  cancel(): void {
    this.turnId++;               // orphan any in-flight callbacks
    this._listening = false;
    this.clearCap();
    this.stopLevel();
    const dg = this.dg;
    this.dg = null;
    if (dg) this.teardownDeepgram(dg);
    if (this.rec && this.rec.state !== "inactive") { try { this.rec.stop(); } catch {} }
    this.rec = null;
    this.chunks = [];
    this.resolveBlob?.(null);
    this.resolveBlob = null;
    this.blobPromise = null;
  }

  dispose(): void {
    this.cancel();
    if (this.pcmNode) { try { this.pcmNode.disconnect(); } catch {} this.pcmNode = null; }
    if (this.sink) { try { this.sink.disconnect(); } catch {} this.sink = null; }
    if (this.source) { try { this.source.disconnect(); } catch {} this.source = null; }
    this.analyser = null;
    if (this.ctx) { try { void this.ctx.close(); } catch {} this.ctx = null; }
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
  }

  // --- level ring ----------------------------------------------------------

  private ensureContext(): void {
    if (!this.ctx) {
      const AC: typeof AudioContext | undefined = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    if (this.ctx.state === "suspended") { try { void this.ctx.resume(); } catch {} }
  }

  private ensureGraph(): void {
    if (!this.ctx || !this.stream || this.source) return;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.5;
    this.levelBuf = new Uint8Array(this.analyser.fftSize);
    this.source.connect(this.analyser);
  }

  private startLevel(): void {
    this.ensureGraph();
    if (!this.analyser || !this.opts.events.onLevel) return;
    this.stopLevel();
    this.levelTimer = setInterval(() => {
      const a = this.analyser, buf = this.levelBuf;
      if (!a || !buf) return;
      a.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length);
      // Speech RMS sits around 0.05–0.3; stretch so a normal voice fills the ring.
      this.opts.events.onLevel?.(Math.min(1, rms * 3.5));
    }, LEVEL_INTERVAL_MS);
  }

  private stopLevel(): void {
    if (this.levelTimer) { clearInterval(this.levelTimer); this.levelTimer = null; }
    this.opts.events.onLevel?.(0);
  }

  private clearCap(): void {
    if (this.capTimer) { clearTimeout(this.capTimer); this.capTimer = null; }
  }

  // --- whisper (MediaRecorder) ---------------------------------------------

  private startRecorder(): void {
    if (!this.stream || typeof MediaRecorder === "undefined") return;
    const mime = pickRecorderMime();
    let rec: MediaRecorder;
    try {
      rec = mime ? new MediaRecorder(this.stream, { mimeType: mime }) : new MediaRecorder(this.stream);
    } catch {
      this.opts.events.onError("Recorder unavailable.");
      return;
    }
    this.chunks = [];
    this.blobPromise = new Promise<Blob | null>((res) => { this.resolveBlob = res; });
    rec.ondataavailable = (e: BlobEvent) => { if (e.data && e.data.size > 0) this.chunks.push(e.data); };
    rec.onstop = () => {
      const blob = this.chunks.length ? new Blob(this.chunks, { type: rec.mimeType || mime || "audio/webm" }) : null;
      this.chunks = [];
      this.resolveBlob?.(blob);
      this.resolveBlob = null;
    };
    rec.onerror = () => { this.resolveBlob?.(null); this.resolveBlob = null; };
    this.rec = rec;
    try { rec.start(); } catch { this.resolveBlob?.(null); this.resolveBlob = null; }
  }

  private stopRecorder(): Promise<Blob | null> {
    const p = this.blobPromise ?? Promise.resolve(null);
    const rec = this.rec;
    this.rec = null;
    if (rec && rec.state === "recording") { try { rec.stop(); } catch { this.resolveBlob?.(null); } }
    else { this.resolveBlob?.(null); }
    this.blobPromise = null;
    return p;
  }

  private async transcribeWhisper(blob: Blob): Promise<string> {
    try {
      const fd = new FormData();
      fd.append("audio", blob, `voice.${extForMime(blob.type)}`);
      fd.append("lang", this.opts.lang);
      fd.append("entity", legacyEntityCode(this.opts.entityId));
      fd.append("route", this.opts.route || "");
      const r = await fetch("/api/assistant/voice/transcribe", { method: "POST", body: fd });
      const d: any = await r.json().catch(() => ({}));
      if (!d?.ok) {
        // "no transcript" on a silent press is normal — treat as empty, not an error.
        const msg = String(d?.error || "");
        if (!/no transcript|too short/i.test(msg)) this.opts.events.onError(msg || "Couldn't transcribe — try again.");
        return "";
      }
      return scrubWhisper(String(d.text || ""));
    } catch (e: any) {
      this.opts.events.onError("Voice error: " + (e?.message || "unknown"));
      return "";
    }
  }

  // --- deepgram (PCM over WebSocket) ---------------------------------------

  private async startDeepgram(turn: number): Promise<void> {
    if (!this.ctx || !this.stream) return;
    const dg: DgTurn = { ws: null, finals: [], partial: "", failed: false, opened: false, closed: false, queue: [], resolveClose: null };
    this.dg = dg;

    const [token, terms] = await Promise.all([getDeepgramToken(), getKeyterms(this.opts.entityId)]);
    if (turn !== this.turnId || this.dg !== dg) return;
    if (!token) { dg.failed = true; return; }

    const rate = this.ctx.sampleRate;
    const qs: string[] = [
      "model=nova-3", "language=multi", "encoding=linear16", `sample_rate=${Math.round(rate)}`,
      "interim_results=true", "smart_format=true", "endpointing=false", "channels=1",
    ];
    for (const t of terms.slice(0, KEYTERM_CAP)) qs.push("keyterm=" + encodeURIComponent(t));
    const url = "wss://api.deepgram.com/v1/listen?" + qs.join("&");

    let ws: WebSocket;
    try { ws = new WebSocket(url, ["token", token]); }
    catch { dg.failed = true; return; }
    ws.binaryType = "arraybuffer";
    dg.ws = ws;

    const openTimer = setTimeout(() => {
      if (!dg.opened) { dg.failed = true; this.teardownDeepgram(dg); }
    }, DG_OPEN_TIMEOUT_MS);

    ws.onopen = () => {
      clearTimeout(openTimer);
      dg.opened = true;
      for (const buf of dg.queue) { try { ws.send(buf); } catch {} }
      dg.queue = [];
    };
    ws.onerror = () => {
      clearTimeout(openTimer);
      // Failing before any final means the turn is lost on this path → whisper.
      if (dg.finals.length === 0) dg.failed = true;
      dg.closed = true;
      dg.resolveClose?.();
    };
    ws.onclose = () => {
      clearTimeout(openTimer);
      if (!dg.opened && dg.finals.length === 0) dg.failed = true;
      dg.closed = true;
      dg.resolveClose?.();
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return;
      let m: any;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m?.type !== "Results") return;
      const text = String(m?.channel?.alternatives?.[0]?.transcript ?? "").trim();
      if (m.is_final) {
        if (text) dg.finals.push(text);
        dg.partial = "";
      } else {
        dg.partial = text;
      }
      if (turn === this.turnId) {            // drop partials from a cancelled turn
        const live = [...dg.finals, dg.partial].filter(Boolean).join(" ");
        if (live) this.opts.events.onPartial?.(live);
      }
    };

    await this.attachPcm((buf) => {
      if (dg.failed || dg.closed) return;
      if (dg.opened && dg.ws && dg.ws.readyState === WebSocket.OPEN) { try { dg.ws.send(buf); } catch {} }
      else if (dg.queue.length < 64) dg.queue.push(buf);   // ~2.7 s of audio; enough to cover the open
    });
  }

  private async finishDeepgram(dg: DgTurn): Promise<string> {
    this.detachPcm();
    if (dg.failed || !dg.ws) { dg.failed = true; return ""; }
    const ws = dg.ws;
    const closeP = new Promise<void>((res) => { dg.resolveClose = res; });
    if (dg.opened && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: "CloseStream" })); } catch {}
    } else if (!dg.opened) {
      // Still connecting at release — give it the remaining window, then use whisper.
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    await Promise.race([closeP, new Promise<void>((res) => { timer = setTimeout(res, DG_CLOSE_TIMEOUT_MS); })]);
    if (timer) clearTimeout(timer);
    dg.resolveClose = null;
    try { if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(); } catch {}
    if (!dg.opened) { dg.failed = true; return ""; }
    // Nothing final but a partial is better than nothing on a timeout.
    return [...dg.finals, dg.finals.length ? "" : dg.partial].filter(Boolean).join(" ").trim();
  }

  private teardownDeepgram(dg: DgTurn): void {
    this.detachPcm();
    dg.closed = true;
    dg.resolveClose?.();
    dg.resolveClose = null;
    if (dg.ws) { try { dg.ws.close(); } catch {} dg.ws = null; }
  }

  private async attachPcm(onChunk: (buf: ArrayBuffer) => void): Promise<void> {
    if (!this.ctx || !this.source) return;
    this.detachPcm();
    const ctx = this.ctx;
    if (!this.sink) {
      // Silent sink: worklet/script nodes only run when they reach the destination.
      this.sink = ctx.createGain();
      this.sink.gain.value = 0;
      this.sink.connect(ctx.destination);
    }
    if (ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      if (!this.workletReady) {
        const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
        this.workletReady = ctx.audioWorklet.addModule(url).then(() => true, () => false)
          .finally(() => URL.revokeObjectURL(url));
      }
      if (await this.workletReady) {
        const node = new AudioWorkletNode(ctx, "chef-pcm", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
        node.port.onmessage = (e: MessageEvent) => { if (e.data instanceof ArrayBuffer) onChunk(e.data); };
        this.source.connect(node);
        node.connect(this.sink);
        this.pcmNode = node;
        return;
      }
    }
    // Deprecated but still the only option on older Safari.
    const sp = ctx.createScriptProcessor(4096, 1, 1);
    sp.onaudioprocess = (e: AudioProcessingEvent) => { onChunk(floatToInt16(e.inputBuffer.getChannelData(0))); };
    this.source.connect(sp);
    sp.connect(this.sink);
    this.pcmNode = sp;
  }

  private detachPcm(): void {
    const n = this.pcmNode;
    if (!n) return;
    this.pcmNode = null;
    try { this.source?.disconnect(n); } catch {}
    try { n.disconnect(); } catch {}
    if ("port" in n) { try { (n as AudioWorkletNode).port.onmessage = null; } catch {} }
    else { try { (n as ScriptProcessorNode).onaudioprocess = null; } catch {} }
  }

  // --- finish --------------------------------------------------------------

  private emitFinal(text: string, backend: VoiceBackend, slow: boolean): void {
    const ms = Math.round(performance.now() - this.stoppedAt);
    this.opts.events.onFinal((text || "").trim(), { backend, ms, slow });
  }
}
