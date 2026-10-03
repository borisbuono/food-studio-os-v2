/* =============================================================================
 * email-reply — the ONLY path that sends an email from a connected mailbox.
 *
 *   POST { id, text, confirm_token, user_id, action, via?, dry_run? }
 *
 * THE GATE LIVES HERE (brief E4, same shape as meta-reply):
 *   1. the caller holds the service-role key (Vercel: /api/email/act, /api/chef/act);
 *   2. `action` is {type:"approve_email", entity_id, id, text, …} for THIS thread
 *      and THIS text — re-hashed here with the shared canonical() so the browser
 *      cannot swap the text after the read-back;
 *   3. email_reply_claim() finds a CONSUMED chef_confirm_tokens row (tap /
 *      spoken yes / inbox page tick) for that user + that hash, < 10 min old,
 *      never used for another thread, and the user manages the thread's house.
 *      That RPC is the one writer of approved_by_boris. Anything short → 403.
 *
 * Then: Gmail users.messages.send as the connected mailbox, raw MIME with
 * In-Reply-To / References so the reply stays in the guest's thread, threadId
 * pinned. Write-back via email_reply_record_sent(): status replied, replied_at
 * (hours_to_answer fills itself), the sent mail as thread history, the approved
 * reply as a brand_voice_examples row. Failures → status failed + plain error.
 *
 * dry_run: runs the whole gate read-only and returns the headers it WOULD send.
 * Never auto-send. Never send without a token. Not even noise.
 * ========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { canonical, hashableAction } from './canonical.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function scrub(s: string): string {
  return s.replace(/ya29\.[A-Za-z0-9_-]{20,}/g, '[token]').replace(/1\/\/[A-Za-z0-9_-]{20,}/g, '[refresh]').replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[jwt]');
}
async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function b64(s: string): string {
  const bytes = new TextEncoder().encode(s); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const b64url = (s: string) => b64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function encodeHeaderWord(s: string): string { return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`; }

// Identical to lib/email/gmail.ts buildReplyMime (tested there).
function buildReplyMime(a: { from: string; to: string[]; subject: string; text: string; inReplyTo?: string | null; references?: string | null }): string {
  const subj = a.subject.trim().toLowerCase().startsWith('re:') ? a.subject.trim() : `Re: ${a.subject.trim()}`;
  return [
    `From: ${a.from}`, `To: ${a.to.join(', ')}`, `Subject: ${encodeHeaderWord(subj)}`,
    ...(a.inReplyTo ? [`In-Reply-To: ${a.inReplyTo}`] : []),
    ...(a.references ? [`References: ${a.references}`] : []),
    `MIME-Version: 1.0`, `Content-Type: text/plain; charset="UTF-8"`, `Content-Transfer-Encoding: base64`, ``,
    b64(a.text).replace(/(.{76})/g, '$1\r\n'),
  ].join('\r\n');
}

async function fail(threadId: string, status: number, error: string, extra: Record<string, unknown> = {}) {
  await db.from('email_threads').update({ status: 'failed', error: scrub(error).slice(0, 400) }).eq('id', threadId);
  return json({ ok: false, error: scrub(error), ...extra }, status);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  // Caller must be the OS (service role) — the anon key alone never reaches the gate.
  const auth = req.headers.get('authorization') || '';
  if (!SERVICE_KEY || auth !== `Bearer ${SERVICE_KEY}`) return json({ ok: false, error: 'forbidden', code: 'not_service' }, 403);

  let p: any;
  try { p = await req.json(); } catch { return json({ error: 'Body must be JSON' }, 400); }
  const id = String(p.id ?? ''), text = String(p.text ?? '').trim(), token = String(p.confirm_token ?? ''), userId = String(p.user_id ?? '');
  const action = p.action && typeof p.action === 'object' ? p.action as Record<string, unknown> : null;
  const dryRun = p.dry_run === true;
  if (!UUID.test(id)) return json({ ok: false, error: 'id (thread uuid) required' }, 400);

  // --------------------------------------------------------------- THE GATE
  // Everything the browser could have tampered with is checked against the row
  // and re-hashed; the token itself is checked in SQL (consumed, fresh, unused).
  if (!token || !UUID.test(token) || !UUID.test(userId) || !action)
    return json({ ok: false, error: 'not_confirmed', reason: 'missing', detail: 'confirm_token, user_id and action are required' }, 403);
  if (action.type !== 'approve_email' || String(action.id) !== id || String(action.text ?? '').trim() !== text)
    return json({ ok: false, error: 'not_confirmed', reason: 'mismatch', detail: 'action does not describe this thread and text' }, 403);
  const hash = await sha256Hex(canonical(hashableAction(action)));
  const { data: claim, error: claimErr } = await db.rpc('email_reply_claim', {
    p_thread: id, p_token: token, p_user: userId, p_action_hash: hash, p_text: text, p_dry_run: dryRun,
  });
  if (claimErr) return json({ ok: false, error: `gate: ${scrub(claimErr.message)}` }, 500);
  if (!claim?.ok) {
    const reason = String(claim?.reason || 'invalid');
    if (reason === 'not_found') return json({ ok: false, error: 'not_found' }, 404);
    if (reason === 'already_replied') return json({ ok: false, error: 'already_replied' }, 409);
    if (reason === 'empty_reply') return json({ ok: false, error: 'empty_reply' }, 422);
    return json({ ok: false, error: 'not_confirmed', reason, detail: 'no consumed confirm token for this user, thread and text' }, 403);
  }
  if (String(action.entity_id ?? '') !== String(claim.thread.entity_id))
    return json({ ok: false, error: 'not_confirmed', reason: 'mismatch', detail: 'entity' }, 403);
  const thread = claim.thread as { id: string; entity_id: string; account_id: string; gmail_thread_id: string; subject: string | null; from_address: string | null; from_name: string | null; draft_lang: string | null };

  // --------------------------------------------------------------- the reply target
  const [{ data: acc }, { data: lastIn }] = await Promise.all([
    db.from('email_accounts').select('id, address, display_name, status, revoked_at').eq('id', thread.account_id).maybeSingle(),
    db.from('email_messages').select('from_address, from_name, message_id_header, references_header, body_text, received_at')
      .eq('thread_id', id).eq('direction', 'in').order('received_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!acc || acc.revoked_at || !['active', 'needs_reconnect'].includes(String(acc.status)))
    return dryRun ? json({ ok: false, error: 'not_connected' }, 503) : fail(id, 503, 'not_connected: mailbox inactive — reconnect it on Comms › Mail');
  const to = (lastIn?.from_address || thread.from_address || '').toLowerCase();
  if (!to) return dryRun ? json({ ok: false, error: 'no_recipient' }, 422) : fail(id, 422, 'no recipient on thread');
  const inReplyTo = lastIn?.message_id_header || null;
  const references = inReplyTo ? [lastIn?.references_header, inReplyTo].filter(Boolean).join(' ') : null;
  const from = acc.display_name ? `${encodeHeaderWord(String(acc.display_name))} <${acc.address}>` : String(acc.address);
  const toHeader = lastIn?.from_name ? `${encodeHeaderWord(String(lastIn.from_name))} <${to}>` : to;
  const subject = thread.subject || '(no subject)';
  const raw = buildReplyMime({ from, to: [toHeader], subject, text, inReplyTo, references });

  if (dryRun) {
    return json({ ok: true, dry_run: true, gate: 'passed', via: claim.via, would_send: {
      from: acc.address, to, subject: subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`,
      in_reply_to: inReplyTo, references, gmail_thread_id: thread.gmail_thread_id, bytes: raw.length,
    } });
  }

  // --------------------------------------------------------------- access token (Vault; refreshed by the OS before the call)
  const { data: tok, error: tokErr } = await db.rpc('email_account_tokens', { p_account_id: acc.id });
  const row = (Array.isArray(tok) ? tok[0] : tok) as { access_token: string | null; refresh_token: string | null; token_expires_at: string | null } | undefined;
  if (tokErr || !row?.refresh_token) return fail(id, 503, 'not_connected: no refresh token — reconnect the mailbox');
  let access = row.access_token;
  const exp = row.token_expires_at ? Date.parse(row.token_expires_at) : 0;
  if (!access || exp < Date.now() + 60_000) {
    // The Google client is PER HOUSE since 2026-10-03 (oauth_clients row, secret in Vault, read via the
    // service-role RPC). Env pair only as the legacy fallback. If neither, the OS refreshes before calling.
    const { data: oc } = await db.rpc('fn_oauth_client_for', { p_entity_id: thread.entity_id, p_provider: 'google' });
    const ocRow = (Array.isArray(oc) ? oc[0] : oc) as { client_id?: string; client_secret?: string } | undefined;
    const cid = ocRow?.client_id || Deno.env.get('GOOGLE_OAUTH_CLIENT_ID'), csec = ocRow?.client_secret || Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');
    if (!cid || !csec) return fail(id, 503, 'token_expired: access token needs a refresh — the OS refreshes before calling; try Send again', { code: 'token_expired' });
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cid, client_secret: csec, refresh_token: row.refresh_token, grant_type: 'refresh_token' }),
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) {
      if (j.error === 'invalid_grant') await db.from('email_accounts').update({ status: 'needs_reconnect', last_error: 'invalid_grant on send' }).eq('id', acc.id);
      return fail(id, 503, `google refresh ${r.status}: ${j.error || 'no token'}`);
    }
    access = String(j.access_token);
    const expiresAt = new Date(Date.now() + (Number(j.expires_in) || 3000) * 1000).toISOString();
    await db.rpc('email_account_set_access', { p_account_id: acc.id, p_access_token: access, p_expires_at: expiresAt });
  }

  // --------------------------------------------------------------- send, inside the same Gmail thread
  try {
    const r = await fetch(`${GMAIL}/messages/send`, {
      method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw: b64url(raw), threadId: thread.gmail_thread_id }),
    });
    const sent: any = await r.json().catch(() => ({}));
    if (!r.ok || !sent?.id) {
      const msg = `gmail send ${r.status}: ${sent?.error?.message || JSON.stringify(sent).slice(0, 200)}`;
      if (r.status === 401) await db.from('email_accounts').update({ status: 'needs_reconnect', last_error: msg }).eq('id', acc.id);
      return fail(id, 502, msg);
    }
    // Best effort: the Message-ID Gmail assigned, so a later reply from them threads onto ours.
    let messageIdHeader: string | null = null;
    try {
      const m = await fetch(`${GMAIL}/messages/${encodeURIComponent(sent.id)}?format=metadata&metadataHeaders=Message-ID`, { headers: { authorization: `Bearer ${access}` } });
      const mj: any = await m.json();
      messageIdHeader = (mj?.payload?.headers || []).find((h: any) => String(h.name).toLowerCase() === 'message-id')?.value || null;
    } catch { /* optional */ }

    const { data: rec, error: recErr } = await db.rpc('email_reply_record_sent', {
      p_thread: id, p_gmail_message_id: String(sent.id), p_message_id_header: messageIdHeader, p_to: [to], p_prompt_text: lastIn?.body_text || null,
    });
    if (recErr) console.error('record_sent', recErr.message);
    await db.from('email_accounts').update({ last_error: null, consecutive_failures: 0 }).eq('id', acc.id);
    // Observation (domain comms): the enquiry was answered, and how fast.
    try {
      const { data: code } = await db.rpc('entity_code_for', { p_entity_id: thread.entity_id });
      const h = rec?.hours_to_answer != null ? ` in ${Number(rec.hours_to_answer).toFixed(1)} h` : '';
      await db.rpc('observe', { p_entity_code: code || 'BBH', p_body: `Email answered${h} via ${claim.via || 'tap'} (thread ${id.slice(0, 8)}, to ${to.split('@')[1] || '?'})`, p_source: 'email_channel', p_domain: 'comms', p_subject: null });
    } catch { /* best effort */ }
    return json({ ok: true, id, gmail_message_id: sent.id, gmail_thread_id: sent.threadId ?? thread.gmail_thread_id, replied_at: rec?.replied_at ?? null, hours_to_answer: rec?.hours_to_answer ?? null, via: claim.via });
  } catch (e) {
    return fail(id, 502, String(e instanceof Error ? e.message : e));
  }
});
