/* =============================================================================
 * meta-reply — the ONLY path that sends a comment reply or a DM.
 *
 *   POST { "kind": "comment" | "dm", "id": "<row uuid>" }                 reply
 *   POST { "kind": "comment", "id": "<row uuid>", "action": "hide" }      hide (comments only)
 *
 * THE GATE LIVES HERE (spec §3): a reply goes out only when the row has
 * approved_by_boris = true. Otherwise 403 not_approved. No script, scheduled
 * task or agent can route around it — exactly like meta-publish.
 *
 * DMs: standard window is 24h from the person's last message. Outside it the
 * HUMAN_AGENT tag buys 7 days. Both closed → status 'failed' with a plain
 * error, no retry.
 *
 * Write-back: reply_remote_id, replied_at, reply_text, status 'replied' — or
 * the verbatim (token-scrubbed) Graph error and status 'failed'.
 * ========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { graphPost, loadAccountById, scrub } from './inbox.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

const HOURS = 3600_000;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let p: any;
  try { p = await req.json(); } catch { return json({ error: 'Body must be JSON' }, 400); }
  const kind = String(p.kind ?? ''), id = String(p.id ?? ''), action = String(p.action ?? 'reply');
  if (!['comment', 'dm'].includes(kind) || !id) return json({ error: 'kind (comment|dm) and id required' }, 400);

  if (kind === 'comment') return action === 'hide' ? hideComment(id) : replyComment(id);
  if (action === 'hide') return json({ error: 'hide is for comments only' }, 400);
  return replyDm(id);
});

/* ---------------- comments ---------------- */

async function replyComment(id: string) {
  const { data: row } = await db.from('social_comments').select('*').eq('id', id).single();
  if (!row) return json({ error: 'not_found' }, 404);

  // THE GATE.
  if (!row.approved_by_boris)
    return json({ error: 'not_approved', detail: 'approved_by_boris is false on this row' }, 403);
  if (row.status === 'replied')
    return json({ error: 'already_replied', reply_remote_id: row.reply_remote_id }, 409);

  const text = String(row.reply_text ?? row.draft_reply ?? '').trim();
  if (!text) return json({ error: 'empty_reply', detail: 'reply_text and draft_reply are both empty' }, 422);

  const acc = await loadAccountById(db, row.account_id);
  if (!acc) {
    await db.from('social_comments').update({ status: 'failed', error: 'not_connected: account inactive' }).eq('id', id);
    return json({ error: 'not_connected' }, 503);
  }

  try {
    let out: any;
    if (row.platform === 'instagram') {
      // IG nests one level: a reply to a reply goes on the parent thread,
      // addressed with the handle so the person is notified.
      const target = row.parent_remote_id ?? row.remote_comment_id;
      const msg = row.parent_remote_id && row.author_handle && !text.toLowerCase().includes(row.author_handle.toLowerCase())
        ? `${row.author_handle} ${text}` : text;
      out = await graphPost(`${target}/replies`, { message: msg }, acc.token);
    } else {
      out = await graphPost(`${row.remote_comment_id}/comments`, { message: text }, acc.token);
    }
    const now = new Date().toISOString();
    await db.from('social_comments').update({
      status: 'replied', reply_remote_id: out.id ?? null, replied_at: now, reply_text: text, error: null,
    }).eq('id', id);
    // Every reply Boris approved is a voice example for the drafter.
    await db.from('brand_voice_examples').insert({
      entity_id: row.entity_id, kind: 'approved_reply', lang: row.draft_lang ?? row.lang ?? null,
      prompt_text: row.text ?? null, text, source: 'inbox',
    });
    await db.from('social_accounts').update({ last_verified_at: now, last_error: null }).eq('id', acc.account_id);
    return json({ ok: true, kind: 'comment', id, reply_remote_id: out.id ?? null });
  } catch (e) {
    const msg = scrub(String(e instanceof Error ? e.message : e));
    await db.from('social_comments').update({ status: 'failed', error: msg }).eq('id', id);
    return json({ ok: false, error: msg }, 502);
  }
}

async function hideComment(id: string) {
  const { data: row } = await db.from('social_comments').select('*').eq('id', id).single();
  if (!row) return json({ error: 'not_found' }, 404);
  const acc = await loadAccountById(db, row.account_id);
  if (!acc) return json({ error: 'not_connected' }, 503);
  try {
    if (row.platform === 'instagram') await graphPost(row.remote_comment_id, { hide: 'true' }, acc.token);
    else await graphPost(row.remote_comment_id, { is_hidden: 'true' }, acc.token);
    await db.from('social_comments').update({ status: 'hidden', error: null }).eq('id', id);
    return json({ ok: true, kind: 'comment', id, hidden: true });
  } catch (e) {
    const msg = scrub(String(e instanceof Error ? e.message : e));
    await db.from('social_comments').update({ error: msg }).eq('id', id);
    return json({ ok: false, error: msg }, 502);
  }
}

/* ---------------- DMs ---------------- */

async function replyDm(id: string) {
  const { data: row } = await db.from('social_dm_messages').select('*').eq('id', id).single();
  if (!row) return json({ error: 'not_found' }, 404);

  // THE GATE.
  if (!row.approved_by_boris)
    return json({ error: 'not_approved', detail: 'approved_by_boris is false on this row' }, 403);
  if (row.status === 'replied')
    return json({ error: 'already_replied', reply_remote_id: row.reply_remote_id }, 409);

  const text = String(row.reply_text ?? row.draft_reply ?? '').trim();
  if (!text) return json({ error: 'empty_reply' }, 422);

  const { data: thread } = await db.from('social_dm_threads').select('*').eq('id', row.thread_id).single();
  if (!thread?.participant_id) {
    await db.from('social_dm_messages').update({ status: 'failed', error: 'no recipient id on thread' }).eq('id', id);
    return json({ error: 'no_recipient' }, 422);
  }
  const acc = await loadAccountById(db, thread.account_id);
  if (!acc) {
    await db.from('social_dm_messages').update({ status: 'failed', error: 'not_connected: account inactive' }).eq('id', id);
    return json({ error: 'not_connected' }, 503);
  }

  // Messaging windows, counted from the person's last message.
  const lastIn = new Date(thread.last_inbound_at ?? row.sent_at ?? 0).getTime();
  const age = Date.now() - lastIn;
  const params: Record<string, string> = {
    recipient: JSON.stringify({ id: thread.participant_id }),
    message: JSON.stringify({ text }),
  };
  if (age <= 24 * HOURS) {
    params.messaging_type = 'RESPONSE';
  } else if (age <= 7 * 24 * HOURS) {
    params.messaging_type = 'MESSAGE_TAG';
    params.tag = 'HUMAN_AGENT';
  } else {
    const days = Math.floor(age / (24 * HOURS));
    const msg = `messaging window closed: last message from them was ${days} days ago (24h standard / 7-day human-agent). Reply from the Instagram app.`;
    await db.from('social_dm_messages').update({ status: 'failed', error: msg }).eq('id', id);
    return json({ ok: false, error: 'window_closed', detail: msg }, 422);
  }

  try {
    // Facebook-login route: the Page owns the IG messaging endpoint. Fall back
    // to the IG user id form if this Page rejects it.
    let out: any;
    try {
      out = await graphPost(`${acc.page_id ?? acc.external_id}/messages`, params, acc.token);
    } catch (e1) {
      if (acc.page_id && acc.page_id !== acc.external_id) out = await graphPost(`${acc.external_id}/messages`, params, acc.token);
      else throw e1;
    }
    const now = new Date().toISOString();
    await db.from('social_dm_messages').update({
      status: 'replied', reply_remote_id: out.message_id ?? null, replied_at: now, reply_text: text, error: null,
    }).eq('id', id);
    if (out.message_id) {
      await db.from('social_dm_messages').upsert({
        thread_id: thread.id, entity_id: thread.entity_id, remote_message_id: out.message_id,
        direction: 'out', sender_id: acc.external_id, text, sent_at: now, status: 'replied',
      }, { onConflict: 'remote_message_id', ignoreDuplicates: true });
    }
    await db.from('social_dm_threads').update({ status: 'open', last_message_at: now }).eq('id', thread.id);
    await db.from('brand_voice_examples').insert({
      entity_id: thread.entity_id, kind: 'approved_reply', lang: row.draft_lang ?? row.lang ?? null,
      prompt_text: row.text ?? null, text, source: 'inbox',
    });
    return json({ ok: true, kind: 'dm', id, reply_remote_id: out.message_id ?? null, tag: params.tag ?? null });
  } catch (e) {
    const msg = scrub(String(e instanceof Error ? e.message : e));
    await db.from('social_dm_messages').update({ status: 'failed', error: msg }).eq('id', id);
    return json({ ok: false, error: msg }, 502);
  }
}
