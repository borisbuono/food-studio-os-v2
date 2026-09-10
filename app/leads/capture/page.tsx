import CaptureForm from "./CaptureForm";

export const dynamic = "force-dynamic";

// /leads/capture — public placeholder form.
//
// Overnight 2026-09-11 scaffolding. This route is deliberately plain so
// Boris can smoke-test /api/leads/capture end-to-end with a real submit
// tomorrow morning. The comm/design agent will swap the CaptureForm
// component for the branded version; the route path, endpoint contract
// and query-string mapping (entity, source, utm_*) stay.

type Props = { searchParams: { entity?: string; source?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string } };

export default function LeadsCapturePage({ searchParams }: Props) {
  const entity = searchParams?.entity || "studio";
  const source = searchParams?.source || "website";
  return (
    <main className="min-h-screen bg-white text-slate-900 flex items-start justify-center px-6 py-16">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-xs uppercase tracking-[0.18em] text-slate-500">
          Get in touch
        </div>
        <h1 className="text-3xl font-serif mb-2">Tell us what you have in mind.</h1>
        <p className="text-slate-600 mb-8">
          A short note is enough. We usually reply within a day.
        </p>
        <CaptureForm
          entitySlug={entity}
          source={source}
          utmSource={searchParams?.utm_source || null}
          utmMedium={searchParams?.utm_medium || null}
          utmCampaign={searchParams?.utm_campaign || null}
        />
        <p className="text-[11px] text-slate-400 mt-8">
          Placeholder form — brand copy landing next.
        </p>
      </div>
    </main>
  );
}
