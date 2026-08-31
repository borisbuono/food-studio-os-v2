"use client";
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { listHouses } from "@/lib/houses";

// StudioCaptureButtons — the +Capture buttons that live on the Studio
// (portfolio) landing.
//
// Boris (2026-08-31 walk): the studio doesn't receive invoices. Capture is a
// house-level action. But keeping a visible +Capture on the top-level page
// matters — paper docs must never wait for someone to drill three levels
// down. Solution: keep the button, but tapping opens a small house picker
// modal ("Capture for which house?"). Once the user picks, we jump to
// /capture?type=<type>&entity=<houseId>. The capture page honours the entity
// param, overriding the fs_entity cookie for THIS capture only, so a photo
// snapped from the Studio always lands in the right entity's inbox.

type CaptureType = "invoice" | "albaran";

export default function StudioCaptureButtons() {
  const [open, setOpen] = useState<null | CaptureType>(null);
  const router = useRouter();
  const houses = listHouses(); // BM + Taller

  const start = useCallback((type: CaptureType) => {
    // Fast-path: only one house → skip the picker entirely.
    if (houses.length === 1) {
      router.push(`/capture?type=${type}&entity=${houses[0].entity}`);
      return;
    }
    setOpen(type);
  }, [houses, router]);

  const pick = useCallback((entity: string) => {
    if (!open) return;
    router.push(`/capture?type=${open}&entity=${entity}`);
    setOpen(null);
  }, [open, router]);

  return (
    <>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          onClick={() => start("invoice")}
          className="rounded-full border border-black/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-ink transition hover:border-ink/40"
        >
          + Capture invoice
        </button>
        <button
          onClick={() => start("albaran")}
          className="rounded-full border border-black/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-ink transition hover:border-ink/40"
        >
          + Capture delivery note
        </button>
      </div>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Capture for which house"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
          onClick={() => setOpen(null)}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-black/10 bg-paper shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-black/10 px-5 py-3">
              <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Capture · {open === "invoice" ? "invoice" : "delivery note"}</p>
              <h2 className="mt-1 font-serif text-[20px] text-ink">Capture for which house?</h2>
            </div>
            <ul className="p-2">
              {houses.map((h) => (
                <li key={h.slug}>
                  <button
                    onClick={() => pick(h.entity)}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left font-sans text-[14px] text-ink hover:bg-paper-deep"
                  >
                    <span>{h.name}</span>
                    <span className="font-mono text-[10px] uppercase text-clay">/{h.slug}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex justify-end border-t border-black/10 px-3 py-2">
              <button
                onClick={() => setOpen(null)}
                className="font-mono text-[10px] uppercase tracking-wide text-clay hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
