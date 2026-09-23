/* =============================================================================
 * meta-inbox-pull — called by pg_cron every 10 minutes (job social-inbox-pull),
 * and by hand for a forced backfill.
 *
 *   POST {}                                      all active accounts
 *   POST { "account_id": "<uuid>" }              one account
 *   POST { "backfill": true }                    re-read the full 30-day window
 *
 * verify_jwt is false because pg_cron sends no user JWT. Auth is the shared
 * secret minted in SQL and held in Vault (social_inbox_secret), checked back
 * with social_inbox_secret_ok(). Even a caller who got past it could only
 * make us READ Meta — nothing here sends anything.
 *
 * All the logic is in inbox.ts, shared with meta-webhook and meta-reply.
 * ========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { loadAccounts, pullAccount } from './inbox.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const secret = req.headers.get('x-scheduler-secret') ?? req.headers.get('x-inbox-secret') ?? '';
  if (!secret) return json({ error: 'unauthorized' }, 401);
  const { data: ok } = await db.rpc('social_inbox_secret_ok', { p_secret: secret });
  if (!ok) return json({ error: 'unauthorized' }, 401);

  let p: any = {};
  try { p = await req.json(); } catch { /* empty body from pg_cron is fine */ }

  const accounts = await loadAccounts(db, p.account_id ? String(p.account_id) : undefined);
  const results = [];
  for (const acc of accounts) {
    results.push(await pullAccount(db, acc, p.via ?? 'cron', !!p.backfill));
  }
  // Ask the drafter to sweep anything still at 'new' (the insert trigger is
  // fire-and-forget; this is the catch-up). Best effort.
  let sweep: unknown = null;
  try {
    const r = await fetch(Deno.env.get('INBOX_DRAFT_URL') ?? 'https://www.foodstudio.ai/api/inbox/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-inbox-secret': secret },
      body: JSON.stringify({ sweep: true, limit: 25 }),
    });
    sweep = { http: r.status, body: await r.json().catch(() => null) };
  } catch (e) { sweep = { error: String(e) }; }

  return json({ ran_at: new Date().toISOString(), accounts: accounts.length, results, sweep });
});
