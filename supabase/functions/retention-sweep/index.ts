/* =============================================================================
 * retention-sweep — the retention promises, kept daily (security S6, 2026-10-02).
 *
 *   POST {}        run fn_retention_sweep() and delete the CV files it released
 *
 * pg_cron calls this at 04:20 UTC (job retention-sweep-daily). verify_jwt is
 * false; auth is the Vault secret rgpd_secret checked back with rgpd_secret_ok().
 *
 * The rules live in SQL (fn_retention_candidates / _guests / _chef_turns):
 *   · candidates not hired → anonymised when retain_until passes;
 *   · guests → anonymised 3 years after the last visit or booking;
 *   · chef_turns → transcript + result scrubbed after 90 days.
 * SQL cannot delete Storage objects properly, so the candidate job returns the
 * `hiring-cvs` paths it detached and this function removes the files.
 * ========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const secret = req.headers.get('x-scheduler-secret') ?? '';
  if (!secret) return json({ error: 'unauthorized' }, 401);
  const { data: ok, error: okErr } = await db.rpc('rgpd_secret_ok', { p_secret: secret });
  if (okErr || !ok) return json({ error: 'unauthorized' }, 401);

  const { data, error } = await db.rpc('fn_retention_sweep');
  if (error) return json({ ok: false, error: error.message }, 500);

  const paths: string[] = Array.isArray(data?.candidates?.cv_paths) ? data.candidates.cv_paths : [];
  let cvs_removed = 0;
  let cv_error: string | null = null;
  if (paths.length) {
    const { data: removed, error: rmErr } = await db.storage.from('hiring-cvs').remove(paths);
    if (rmErr) cv_error = rmErr.message; else cvs_removed = removed?.length ?? paths.length;
  }
  return json({ ok: !cv_error, ...data, cvs_removed, cv_error });
});
