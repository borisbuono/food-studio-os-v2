import Link from "next/link";
import { supabaseServer } from "@/lib/supabaseServer";
import PAScheduleForm from "@/components/PAScheduleForm";

export const dynamic = "force-dynamic";

// /administrate/settings/pa — Boris's PA scheduled-task settings.
// WhatsApp triage hourly, morning brief time, evening debrief, daily academy.
export default async function PASettingsPage() {
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  const uid = u.user?.id || null;

  const state = uid
    ? (await sb.from("pa_schedule_state").select("*").eq("user_id", uid).maybeSingle()).data
    : null;

  if (!uid) {
    return (
      <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-12">
        <Link href="/administrate/settings" className="font-mono text-[10px] uppercase tracking-wide text-clay">← settings</Link>
        <h1 className="mt-6 font-serif text-3xl text-ink">PA scheduled tasks</h1>
        <p className="mt-3 font-serif italic text-[15px] text-ink-soft">Sign in to configure your PA schedule.</p>
      </main>
    );
  }

  // Default state matches the hard-coded values the Cowork scheduled tasks
  // currently use — so the surface is truthful even before the user saves.
  const initial = state || {
    user_id: uid,
    timezone: "Europe/Madrid",
    whatsapp_triage_hourly: true,
    whatsapp_triage_window_start: "08:00",
    whatsapp_triage_window_end: "22:00",
    morning_brief_time: "09:00",
    evening_debrief_time: "21:00",
    daily_academy_time: "08:30",
  };

  return (
    <main className="mx-auto max-w-xl lg:max-w-4xl px-6 py-10">
      <Link href="/administrate/settings" className="font-mono text-[10px] uppercase tracking-wide text-clay">← settings</Link>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--accent)" }}>Settings · PA scheduled tasks</p>
      <h1 className="mt-2 font-serif text-4xl leading-tight text-ink">When the PA moves.</h1>
      <p className="mt-2 font-serif italic text-[15px] text-ink-soft">
        The rhythm of the day — WhatsApp triage, morning brief, evening debrief, the Academy drop.
      </p>

      <PAScheduleForm initial={initial} />
    </main>
  );
}
