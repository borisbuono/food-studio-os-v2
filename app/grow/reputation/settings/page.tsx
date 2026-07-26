import Link from "next/link";
import { serverEntity } from "@/lib/serverVenue";
import type { EntityKey } from "@/lib/entities";
import ConnectIntegration from "@/app/administrate/finance/setup/[entity]/ConnectIntegration";

export const dynamic = "force-dynamic";

// Reputation #3 gap fix — the Connect UI for Google Business / TripAdvisor /
// TheFork. Uses the same ConnectIntegration component the Finance setup pages
// use (test + save + rotate + revoke via the /api/integrations/* endpoints).
// Reviews adapters read from lib/integrations/reviews/*.ts and get routed by
// entity via lib/integrations/registry.ts.

const ENTITY_CODE: Record<EntityKey, "IFL" | "BM" | "BBH"> = {
  holdings: "BBH", bistro_mondo: "BM", taller: "IFL", utopia: "IFL",
};

export default async function ReputationSettings() {
  const entity = serverEntity();
  const ec = ENTITY_CODE[entity] || "IFL";

  return (
    <main className="mx-auto max-w-2xl lg:max-w-5xl px-6 py-10">
      <Link href="/grow/reputation" className="font-mono text-[10px] uppercase tracking-wide text-clay">← reputation</Link>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-wide text-tomato">Grow · Reputation · settings</p>
      <h1 className="mt-1 font-serif text-[34px] leading-[1.05] text-ink">Connect review platforms</h1>
      <p className="mt-2 font-serif italic text-[15px] text-ink-soft">Paste an API key for each platform you want to pull reviews from. Once connected, the unified inbox lights up and the sync runs on the <code>/api/grow/reputation/sync</code> endpoint.</p>

      <div className="mt-8 grid grid-cols-1 gap-3">
        <ConnectIntegration
          entity={ec}
          vendor="google-business"
          kind="reviews"
          label="Google Business Profile"
          howto="Google Cloud Console → enable Business Profile Performance API → OAuth or a service-account key. Paste the token below. Full walkthrough: developers.google.com/my-business."
        />
        <ConnectIntegration
          entity={ec}
          vendor="tripadvisor"
          kind="reviews"
          label="TripAdvisor"
          howto="TripAdvisor Content API access is granted per property — request via tripadvisor.com/content-api. Paste the property-scoped API key below."
        />
        <ConnectIntegration
          entity={ec}
          vendor="thefork"
          kind="reviews"
          label="TheFork"
          howto="TheFork Manager → Settings → API → generate a REST key with reviews.read scope. Paste it below."
        />
      </div>

      <p className="mt-8 font-mono text-[10px] text-clay">Reviews sync via <code>POST /api/grow/reputation/sync</code>. Replies (per platform, where supported) fire from the inbox drawer via <code>/api/grow/reputation/reply</code>.</p>
    </main>
  );
}
