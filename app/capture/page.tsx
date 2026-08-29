import CaptureStation from "./CaptureStation";
import FabHidden from "@/components/FabHidden";
import { serverEntity } from "@/lib/serverVenue";
import { ENTITY_LABEL } from "@/lib/entities";

export const dynamic = "force-dynamic";

// /capture — full-screen mobile-first capture station. Boris's ask 2026-08-24:
//   1. Camera stays live between snaps (no modal close).
//   2. Uploads process in background per-card. UI never freezes.
//   3. Every field visible immediately, low-confidence in orange.
//   4. "+ Capture invoice / delivery note" is discoverable from the top-level
//      pages — not buried behind a long-press.
//
// Route params:
//   /capture              — type picker
//   /capture?type=invoice — camera live, invoice mode
//   /capture?type=albaran — camera live, delivery-note mode
//
// The heavy lifting lives in CaptureStation.tsx (client component).
export default function CapturePage({
  searchParams,
}: {
  searchParams?: { type?: string };
}) {
  const type = (searchParams?.type || "auto") as string;
  const entity = serverEntity();
  return (
    <>
      <FabHidden />
      <CaptureStation
      initialType={type}
      entityLabel={ENTITY_LABEL[entity]}
      entityCode={entity === "taller" ? "IFL" : entity === "bistro_mondo" ? "BM" : "BBH"}
      />
    </>
  );
}
