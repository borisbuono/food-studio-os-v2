"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabaseBrowser";

// The Capture Station.
//
// One screen, two panes:
//   top ~55%  = live camera (or type picker if type=auto)
//   bottom    = queue of captures, most recent right
//
// Each snap:
//   1. Grabs the current video frame → JPEG blob
//   2. Adds a card to the queue with a thumbnail + "processing…" state
//   3. Fires /api/capture/rich in the background — camera stays live
//   4. When the response lands, the card fills with extracted fields
//   5. Boris can tap a card to edit before "filing"
//
// Nothing here blocks. If a POST errors the card turns red with a retry.

type CaptureType = "invoice" | "albaran" | "auto";

type CardState = "processing" | "done" | "error";

type ExtractedLine = {
  line_number?: number;
  product_code?: string | null;
  product_name?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unit_price_eur?: number | null;
  discount_pct?: number | null;
  line_subtotal_eur?: number | null;
  vat_rate?: number | null;
  vat_amount_eur?: number | null;
  line_total_eur?: number | null;
  confidence?: number | null;
};

type CaptureCard = {
  id: string;
  thumbUrl: string;
  state: CardState;
  blob?: Blob;
  type?: string;
  captureId?: string;
  supplier_name?: string | null;
  supplier_vat_id?: string | null;
  invoice_number?: string | null;
  document_date?: string | null;
  due_date?: string | null;
  payment_method?: string | null;
  payment_card_last4?: string | null;
  subtotal_eur?: number | null;
  vat_eur?: number | null;
  grand_total_eur?: number | null;
  lines?: ExtractedLine[];
  extraction_confidence?: Record<string, number> | null;
  error?: string | null;
};

function eur(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return "€" + v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function confColor(c: number | null | undefined): string {
  if (c === null || c === undefined) return "text-clay";
  if (c >= 0.85) return "text-ink";
  if (c >= 0.7) return "text-ink-soft";
  return "text-[#B8552E]"; // orange = check
}

function confPill(cards: CaptureCard): { color: string; label: string } {
  const conf = cards.extraction_confidence || {};
  const key = ["supplier_name", "grand_total_eur", "invoice_number"].filter((k) => conf[k] !== undefined);
  if (!key.length) return { color: "bg-black/10 text-clay", label: "?" };
  const avg = key.reduce((a, k) => a + (conf[k] || 0), 0) / key.length;
  if (avg >= 0.85) return { color: "bg-emerald-100 text-emerald-800", label: Math.round(avg * 100) + "%" };
  if (avg >= 0.7) return { color: "bg-amber-100 text-amber-900", label: Math.round(avg * 100) + "%" };
  return { color: "bg-rose-100 text-rose-800", label: Math.round(avg * 100) + "%" };
}

export default function CaptureStation({
  initialType,
  entityLabel,
  entityCode,
}: {
  initialType: string;
  entityLabel: string;
  entityCode: string;
}) {
  const router = useRouter();
  const [type, setType] = useState<CaptureType>(
    ["invoice", "albaran", "auto"].includes(initialType) ? (initialType as CaptureType) : "auto"
  );
  const [cards, setCards] = useState<CaptureCard[]>([]);
  const [cameraOk, setCameraOk] = useState<null | boolean>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [snapLock, setSnapLock] = useState(false);
  // Auth guard — the /capture page has a server-side gate, but sessions
  // can expire while Boris is holding the phone. If the JWT dies mid-shoot
  // we freeze the camera and show a banner (see Boris 2026-08-30: 6 shots
  // landed in storage but 0 in invoice_inbox because he wasn't signed in).
  const [sessionExpired, setSessionExpired] = useState(false);
  const returnHref = "/capture?type=" + (type || "auto");

  // Start camera
  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraOk(true);
      } catch (e: any) {
        setCameraOk(false);
        setCameraError(e?.message || "camera unavailable");
      }
    }
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // Watch the auth session. Supabase fires TOKEN_REFRESHED on rotation and
  // SIGNED_OUT on expiry / manual sign-out. If we lose the session we stop
  // the camera and prompt for re-auth. The queue (in-memory + already-
  // uploaded blobs) is untouched so nothing is lost.
  useEffect(() => {
    let cancelled = false;
    supabaseBrowser.auth.getSession().then(({ data }) => {
      if (!cancelled && !data.session) setSessionExpired(true);
    });
    const { data: sub } = supabaseBrowser.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        setSessionExpired(true);
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    });
    return () => { cancelled = true; sub.subscription.unsubscribe(); };
  }, []);

  const captured = cards.length;
  const processing = cards.filter((c) => c.state === "processing").length;
  const filed = cards.filter((c) => c.state === "done").length;

  const snap = useCallback(async () => {
    if (snapLock) return;
    // Verify JWT is still live before we take a shot. If it's gone the
    // rich endpoint will 401-under-RLS and the storage bucket (anon-ok)
    // will silently accept the blob without a matching DB row.
    const { data } = await supabaseBrowser.auth.getSession();
    if (!data.session) {
      setSessionExpired(true);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      return;
    }
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    setSnapLock(true);
    try {
      // Draw frame → JPEG blob
      const canvas = canvasRef.current || document.createElement("canvas");
      canvasRef.current = canvas;
      const w = video.videoWidth || 1920;
      const h = video.videoHeight || 1080;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, w, h);
      const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.85));
      if (!blob) return;

      const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      const thumbUrl = URL.createObjectURL(blob);
      const card: CaptureCard = { id, thumbUrl, state: "processing", blob };
      setCards((prev) => [...prev, card]);

      // Fire the upload in background — do NOT await here so the camera stays hot
      void uploadCard(id, blob, type);
    } finally {
      // Small debounce so a rapid double-tap doesn't create two frames of the same shot
      setTimeout(() => setSnapLock(false), 250);
    }
  }, [snapLock, type]);

  async function uploadCard(id: string, blob: Blob, t: CaptureType) {
    try {
      const fd = new FormData();
      fd.append("file", blob, `${Date.now()}.jpg`);
      fd.append("type", t);
      const r = await fetch("/api/capture/rich", { method: "POST", body: fd });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "upload failed");
      setCards((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                state: "done",
                captureId: j.capture_id,
                type: j.type,
                supplier_name: j.supplier_name,
                supplier_vat_id: j.supplier_vat_id,
                invoice_number: j.invoice_number,
                document_date: j.document_date,
                due_date: j.due_date,
                payment_method: j.payment_method,
                payment_card_last4: j.payment_card_last4,
                subtotal_eur: j.subtotal_eur,
                vat_eur: j.vat_eur,
                grand_total_eur: j.grand_total_eur,
                lines: j.lines || [],
                extraction_confidence: j.extraction_confidence,
                error: j.extraction_error || null,
              }
            : c
        )
      );
    } catch (e: any) {
      setCards((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, state: "error", error: e?.message || "failed" } : c
        )
      );
    }
  }

  const retry = useCallback(
    (id: string) => {
      setCards((prev) => prev.map((c) => (c.id === id ? { ...c, state: "processing", error: null } : c)));
      const c = cards.find((x) => x.id === id);
      if (c?.blob) void uploadCard(id, c.blob, type);
    },
    [cards, type]
  );

  const discard = useCallback((id: string) => {
    setCards((prev) => prev.filter((c) => c.id !== id));
    setOpenCardId((cur) => (cur === id ? null : cur));
  }, []);

  const openCard = useMemo(() => cards.find((c) => c.id === openCardId) || null, [cards, openCardId]);

  // Done — everything is already written to the DB per-card. This just clears
  // the queue and pushes Boris to the inbox where he'll approve.
  const doneAll = useCallback(() => {
    router.push("/administrate/finance/scans");
  }, [router]);

  return (
    <main className="min-h-screen bg-black text-white flex flex-col">
      {sessionExpired ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur">
          <div className="max-w-sm rounded-2xl border border-white/15 bg-neutral-900 p-6 text-center">
            <p className="font-mono text-[10px] uppercase tracking-wide text-white/60">Session expired</p>
            <p className="mt-3 font-serif text-xl text-white">Sign back in to keep filing</p>
            <p className="mt-2 font-sans text-sm text-white/70">
              Your queue is preserved. New shots need a live session — RLS blocks anonymous writes.
            </p>
            <a
              href={"/login?next=" + encodeURIComponent(returnHref)}
              className="mt-5 inline-block rounded-full bg-white px-5 py-2 font-sans text-sm font-medium text-black"
            >
              Sign in
            </a>
          </div>
        </div>
      ) : null}
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-white/60">
            Capture · {entityLabel} · {entityCode}
          </p>
          <p className="font-serif text-lg text-white">
            {type === "invoice" ? "Invoice" : type === "albaran" ? "Delivery note" : "Auto-detect"}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[11px] text-white/80">
            {captured} captured · {processing} processing · {filed} filed
          </p>
          <Link href="/office" className="mt-1 inline-block font-mono text-[10px] uppercase tracking-wide text-white/60 underline">
            Close
          </Link>
        </div>
      </header>

      {/* Type picker — visible when auto, so Boris can pin the type first */}
      <div className="flex gap-2 px-4 py-2 border-b border-white/10 bg-black/40">
        {(["invoice", "albaran", "auto"] as CaptureType[]).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={
              "rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-wide " +
              (type === t ? "bg-white text-black" : "bg-white/10 text-white/80")
            }
          >
            {t === "invoice" ? "Invoice" : t === "albaran" ? "Delivery note" : "Auto"}
          </button>
        ))}
      </div>

      {/* Camera pane */}
      <section className="relative flex-1 min-h-[45vh] bg-black flex items-center justify-center overflow-hidden">
        {cameraOk === false ? (
          <div className="text-center px-6">
            <p className="font-serif text-2xl">Camera unavailable</p>
            <p className="mt-2 font-sans text-sm text-white/60">{cameraError}</p>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-wide text-white/40">
              On iOS Safari — check Settings → Safari → Camera → Allow
            </p>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="max-w-full max-h-full object-contain"
            />
            {cameraOk === null && (
              <p className="absolute font-mono text-[11px] uppercase text-white/60">starting camera…</p>
            )}
            {/* Big shutter */}
            <button
              onClick={snap}
              disabled={!cameraOk || snapLock}
              aria-label="Snap"
              className="absolute bottom-4 left-1/2 -translate-x-1/2 w-20 h-20 rounded-full border-4 border-white bg-white/10 backdrop-blur transition active:scale-95 disabled:opacity-40"
            >
              <span className="block w-14 h-14 mx-auto rounded-full bg-white" />
            </button>
          </>
        )}
      </section>

      {/* Queue */}
      <section className="border-t border-white/10 bg-neutral-950">
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
          <p className="font-mono text-[10px] uppercase tracking-wide text-white/60">
            Queue ({captured})
          </p>
          {captured > 0 && processing === 0 && (
            <button
              onClick={doneAll}
              className="rounded-full bg-emerald-500 px-4 py-1.5 font-mono text-[11px] uppercase tracking-wide text-black"
            >
              Done — file all
            </button>
          )}
        </div>
        <div className="flex gap-3 overflow-x-auto px-4 py-3 min-h-[8.5rem]">
          {cards.length === 0 && (
            <p className="font-serif italic text-white/40 self-center">
              Nothing captured yet. Point the camera and tap the shutter.
            </p>
          )}
          {cards.map((c) => {
            const pill = confPill(c);
            return (
              <button
                key={c.id}
                onClick={() => setOpenCardId(c.id)}
                className="shrink-0 w-56 rounded-lg border border-white/10 bg-neutral-900 p-2 text-left hover:border-white/40 transition"
              >
                <div className="flex gap-2">
                  <img
                    src={c.thumbUrl}
                    alt=""
                    className="w-16 h-20 object-cover rounded"
                  />
                  <div className="flex-1 min-w-0">
                    {c.state === "processing" && (
                      <p className="font-mono text-[10px] uppercase text-white/60">processing…</p>
                    )}
                    {c.state === "error" && (
                      <>
                        <p className="font-mono text-[10px] uppercase text-rose-400">error</p>
                        <p className="mt-1 text-[11px] text-white/70 truncate">{c.error}</p>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            retry(c.id);
                          }}
                          className="mt-1 rounded bg-white/10 px-2 py-0.5 font-mono text-[10px] uppercase"
                        >
                          retry
                        </button>
                      </>
                    )}
                    {c.state === "done" && (
                      <>
                        <p className="font-serif text-[14px] text-white truncate">
                          {c.supplier_name || "unknown supplier"}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-white/80">{eur(c.grand_total_eur)}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-white/50">
                          {(c.lines?.length || 0)} lines · {c.type || "?"}
                        </p>
                        <span className={"mt-1 inline-block rounded-full px-2 py-0.5 font-mono text-[10px] " + pill.color}>
                          {pill.label}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Drawer for detail edit */}
      {openCard && (
        <CardDrawer card={openCard} onClose={() => setOpenCardId(null)} onDiscard={() => discard(openCard.id)} />
      )}
    </main>
  );
}

function CardDrawer({ card, onClose, onDiscard }: { card: CaptureCard; onClose: () => void; onDiscard: () => void }) {
  const conf = card.extraction_confidence || {};
  const F = (k: string) => confColor(conf[k]);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white text-ink"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-black/10 px-4 py-3 flex items-center justify-between">
          <p className="font-serif text-lg">Capture · {card.type || "unknown"}</p>
          <button onClick={onClose} className="font-mono text-[11px] uppercase text-clay">close</button>
        </div>

        <div className="px-4 py-3">
          <img src={card.thumbUrl} alt="" className="w-full max-h-56 object-contain rounded border border-black/10 bg-neutral-100" />
        </div>

        {card.state === "processing" && (
          <p className="px-4 pb-4 font-serif italic text-ink-soft">Extracting fields…</p>
        )}

        {card.state === "done" && (
          <div className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Supplier" cls={F("supplier_name")} value={card.supplier_name} />
              <Field label="VAT ID" value={card.supplier_vat_id} />
              <Field label="Invoice #" cls={F("invoice_number")} value={card.invoice_number} />
              <Field label="Date" cls={F("document_date")} value={card.document_date} />
              <Field label="Due" value={card.due_date} />
              <Field label="Payment" value={card.payment_method + (card.payment_card_last4 ? " …" + card.payment_card_last4 : "")} />
              <Field label="Subtotal" cls={F("subtotal_eur")} value={eur(card.subtotal_eur)} />
              <Field label="VAT" cls={F("vat_eur")} value={eur(card.vat_eur)} />
              <Field label="Grand total" cls={F("grand_total_eur")} value={eur(card.grand_total_eur)} big />
            </div>

            {card.lines && card.lines.length > 0 && (
              <div>
                <p className="mt-4 font-mono text-[10px] uppercase tracking-wide text-clay">Lines ({card.lines.length})</p>
                <div className="mt-1 max-h-64 overflow-y-auto rounded border border-black/10">
                  <table className="w-full text-[12px]">
                    <thead className="bg-neutral-100 text-clay font-mono uppercase text-[10px]">
                      <tr>
                        <th className="text-left px-2 py-1">Product</th>
                        <th className="text-right px-2 py-1">Qty</th>
                        <th className="text-right px-2 py-1">Unit</th>
                        <th className="text-right px-2 py-1">€ ea</th>
                        <th className="text-right px-2 py-1">Total</th>
                        <th className="text-right px-2 py-1">VAT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {card.lines.map((ln, i) => (
                        <tr key={i} className={"border-t border-black/5 " + confColor(ln.confidence)}>
                          <td className="px-2 py-1">{ln.product_name || "?"}</td>
                          <td className="px-2 py-1 text-right">{ln.quantity ?? "—"}</td>
                          <td className="px-2 py-1 text-right">{ln.unit || "—"}</td>
                          <td className="px-2 py-1 text-right">{ln.unit_price_eur != null ? ln.unit_price_eur.toFixed(2) : "—"}</td>
                          <td className="px-2 py-1 text-right">{ln.line_total_eur != null ? ln.line_total_eur.toFixed(2) : "—"}</td>
                          <td className="px-2 py-1 text-right">{ln.vat_rate != null ? ln.vat_rate + "%" : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {card.error && (
              <p className="mt-3 rounded bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-900">
                Extraction warning: {card.error}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={onDiscard}
                className="rounded border border-rose-300 px-3 py-1.5 font-mono text-[11px] uppercase text-rose-700"
              >
                Discard from queue
              </button>
              <Link
                href={`/administrate/finance/scans`}
                className="ml-auto rounded bg-ink px-3 py-1.5 font-mono text-[11px] uppercase text-white"
              >
                Open in inbox
              </Link>
            </div>
          </div>
        )}

        {card.state === "error" && (
          <div className="px-4 pb-4">
            <p className="rounded bg-rose-50 border border-rose-200 px-3 py-2 text-[12px] text-rose-800">
              {card.error || "Upload failed."}
            </p>
            <button onClick={onDiscard} className="mt-3 rounded border border-black/20 px-3 py-1.5 font-mono text-[11px] uppercase">
              Discard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, cls, big }: { label: string; value: any; cls?: string; big?: boolean }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wide text-clay">{label}</p>
      <p className={"mt-0.5 " + (big ? "font-serif text-xl " : "text-[13px] ") + (cls || "text-ink")}>
        {value === null || value === undefined || value === "" ? "—" : value}
      </p>
    </div>
  );
}
