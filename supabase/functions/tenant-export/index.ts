/* =============================================================================
 * tenant-export — the clean exit (security S6, 2026-10-02).
 *
 *   POST { "entity_id": "<uuid>" }  or  { "slug": "utopia" }
 *     → export_tenant_rows(entity) → one zip in the private bucket
 *       exports/<slug>/<stamp>.zip: README.txt, manifest.json, one
 *       <table>.json per table; a tenant_exports row; a 24-hour signed URL.
 *
 * verify_jwt is false; auth is the Vault secret rgpd_secret (rgpd_secret_ok()).
 * Boris runs it from the SQL editor (docs/legal/README.md); a button for
 * owners comes later. What leaves: every table keyed to the entity directly
 * (entity_id / operator_entity_id / restaurant_id / entity_code) or one FK
 * hop away (recipe_ingredients → recipes …); never credentials or platform
 * plumbing (_export_denylist). The manifest lists what was skipped.
 * ========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { BlobWriter, TextReader, ZipWriter } from 'https://deno.land/x/zipjs@v2.7.52/index.js';

const BUCKET = 'exports';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const stamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const secret = req.headers.get('x-scheduler-secret') ?? '';
  if (!secret) return json({ error: 'unauthorized' }, 401);
  const { data: ok, error: okErr } = await db.rpc('rgpd_secret_ok', { p_secret: secret });
  if (okErr || !ok) return json({ error: 'unauthorized' }, 401);

  let p: any = {};
  try { p = await req.json(); } catch { /* empty */ }
  let entityId = String(p.entity_id ?? '').trim();
  if (!entityId && p.slug) {
    const { data: e } = await db.from('entities').select('id').eq('slug', String(p.slug)).maybeSingle();
    entityId = e?.id ?? '';
  }
  if (!entityId) return json({ ok: false, error: 'entity_id or slug required' }, 400);

  const { data: run } = await db.from('tenant_exports').insert({ entity_id: entityId, requested_by: p.requested_by ?? null }).select('id').single();
  const runId = run?.id as string | undefined;
  try {
    const { data, error } = await db.rpc('export_tenant_rows', { p_entity: entityId });
    if (error) throw new Error(error.message);
    const slug = data.entity?.slug ?? entityId;
    const path = `${slug}/${stamp()}.zip`;

    const zip = new ZipWriter(new BlobWriter('application/zip'), { level: 6 });
    const tables: Record<string, unknown[]> = data.tables ?? {};
    const counts: Record<string, number> = data.counts ?? {};
    const rowsTotal = Object.values(counts).reduce((a, b) => a + Number(b), 0);
    const readme = [
      `Food Studio OS — export for ${data.entity?.name ?? slug} (${data.entity?.legal_name ?? ''})`,
      `Exported ${data.exported_at}. Format ${data.format}.`,
      '',
      'One JSON file per table (an array of row objects, column names as keys).',
      'manifest.json lists every table with its row count, the tables skipped because',
      'they carry no tenant key, and the tables that never leave (credentials, platform logs).',
      '',
      'Dates are ISO-8601 UTC. Amounts are in EUR unless a column says otherwise.',
      'Foreign keys are uuids; the referenced row is in the file named after the table.',
    ].join('\n');
    await zip.add('README.txt', new TextReader(readme));
    const manifest = { ...data, tables: undefined, table_files: Object.keys(tables).sort().map((t) => `${t}.json`), rows_total: rowsTotal };
    await zip.add('manifest.json', new TextReader(JSON.stringify(manifest, null, 2)));
    for (const t of Object.keys(tables).sort()) {
      await zip.add(`${t}.json`, new TextReader(JSON.stringify(tables[t], null, 1)));
    }
    const blob: Blob = await zip.close();

    const up = await db.storage.from(BUCKET).upload(path, blob, { contentType: 'application/zip', upsert: false });
    if (up.error) throw new Error(`upload: ${up.error.message}`);
    const { data: signed } = await db.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24);

    const report = { path, bytes: blob.size, tables: Object.keys(tables).length, rows_total: rowsTotal,
                     skipped: data.skipped_no_tenant_key, denied: data.denied, counts };
    if (runId) await db.from('tenant_exports').update({ status: 'ok', path, bytes: blob.size, tables: report.tables, rows_total: rowsTotal, skipped: data.skipped_no_tenant_key }).eq('id', runId);
    return json({ ok: true, ...report, signed_url_24h: signed?.signedUrl ?? null });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (runId) await db.from('tenant_exports').update({ status: 'error', error: msg }).eq('id', runId);
    return json({ ok: false, error: msg }, 500);
  }
});
