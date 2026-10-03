/* =============================================================================
 * db-backup — the weekly logical backup (security S2, 2026-10-02).
 *
 *   POST {}                              back up now (pg_cron does this Sunday 04:00 UTC)
 *   POST { "restore_check": true }       load the latest copy into schema restore_check,
 *                                        compare row counts with the manifest, drop it
 *   POST { "restore_check": true, "prefix": "2026-10-02T12-00-00Z" }   a specific copy
 *   POST { "prune": true }               apply the retention (keep the newest KEEP)
 *
 * verify_jwt is false (pg_cron sends no user JWT). Auth is the shared secret
 * in Vault (db_backup_secret), checked back with db_backup_secret_ok().
 *
 * What a copy is — bucket `backups` (private, service role only):
 *   <stamp>/manifest.json      tables, row counts, bytes, latest migration, exclusions
 *   <stamp>/schema.sql         backup_schema_ddl(): tables, constraints, indexes, views,
 *                              functions, triggers, policies (the migrations folder in
 *                              git stays the authoritative schema)
 *   <stamp>/data.ndjson.gz     one line per row: {"t":"schema.table","r":{...}}
 *                              every table in public + rls_audit, read in ONE
 *                              repeatable-read transaction, plus auth.users and
 *                              auth.identities with passwords/tokens stripped.
 *                              Generated columns and EXCLUDE_COLUMNS are not written.
 *
 * Why no pg_dump: edge functions cannot run binaries, and the org is on Free
 * (no Supabase backups, no branching). Postgres does the heavy lifting
 * (row_to_json + string_agg per table); this function only streams text
 * through native gzip and uploads. docs/systems/backup.md has the restore
 * procedure.
 * ========================================================================== */

import { Pool, Transaction } from 'https://deno.land/x/postgres@v0.19.3/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const BUCKET = 'backups';
const KEEP = Number(Deno.env.get('BACKUP_KEEP') ?? '8');
const SCHEMAS = (Deno.env.get('BACKUP_SCHEMAS') ?? 'public,rls_audit').split(',').map((s) => s.trim()).filter(Boolean);
// schema.table.column — never written. chef_turns.audio is the brief's example (no such
// column today; the rule stays so a future audio column cannot slip into the dump).
const EXCLUDE_COLUMNS = new Set(
  (Deno.env.get('BACKUP_EXCLUDE_COLUMNS') ?? 'public.chef_turns.audio').split(',').map((s) => s.trim()).filter(Boolean),
);
// auth.* — only what a restore needs to re-link uuids. No passwords, no tokens.
const AUTH_TABLES: Record<string, string[]> = {
  'auth.users': ['id', 'instance_id', 'aud', 'role', 'email', 'email_confirmed_at', 'phone', 'phone_confirmed_at', 'last_sign_in_at',
                 'raw_app_meta_data', 'raw_user_meta_data', 'is_super_admin', 'is_sso_user', 'is_anonymous', 'banned_until',
                 'created_at', 'updated_at', 'deleted_at'],
  'auth.identities': ['id', 'user_id', 'provider', 'provider_id', 'identity_data', 'last_sign_in_at', 'created_at', 'updated_at'],
};

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const pool = new Pool(Deno.env.get('SUPABASE_DB_URL')!, 1, true);

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

const q = (s: string) => '"' + s.replace(/"/g, '""') + '"';
const stamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');

type TableInfo = { schema: string; table: string; columns: string[]; excluded: string[]; rows: number; bytes_json: number };

// ---------------------------------------------------------------------------
// backup
// ---------------------------------------------------------------------------
async function runBackup(via: string) {
  const started = new Date();
  const prefix = stamp();
  const { data: run } = await db.from('backup_runs').insert({ kind: 'backup', via, path: prefix }).select('id').single();
  const runId = run?.id as string | undefined;

  const conn = await pool.connect();
  const tables: TableInfo[] = [];
  let bytesGz = 0;
  let schemaVersion: string | null = null;
  let tx: Transaction | null = null;
  try {
    // One consistent snapshot for every table.
    tx = conn.createTransaction('db_backup', { isolation_level: 'repeatable_read', read_only: true });
    await tx.begin();
    const T: Transaction = tx;

    const mig = await T.queryObject<{ v: string }>`select max(version)::text as v from supabase_migrations.schema_migrations`;
    schemaVersion = mig.rows[0]?.v ?? null;

    const tl = await T.queryObject<{ table_schema: string; table_name: string }>(
      `select table_schema, table_name from information_schema.tables
        where table_schema = any($1) and table_type = 'BASE TABLE' order by 1, 2`, [SCHEMAS]);

    // Stream: every table's text → gzip → collected chunks → one upload.
    const gz = new CompressionStream('gzip');
    const writer = gz.writable.getWriter();
    const collected: Uint8Array[] = [];
    const collecting = (async () => {
      const reader = gz.readable.getReader();
      for (;;) { const { value, done } = await reader.read(); if (done) break; collected.push(value); bytesGz += value.byteLength; }
    })();
    const enc = new TextEncoder();

    const dumpTable = async (schema: string, table: string, cols: string[], excluded: string[]) => {
      const fq = `${schema}.${table}`;
      const sel = cols.map((c) => q(c)).join(', ');
      // Postgres builds the JSON; we only prefix each line with the table name.
      const r = await T.queryObject<{ n: number; body: string }>(
        `select count(*)::int as n,
                coalesce(string_agg(('{"t":' || to_json($1::text)::text || ',"r":' || row_to_json(t)::text || '}'), E'\\n'), '') as body
           from (select ${sel} from ${q(schema)}.${q(table)}) t`, [fq]);
      const body = r.rows[0]?.body ?? '';
      const n = r.rows[0]?.n ?? 0;
      if (body.length) await writer.write(enc.encode(body + '\n'));
      tables.push({ schema, table, columns: cols, excluded, rows: n, bytes_json: body.length });
    };

    for (const t of tl.rows) {
      const cr = await T.queryObject<{ column_name: string; is_generated: string }>(
        `select column_name, is_generated from information_schema.columns
          where table_schema = $1 and table_name = $2 order by ordinal_position`, [t.table_schema, t.table_name]);
      const excluded: string[] = [];
      const cols: string[] = [];
      for (const c of cr.rows) {
        if (c.is_generated === 'ALWAYS' || EXCLUDE_COLUMNS.has(`${t.table_schema}.${t.table_name}.${c.column_name}`)) excluded.push(c.column_name);
        else cols.push(c.column_name);
      }
      if (!cols.length) continue;
      await dumpTable(t.table_schema, t.table_name, cols, excluded);
    }
    for (const [fq, cols] of Object.entries(AUTH_TABLES)) {
      const [schema, table] = fq.split('.');
      const present = await T.queryObject<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = $1 and table_name = $2`, [schema, table]);
      const have = new Set(present.rows.map((r) => r.column_name));
      const use = cols.filter((c) => have.has(c));
      if (use.length) await dumpTable(schema, table, use, [...have].filter((c) => !use.includes(c)));
    }

    const ddl = await T.queryObject<{ ddl: string }>(`select public.backup_schema_ddl($1) as ddl`, [SCHEMAS]);
    await T.commit();
    tx = null;

    await writer.close();
    await collecting;
    const blob = new Blob(collected as BlobPart[], { type: 'application/gzip' });

    const up1 = await db.storage.from(BUCKET).upload(`${prefix}/data.ndjson.gz`, blob, { contentType: 'application/gzip', upsert: true });
    if (up1.error) throw new Error(`upload data: ${up1.error.message}`);
    const up2 = await db.storage.from(BUCKET).upload(`${prefix}/schema.sql`, new Blob([ddl.rows[0]?.ddl ?? ''], { type: 'text/plain' }), { contentType: 'text/plain; charset=utf-8', upsert: true });
    if (up2.error) throw new Error(`upload schema: ${up2.error.message}`);

    const rowsTotal = tables.reduce((a, t) => a + t.rows, 0);
    const manifest = {
      format: 'fsos-backup/1', prefix, started_at: started.toISOString(), finished_at: new Date().toISOString(),
      project: Deno.env.get('SUPABASE_URL'), schema_version: schemaVersion, schemas: SCHEMAS, keep: KEEP,
      exclude_columns: [...EXCLUDE_COLUMNS], generated_columns_excluded: true,
      files: { data: 'data.ndjson.gz', schema: 'schema.sql' },
      totals: { tables: tables.length, rows: rowsTotal, bytes_gz: bytesGz },
      tables,
    };
    const up3 = await db.storage.from(BUCKET).upload(`${prefix}/manifest.json`, new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), { contentType: 'application/json', upsert: true });
    if (up3.error) throw new Error(`upload manifest: ${up3.error.message}`);

    const pruned = await prune();

    if (runId) await db.from('backup_runs').update({
      finished_at: new Date().toISOString(), status: 'ok', tables: tables.length, rows_total: rowsTotal, bytes_gz: bytesGz,
      schema_version: schemaVersion, report: { pruned, seconds: (Date.now() - started.getTime()) / 1000 },
    }).eq('id', runId);

    return { ok: true, prefix, tables: tables.length, rows: rowsTotal, bytes_gz: bytesGz, schema_version: schemaVersion, pruned, seconds: (Date.now() - started.getTime()) / 1000 };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (tx) await tx.rollback().catch(() => {});
    if (runId) await db.from('backup_runs').update({ finished_at: new Date().toISOString(), status: 'error', error: msg }).eq('id', runId);
    throw e;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
// retention — keep the newest KEEP copies
// ---------------------------------------------------------------------------
async function listPrefixes(): Promise<string[]> {
  const { data, error } = await db.storage.from(BUCKET).list('', { limit: 1000, sortBy: { column: 'name', order: 'desc' } });
  if (error) throw new Error(`list: ${error.message}`);
  return (data ?? []).filter((e) => !e.id || e.metadata == null).map((e) => e.name).filter((n) => /^\d{4}-\d{2}-\d{2}T/.test(n)).sort().reverse();
}
async function removePrefix(prefix: string) {
  const { data } = await db.storage.from(BUCKET).list(prefix, { limit: 1000 });
  const paths = (data ?? []).filter((e) => e.id).map((e) => `${prefix}/${e.name}`);
  if (paths.length) {
    const { error } = await db.storage.from(BUCKET).remove(paths);
    if (error) throw new Error(`remove ${prefix}: ${error.message}`);
  }
  return paths.length;
}
async function prune() {
  const all = await listPrefixes();
  const old = all.slice(KEEP);
  const removed: string[] = [];
  for (const p of old) { await removePrefix(p); removed.push(p); }
  return { kept: all.slice(0, KEEP), removed };
}

// ---------------------------------------------------------------------------
// restore check — the backup, loaded into schema restore_check, counted, dropped
// ---------------------------------------------------------------------------
async function runRestoreCheck(wanted: string | null, keepSchema: boolean) {
  const started = new Date();
  const prefix = wanted ?? (await listPrefixes())[0];
  if (!prefix) return { ok: false, error: 'no backup in the bucket yet' };
  const { data: run } = await db.from('backup_runs').insert({ kind: 'restore_check', via: 'api', path: prefix }).select('id').single();
  const runId = run?.id as string | undefined;

  const conn = await pool.connect();
  try {
    const mf = await db.storage.from(BUCKET).download(`${prefix}/manifest.json`);
    if (mf.error) throw new Error(`manifest: ${mf.error.message}`);
    const manifest = JSON.parse(await mf.data.text());
    const df = await db.storage.from(BUCKET).download(`${prefix}/data.ndjson.gz`);
    if (df.error) throw new Error(`data: ${df.error.message}`);

    await conn.queryArray(`drop schema if exists restore_check cascade`);
    await conn.queryArray(`create schema restore_check`);

    // Scratch tables: same columns (LIKE without INCLUDING GENERATED makes generated
    // columns plain), nothing else — no constraints, no triggers, no RLS, so the load
    // is a pure data check. Columns the dump does not carry lose NOT NULL.
    const target = (t: { schema: string; table: string }) => `restore_check.${q(`${t.schema}__${t.table}`)}`;
    const byFq = new Map<string, TableInfo>();
    for (const t of manifest.tables as TableInfo[]) {
      byFq.set(`${t.schema}.${t.table}`, t);
      await conn.queryArray(`create table ${target(t)} (like ${q(t.schema)}.${q(t.table)})`);
      for (const c of t.excluded) {
        await conn.queryArray(`alter table ${target(t)} alter column ${q(c)} drop not null`).catch(() => {});
      }
    }

    // Stream the gzip → lines → batched inserts per table.
    const lines = df.data.stream().pipeThrough(new DecompressionStream('gzip')).pipeThrough(new TextDecoderStream());
    const reader = lines.getReader();
    let buf = '';
    let curT: string | null = null;
    let batch: string[] = [];
    const loaded = new Map<string, number>();
    const flush = async () => {
      if (!curT || !batch.length) { batch = []; return; }
      const t = byFq.get(curT);
      if (!t) { batch = []; return; }
      const cols = t.columns.map((c) => q(c)).join(', ');
      const r = await conn.queryArray(
        `insert into ${target(t)} (${cols}) select ${cols} from json_populate_recordset(null::${target(t)}, $1::json)`,
        ['[' + batch.join(',') + ']']);
      loaded.set(curT, (loaded.get(curT) ?? 0) + Number(r.rowCount ?? 0));
      batch = [];
    };
    const handle = async (line: string) => {
      if (!line) return;
      // {"t":"schema.table","r":{...}} — read the table name without parsing the row.
      const m = /^\{"t":"([^"]+)","r":/.exec(line);
      if (!m) return;
      const fq = m[1];
      const row = line.slice(m[0].length, line.length - 1);
      if (fq !== curT) { await flush(); curT = fq; }
      batch.push(row);
      if (batch.length >= 2000) await flush();
    };
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); await handle(line); }
    }
    if (buf) await handle(buf);
    await flush();

    // Count and compare.
    const mismatches: Array<{ table: string; expected: number; restored: number }> = [];
    let checked = 0;
    for (const t of manifest.tables as TableInfo[]) {
      const r = await conn.queryObject<{ n: number }>(`select count(*)::int as n from ${target(t)}`);
      const n = r.rows[0]?.n ?? 0;
      checked++;
      if (n !== t.rows) mismatches.push({ table: `${t.schema}.${t.table}`, expected: t.rows, restored: n });
    }
    if (!keepSchema) await conn.queryArray(`drop schema restore_check cascade`);

    const report = {
      prefix, tables_checked: checked, rows_expected: manifest.totals?.rows ?? null,
      rows_restored: [...loaded.values()].reduce((a, b) => a + b, 0), mismatches,
      schema_kept: keepSchema, seconds: (Date.now() - started.getTime()) / 1000,
    };
    if (runId) await db.from('backup_runs').update({
      finished_at: new Date().toISOString(), status: mismatches.length ? 'error' : 'ok', tables: checked,
      rows_total: report.rows_restored, schema_version: manifest.schema_version ?? null, report,
      error: mismatches.length ? `${mismatches.length} tables differ` : null,
    }).eq('id', runId);
    return { ok: mismatches.length === 0, ...report };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (runId) await db.from('backup_runs').update({ finished_at: new Date().toISOString(), status: 'error', error: msg }).eq('id', runId);
    await conn.queryArray(`drop schema if exists restore_check cascade`).catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const secret = req.headers.get('x-scheduler-secret') ?? '';
  if (!secret) return json({ error: 'unauthorized' }, 401);
  const { data: ok, error: okErr } = await db.rpc('db_backup_secret_ok', { p_secret: secret });
  if (okErr || !ok) return json({ error: 'unauthorized' }, 401);

  let p: any = {};
  try { p = await req.json(); } catch { /* empty body from pg_cron is fine */ }

  try {
    if (p.restore_check) return json(await runRestoreCheck(p.prefix ? String(p.prefix) : null, !!p.keep_schema));
    if (p.prune) return json({ ok: true, ...(await prune()) });
    return json(await runBackup(String(p.via ?? 'api')));
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500);
  }
});
