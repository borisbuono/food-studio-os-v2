import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import { entityForHouseSlug, houseNameForSlug } from "@/lib/houses";
import { ENTITY_TO_RESTAURANT, ENTITY_LABEL, E_HOLDINGS, EntityKey } from "@/lib/entities";
import ManualEodClient from "./ManualEodClient";

// /h/[house]/office/eod — manual EOD entry surface.
//
// Runway d2 (2026-09-20): a POS-agnostic surface where the operator keys
// yesterday's numbers by hand. Written primarily for the Amsterdam venue
// (POS not chosen yet) but usable on any house whose pos_credentials row
// is vendor='manual'. On Fresto houses (BM, Taller) the page still opens
// — but a banner reminds the operator that the auto-pull is authoritative
// and manual keys will create a competing snapshot.

export const dynamic = "force-dynamic";

export default async function ManualEodPage({ params }: { params: { house: string } }) {
  const slug = params.house;
  const entity = entityForHouseSlug(slug);
  if (!entity) redirect("/studio");
  try {
    cookies().set("fs_entity", entity, {
      path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 30,
    });
  } catch { /* read-only in some render paths — non-fatal */ }

  const sb = supabaseServer();

  // Resolve pos_credentials.vendor for this entity. Present the correct
  // banner (auto-pull vs manual native).
  let vendor: string | null = null;
  try {
    const { data } = await sb.from("pos_credentials")
      .select("vendor").eq("entity_id", entity).maybeSingle();
    vendor = (data?.vendor as string | null) ?? null;
  } catch { vendor = null; }

  // Timezone for the "today" default — Madrid for BM/Taller/Holdings, but
  // any future entity should carry its own tz. For d2 we hardcode Madrid;
  // when the Amsterdam entity lands we swap in entities.timezone.
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">
            <Link href={`/h/${slug}`} className="hover:text-ink">← {houseNameForSlug(slug)}</Link>
            <span className="mx-2 text-clay">/</span>
            <Link href={`/h/${slug}/office`} className="hover:text-ink">Office</Link>
          </p>
          <h1 className="mt-2 font-serif text-3xl text-ink leading-tight">Enter yesterday's close</h1>
          <p className="mt-2 font-serif italic text-[14px] text-ink-soft">
            Manual entry — the numbers land in <span className="font-mono not-italic text-[12px]">eod_pos</span> tagged <span className="font-mono not-italic text-[12px]">source=manual</span> just like a Fresto pull.
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[10px] uppercase tracking-wide text-clay">Entity</p>
          <p className="mt-1 font-serif text-[15px] text-ink">{ENTITY_LABEL[entity as EntityKey] || entity}</p>
        </div>
      </div>

      {vendor && vendor !== "manual" ? (
        <p className="mt-4 border border-line px-3 py-2 font-serif italic text-[13px] text-clay">
          Heads-up — this venue's POS vendor is <span className="font-mono not-italic">{vendor}</span>.
          Manual entries here will sit alongside the automatic pull under the same date. Duality
          rule: manual means manual — nothing here auto-populates from other sources.
        </p>
      ) : null}

      <ManualEodClient
        entityId={entity}
        houseSlug={slug}
        today={today}
      />
    </main>
  );
}

export function generateMetadata({ params }: { params: { house: string } }) {
  return { title: `${houseNameForSlug(params.house)} · Enter close · Food Studios` };
}

// Suppress unused-import warnings for constants that document intent.
export const _e = { ENTITY_TO_RESTAURANT, E_HOLDINGS };
