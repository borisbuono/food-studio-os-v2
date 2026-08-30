import { redirect } from "next/navigation";
import CaptureStation from "./CaptureStation";
import FabHidden from "@/components/FabHidden";
import { serverEntity } from "@/lib/serverVenue";
import { ENTITY_LABEL } from "@/lib/entities";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

// /capture — full-screen mobile-first capture station. Boris's ask 2026-08-24:
//   1. Camera stays live between snaps (no modal close).
//   2. Uploads process in background per-card. UI never freezes.
//   3. Every field visible immediately, low-confidence in orange.
//   4. "+ Capture invoice / delivery note" is discoverable from the top-level
//      pages — not buried behind a long-press.
//
// Auth guard added 2026-08-30 after Boris hit a silent-fail at 16:06-16:09
// CET: he was signed out, storage bucket accepted anon so photos landed,
// but invoice_inbox RLS demands `authenticated` so DB writes were rejected
// and the UI cards stayed blank. Never render the camera for anonymous
// visitors — bounce to /login first.
//
// Route params:
//   /capture              — type picker
//   /capture?type=invoice — camera live, invoice mode
//   /capture?type=albaran — camera live, delivery-note mode
//
// The heavy lifting lives in CaptureStation.tsx (client component).
export default async function CapturePage({
  searchParams,
}: {
  searchParams?: { type?: string };
}) {
  const type = (searchParams?.type || "auto") as string;

  // Auth guard — RLS on invoice_inbox / purchase_lines requires an
  // authenticated JWT, so an anonymous camera surface just produces
  // orphan storage objects. Verify a session BEFORE rendering.
  const sb = supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) {
    const dest = "/capture" + (type && type !== "auto" ? `?type=${encodeURIComponent(type)}` : "");
    redirect("/login?next=" + encodeURIComponent(dest));
  }

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
