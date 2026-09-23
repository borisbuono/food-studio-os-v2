/* =============================================================================
 * meta-webhook — Meta calls this for `comments` (Instagram), `feed` (Facebook
 * Page comments) and `messages` (Instagram DMs), so the inbox is near-instant.
 * The 10-minute poll (meta-inbox-pull) stays as the fallback.
 *
 *   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…   subscription handshake
 *   POST <Meta payload>  with X-Hub-Signature-256                  events
 *
 * verify_jwt is false: Meta sends no JWT. Auth is (1) the verify token held
 * in Vault (meta_webhook_verify_token, checked by RPC) for the handshake and
 * (2) the HMAC-SHA256 of the raw body with META_APP_SECRET for every event.
 * A bad signature is dropped with 401 and nothing is written.
 *
 * Everything this function does is READ from Meta and INSERT rows. It never
 * sends — meta-reply is the only path out, and it needs approved_by_boris.
 * Callback URL for the app dashboard:
 *   https://rfdsysrdoncyoytcrzpg.supabase.co/functions/v1/meta-webhook
 * ========================================================================== */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { graphGet, loadAccounts, upsertComments, upsertThreadFromGraph, isOurs, scrub, type Account, type CommentRow } from './inbox.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});
const APP_SECRET = Deno.env.get('META_APP_SECRET') ?? '';

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

async function hmacOk(raw: string, header: string | null): Promise<boolean> {
  if (!APP_SECRET || !header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');
  const given = header.slice(7).toLowerCase();
  if (hex.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode'), token = url.searchParams.get('hub.verify_token'), ch = url.searchParams.get('hub.challenge');
    if (mode !== 'subscribe' || !token || !ch) return json({ error: 'bad handshake' }, 400);
    const { data: ok } = await db.rpc('meta_webhook_verify_token_ok', { p_token: token });
    if (!ok) return json({ error: 'verify token mismatch' }, 403);
    return new Response(ch, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  if (req.method !== 'POST') return json({ error: 'GET or POST' }, 405);
  const raw = await req.text();
  if (!(await hmacOk(raw, req.headers.get('x-hub-signature-256')))) return json({ error: 'bad signature' }, 401);

  let body: any;
  try { body = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400); }

  // Always 200 to Meta once the signature is good — retries would only
  // duplicate work the poll does anyway. Errors go to social_inbox_pulls.
  const accounts = await loadAccounts(db).catch(() => [] as Account[]);
  const byExternal = new Map<string, Account>(accounts.map((a) => [a.external_id, a]));
  const results: any[] = [];

  for (const entry of body?.entry ?? []) {
    const acc = byExternal.get(String(entry.id));
    if (!acc) { results.push({ entry: entry.id, skipped: 'unknown account' }); continue; }
    try {
      for (const ch of entry.changes ?? []) {
        if (body.object === 'instagram' && ch.field === 'comments') results.push(await igComment(acc, ch.value));
        else if (body.object === 'page' && ch.field === 'feed' && ch.value?.item === 'comment') results.push(await fbComment(acc, ch.value));
        else results.push({ field: ch.field, skipped: true });
      }
      for (const m of entry.messaging ?? []) {
        if (body.object === 'instagram' && m.message && !m.message.is_echo) results.push(await igMessage(acc, m));
      }
    } catch (e) {
      const err = scrub(String(e instanceof Error ? e.message : e));
      results.push({ entry: entry.id, error: err });
      await db.from('social_inbox_pulls').insert({ account_id: acc.account_id, via: 'webhook', ok: false, error: err });
    }
  }
  return json({ ok: true, results });
});

/* IG comment webhook value: { id, text, from{id,username}, media{id, media_product_type}, parent_id? } */
async function igComment(acc: Account, v: any) {
  if (isOurs(acc, v.from?.id, v.from?.username)) {
    // Our own reply under someone's comment → that comment is answered.
    if (v.parent_id) {
      await db.from('social_comments').update({ status: 'replied', reply_remote_id: v.id, replied_at: new Date().toISOString() })
        .eq('remote_comment_id', v.parent_id).not('status', 'in', '(replied,hidden)');
    }
    return { comment: v.id, ours: true };
  }
  const mediaId = String(v.media?.id ?? '');
  let media: any = {};
  if (mediaId) media = await graphGet(mediaId, { fields: 'id,caption,permalink,thumbnail_url,media_url,media_type,timestamp' }, acc.token).catch(() => ({}));
  const { data: post } = mediaId ? await db.from('social_posts').select('id').eq('remote_id', mediaId).maybeSingle() : { data: null };
  const row: CommentRow = {
    entity_id: acc.entity_id, account_id: acc.account_id, platform: 'instagram',
    post_id: post?.id ?? null, remote_media_id: mediaId || 'unknown', remote_comment_id: String(v.id),
    parent_remote_id: v.parent_id ? String(v.parent_id) : null,
    author_id: v.from?.id ?? null, author_handle: v.from?.username ? `@${String(v.from.username).toLowerCase()}` : null,
    author_name: null, text: v.text ?? null, created_at_remote: new Date().toISOString(),
    media_permalink: media.permalink ?? null,
    media_thumbnail_url: media.thumbnail_url ?? (media.media_type === 'VIDEO' ? null : media.media_url) ?? null,
    media_caption: media.caption ?? null,
  };
  const u = await upsertComments(db, [row], new Map());
  return { comment: v.id, inserted: u.inserted };
}

/* FB feed webhook value: { item:'comment', comment_id, post_id, parent_id, from{id,name}, message, created_time, verb } */
async function fbComment(acc: Account, v: any) {
  if (v.verb && v.verb !== 'add') return { comment: v.comment_id, verb: v.verb, skipped: true };
  if (isOurs(acc, v.from?.id, v.from?.name)) {
    if (v.parent_id && v.parent_id !== v.post_id) {
      await db.from('social_comments').update({ status: 'replied', reply_remote_id: v.comment_id, replied_at: new Date().toISOString() })
        .eq('remote_comment_id', v.parent_id).not('status', 'in', '(replied,hidden)');
    }
    return { comment: v.comment_id, ours: true };
  }
  const postId = String(v.post_id ?? '');
  const post = postId ? await graphGet(postId, { fields: 'id,message,permalink_url,full_picture' }, acc.token).catch(() => ({})) : {};
  const { data: ours } = postId ? await db.from('social_posts').select('id').eq('remote_id', postId).maybeSingle() : { data: null };
  const parent = v.parent_id && v.parent_id !== postId ? String(v.parent_id) : null;
  const row: CommentRow = {
    entity_id: acc.entity_id, account_id: acc.account_id, platform: 'facebook',
    post_id: ours?.id ?? null, remote_media_id: postId || 'unknown', remote_comment_id: String(v.comment_id),
    parent_remote_id: parent, author_id: v.from?.id ?? null, author_handle: null, author_name: v.from?.name ?? null,
    text: v.message ?? null,
    created_at_remote: v.created_time ? new Date(Number(v.created_time) * 1000).toISOString() : new Date().toISOString(),
    media_permalink: post.permalink_url ?? null, media_thumbnail_url: post.full_picture ?? null, media_caption: post.message ?? null,
  };
  const u = await upsertComments(db, [row], new Map());
  return { comment: v.comment_id, inserted: u.inserted };
}

/* IG messaging event: { sender{id}, recipient{id}, timestamp, message{mid,text,attachments} } */
async function igMessage(acc: Account, m: any) {
  const senderId = String(m.sender?.id ?? '');
  if (!senderId || !acc.page_id) return { message: m.message?.mid, skipped: 'no sender/page' };
  // Find the conversation for this person, then store the whole thread the
  // same way the poll does (participants, last inbound, which bubble is 'new').
  const conv = await graphGet(`${acc.page_id}/conversations`, { platform: 'instagram', user_id: senderId, fields: 'id' }, acc.token);
  const convId = conv?.data?.[0]?.id;
  if (!convId) return { message: m.message?.mid, skipped: 'conversation not found' };
  const n = await upsertThreadFromGraph(db, acc, String(convId), null);
  return { message: m.message?.mid, conversation: convId, inserted: n };
}
