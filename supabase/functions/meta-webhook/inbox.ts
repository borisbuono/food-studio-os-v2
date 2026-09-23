/* =============================================================================
 * inbox.ts — shared by meta-inbox-pull (pg_cron every 10 min), meta-webhook
 * (near-instant) and meta-reply (the send path). One file, deployed inside
 * each, so the Graph calls, token lookup and upsert rules never drift.
 *
 * Rules (spec §2):
 *   • upsert on the remote id — a row that already exists is never re-inserted
 *   • a row at status 'replied' is never overwritten
 *   • comments written by our own accounts are skipped (and, when they sit
 *     under someone's comment, they mark that comment as already replied)
 *   • the draft trigger fires only on rows inserted at status 'new', so a
 *     comment Boris already answered by hand never gets a draft
 *
 * Tokens: rows in social_accounts, decrypted with social_account_token()
 * (service role only). Same pattern as publish.ts. Never env vars.
 * ========================================================================== */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

export const GRAPH = `https://graph.facebook.com/${Deno.env.get('GRAPH_VERSION') ?? 'v23.0'}`;
export const LOOKBACK_DAYS = 30;

export function scrub(s: string): string {
  return s.replace(/EAA[A-Za-z0-9_-]{20,}/g, '[token]');
}

export async function graphGet(path: string, params: Record<string, string>, token: string): Promise<any> {
  const u = path.startsWith('http') ? new URL(path) : new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('access_token', token);
  const res = await fetch(u);
  const out = await res.json().catch(() => ({}));
  if (out?.error) throw new Error(scrub(`${out.error.type ?? 'GraphError'} (#${out.error.code ?? '?'}): ${out.error.message}` +
    (out.error.error_user_msg ? ` — ${out.error.error_user_msg}` : '')));
  if (!res.ok) throw new Error(`Graph ${res.status} on ${path}`);
  return out;
}

export async function graphPost(path: string, params: Record<string, string>, token: string): Promise<any> {
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH}/${path}`, { method: 'POST', body });
  const out = await res.json().catch(() => ({}));
  if (out?.error) throw new Error(scrub(`${out.error.type ?? 'GraphError'} (#${out.error.code ?? '?'}): ${out.error.message}` +
    (out.error.error_user_msg ? ` — ${out.error.error_user_msg}` : '')));
  if (!res.ok) throw new Error(`Graph ${res.status} on ${path}`);
  return out;
}

/* Walk `paging.next` until `stop` says so or the page count runs out. */
export async function graphPages(path: string, params: Record<string, string>, token: string,
                                 stop: (item: any) => boolean, maxPages = 8): Promise<any[]> {
  const out: any[] = [];
  let page = await graphGet(path, params, token);
  for (let i = 0; i < maxPages; i++) {
    const data: any[] = page?.data ?? [];
    let halt = false;
    for (const it of data) { if (stop(it)) { halt = true; break; } out.push(it); }
    if (halt || !page?.paging?.next) break;
    page = await graphGet(page.paging.next, {}, token);
  }
  return out;
}

export type Kind = 'instagram_business' | 'facebook_page';
export interface Account {
  account_id: string; entity_id: string; kind: Kind; platform: 'instagram' | 'facebook';
  external_id: string; handle: string | null; page_id: string | null; token: string;
}

export async function loadAccounts(db: SupabaseClient, onlyAccountId?: string): Promise<Account[]> {
  let q = db.from('social_accounts_resolved')
    .select('account_id, entity_id, kind, external_id, handle, parent_external_id, status')
    .eq('provider', 'meta').eq('status', 'active');
  if (onlyAccountId) q = q.eq('account_id', onlyAccountId);
  const { data: rows, error } = await q;
  if (error) throw new Error(error.message);
  const all = rows ?? [];
  const out: Account[] = [];
  for (const r of all) {
    const { data: token } = await db.rpc('social_account_token', { p_account_id: r.account_id });
    if (!token) continue;
    // An IG account's messaging + conversations endpoints hang off its Page.
    let page_id: string | null = r.parent_external_id ?? null;
    if (r.kind === 'instagram_business' && !page_id) {
      const sib = all.find((x: any) => x.entity_id === r.entity_id && x.kind === 'facebook_page');
      page_id = sib?.external_id ?? null;
    }
    if (r.kind === 'facebook_page') page_id = r.external_id;
    out.push({
      account_id: r.account_id, entity_id: r.entity_id, kind: r.kind,
      platform: r.kind === 'instagram_business' ? 'instagram' : 'facebook',
      external_id: r.external_id, handle: r.handle, page_id, token,
    });
  }
  return out;
}

export async function loadAccountById(db: SupabaseClient, accountId: string): Promise<Account | null> {
  const a = await loadAccounts(db, accountId);
  return a[0] ?? null;
}

const bare = (h: string | null | undefined) => (h ?? '').replace(/^@/, '').toLowerCase();

export function isOurs(acc: Account, fromId?: string | null, username?: string | null): boolean {
  if (fromId && (fromId === acc.external_id || (acc.page_id && fromId === acc.page_id))) return true;
  if (username && acc.handle && bare(username) === bare(acc.handle)) return true;
  return false;
}

/* ---------------------------------------------------------------------------
 * Comment upsert. `rows` may contain both fresh comments and ones we already
 * hold. Insert the new ones; on the existing ones only refresh text/author
 * when the row is not yet replied. `answered` marks remote ids we saw our own
 * reply under — those flip to 'replied' (hand-answered in the app).
 * ------------------------------------------------------------------------ */
export interface CommentRow {
  entity_id: string; account_id: string; platform: 'instagram' | 'facebook';
  post_id: string | null; remote_media_id: string; remote_comment_id: string;
  parent_remote_id: string | null; author_id: string | null; author_handle: string | null;
  author_name: string | null; text: string | null; created_at_remote: string | null;
  media_permalink: string | null; media_thumbnail_url: string | null; media_caption: string | null;
}

export async function upsertComments(db: SupabaseClient, rows: CommentRow[],
                                     answered: Map<string, { id: string; at: string | null }>): Promise<{ inserted: number; answered: number }> {
  if (!rows.length) return { inserted: 0, answered: 0 };
  const ids = rows.map((r) => r.remote_comment_id);
  const { data: have } = await db.from('social_comments').select('remote_comment_id, status').in('remote_comment_id', ids);
  const haveMap = new Map<string, string>((have ?? []).map((h: any) => [h.remote_comment_id, h.status]));

  const fresh = rows.filter((r) => !haveMap.has(r.remote_comment_id)).map((r) => {
    const a = answered.get(r.remote_comment_id);
    return a
      ? { ...r, status: 'replied', reply_remote_id: a.id, replied_at: a.at ?? new Date().toISOString(), fetched_at: new Date().toISOString() }
      : { ...r, status: 'new', fetched_at: new Date().toISOString() };
  });
  let inserted = 0;
  for (let i = 0; i < fresh.length; i += 200) {
    const chunk = fresh.slice(i, i + 200);
    const { error } = await db.from('social_comments').upsert(chunk, { onConflict: 'remote_comment_id', ignoreDuplicates: true });
    if (error) throw new Error(`social_comments upsert: ${error.message}`);
    inserted += chunk.length;
  }

  // Already-held rows that we now see our own reply under: flip to replied
  // unless they are already replied / hidden (never overwrite those).
  let flipped = 0;
  for (const [rid, a] of answered) {
    const st = haveMap.get(rid);
    if (!st || st === 'replied' || st === 'hidden') continue;
    const { error } = await db.from('social_comments')
      .update({ status: 'replied', reply_remote_id: a.id, replied_at: a.at ?? new Date().toISOString(), error: null })
      .eq('remote_comment_id', rid).neq('status', 'replied');
    if (!error) flipped++;
  }
  return { inserted, answered: flipped };
}

/* ---------------------------------------------------------------------------
 * Instagram comments on media from the last LOOKBACK_DAYS.
 * Cheap poll: one media list call per run; comments are only re-read for
 * media whose comments_count moved since the last scan (or on backfill).
 * ------------------------------------------------------------------------ */
export async function pullInstagramComments(db: SupabaseClient, acc: Account, backfill: boolean) {
  const since = Date.now() - LOOKBACK_DAYS * 86400_000;
  const media = await graphPages(`${acc.external_id}/media`, {
    fields: 'id,caption,permalink,thumbnail_url,media_url,media_type,timestamp,comments_count', limit: '50',
  }, acc.token, (m) => new Date(m.timestamp).getTime() < since);

  const { data: seen } = await db.from('social_inbox_media').select('remote_media_id, comments_count')
    .eq('account_id', acc.account_id);
  const seenMap = new Map<string, number | null>((seen ?? []).map((s: any) => [s.remote_media_id, s.comments_count]));

  const { data: posts } = await db.from('social_posts').select('id, remote_id, platform_results').eq('status', 'published');
  const postByRemote = new Map<string, string>();
  for (const p of posts ?? []) {
    if (p.remote_id) postByRemote.set(String(p.remote_id), p.id);
    const ig = (p as any).platform_results?.instagram?.id; if (ig) postByRemote.set(String(ig), p.id);
    const fb = (p as any).platform_results?.facebook?.id; if (fb) postByRemote.set(String(fb), p.id);
  }

  let scanned = 0, inserted = 0, answered = 0;
  for (const m of media) {
    const count = Number(m.comments_count ?? 0);
    const prev = seenMap.get(m.id);
    const changed = backfill || prev === undefined || prev !== count;
    const thumb = m.thumbnail_url ?? (m.media_type === 'VIDEO' ? null : m.media_url) ?? null;
    if (changed && count > 0) {
      scanned++;
      const comments = await graphPages(`${m.id}/comments`, {
        fields: 'id,text,username,timestamp,from{id,username},replies{id,text,username,timestamp,from{id,username}}',
        limit: '50',
      }, acc.token, () => false, 6);
      const rows: CommentRow[] = [];
      const ans = new Map<string, { id: string; at: string | null }>();
      const push = (c: any, parent: string | null) => {
        const fromId = c.from?.id ?? null, uname = c.from?.username ?? c.username ?? null;
        if (isOurs(acc, fromId, uname)) {
          if (parent) ans.set(parent, { id: c.id, at: c.timestamp ?? null });
          return;
        }
        rows.push({
          entity_id: acc.entity_id, account_id: acc.account_id, platform: 'instagram',
          post_id: postByRemote.get(m.id) ?? null, remote_media_id: m.id, remote_comment_id: c.id,
          parent_remote_id: parent, author_id: fromId, author_handle: uname ? `@${bare(uname)}` : null,
          author_name: null, text: c.text ?? null, created_at_remote: c.timestamp ?? null,
          media_permalink: m.permalink ?? null, media_thumbnail_url: thumb, media_caption: m.caption ?? null,
        });
      };
      for (const c of comments) {
        push(c, null);
        for (const r of c.replies?.data ?? []) push(r, c.id);
      }
      const u = await upsertComments(db, rows, ans);
      inserted += u.inserted; answered += u.answered;
    }
    await db.from('social_inbox_media').upsert({
      account_id: acc.account_id, remote_media_id: m.id, platform: 'instagram',
      permalink: m.permalink ?? null, thumbnail_url: thumb, caption: m.caption ?? null,
      posted_at: m.timestamp ?? null, comments_count: count,
      last_scanned_at: changed ? new Date().toISOString() : undefined,
    }, { onConflict: 'account_id,remote_media_id' });
  }
  return { media: media.length, scanned, inserted, answered };
}

/* ---------------------------------------------------------------------------
 * Facebook Page comments. filter=stream returns replies flat with `parent`.
 * ------------------------------------------------------------------------ */
export async function pullFacebookComments(db: SupabaseClient, acc: Account, backfill: boolean) {
  const sinceSec = Math.floor((Date.now() - LOOKBACK_DAYS * 86400_000) / 1000);
  const posts = await graphPages(`${acc.external_id}/posts`, {
    fields: 'id,message,permalink_url,full_picture,created_time,comments.summary(true).limit(0)',
    since: String(sinceSec), limit: '50',
  }, acc.token, () => false, 4);

  const { data: seen } = await db.from('social_inbox_media').select('remote_media_id, comments_count')
    .eq('account_id', acc.account_id);
  const seenMap = new Map<string, number | null>((seen ?? []).map((s: any) => [s.remote_media_id, s.comments_count]));
  const { data: ours } = await db.from('social_posts').select('id, remote_id, platform_results').eq('status', 'published');
  const postByRemote = new Map<string, string>();
  for (const p of ours ?? []) {
    if (p.remote_id) postByRemote.set(String(p.remote_id), p.id);
    const fb = (p as any).platform_results?.facebook?.id; if (fb) postByRemote.set(String(fb), p.id);
  }

  let scanned = 0, inserted = 0, answered = 0;
  for (const p of posts) {
    const count = Number(p.comments?.summary?.total_count ?? 0);
    const prev = seenMap.get(p.id);
    const changed = backfill || prev === undefined || prev !== count;
    if (changed && count > 0) {
      scanned++;
      const comments = await graphPages(`${p.id}/comments`, {
        fields: 'id,message,from{id,name},created_time,parent{id}', filter: 'stream', limit: '100',
      }, acc.token, () => false, 4);
      const rows: CommentRow[] = [];
      const ans = new Map<string, { id: string; at: string | null }>();
      for (const c of comments) {
        const parent = c.parent?.id ?? null;
        const fromId = c.from?.id ?? null;
        if (isOurs(acc, fromId, c.from?.name ?? null)) {
          if (parent) ans.set(parent, { id: c.id, at: c.created_time ?? null });
          continue;
        }
        rows.push({
          entity_id: acc.entity_id, account_id: acc.account_id, platform: 'facebook',
          post_id: postByRemote.get(p.id) ?? null, remote_media_id: p.id, remote_comment_id: c.id,
          parent_remote_id: parent, author_id: fromId, author_handle: null, author_name: c.from?.name ?? null,
          text: c.message ?? null, created_at_remote: c.created_time ?? null,
          media_permalink: p.permalink_url ?? null, media_thumbnail_url: p.full_picture ?? null, media_caption: p.message ?? null,
        });
      }
      const u = await upsertComments(db, rows, ans);
      inserted += u.inserted; answered += u.answered;
    }
    await db.from('social_inbox_media').upsert({
      account_id: acc.account_id, remote_media_id: p.id, platform: 'facebook',
      permalink: p.permalink_url ?? null, thumbnail_url: p.full_picture ?? null, caption: p.message ?? null,
      posted_at: p.created_time ?? null, comments_count: count,
      last_scanned_at: changed ? new Date().toISOString() : undefined,
    }, { onConflict: 'account_id,remote_media_id' });
  }
  return { media: posts.length, scanned, inserted, answered };
}

/* ---------------------------------------------------------------------------
 * Instagram DMs. Conversations hang off the Page (platform=instagram).
 * Only the LAST inbound message of a burst is a 'new' item — one draft per
 * conversation, not one per bubble. Inbound messages that already have a
 * later outbound reply are stored as 'replied' (answered by hand).
 * ------------------------------------------------------------------------ */
export async function pullInstagramDms(db: SupabaseClient, acc: Account, backfill: boolean) {
  if (!acc.page_id) return { threads: 0, inserted: 0, skipped: 'no page id' };
  const since = Date.now() - LOOKBACK_DAYS * 86400_000;
  const convs = await graphPages(`${acc.page_id}/conversations`, {
    platform: 'instagram', fields: 'id,updated_time', limit: '10',
  }, acc.token, (c) => new Date(c.updated_time).getTime() < since, 5);

  const { data: known } = await db.from('social_dm_threads').select('id, remote_thread_id, last_message_at')
    .eq('account_id', acc.account_id);
  const knownMap = new Map<string, any>((known ?? []).map((k: any) => [k.remote_thread_id, k]));

  let threads = 0, inserted = 0;
  for (const c of convs) {
    const k = knownMap.get(c.id);
    if (!backfill && k?.last_message_at && new Date(k.last_message_at).getTime() >= new Date(c.updated_time).getTime()) continue;
    threads++;
    const n = await upsertThreadFromGraph(db, acc, c.id, null);
    inserted += n;
  }
  return { threads, inserted };
}

/* Shared by the poller and the webhook: (re)read one conversation and store it. */
export async function upsertThreadFromGraph(db: SupabaseClient, acc: Account, convId: string,
                                            participants: any[] | null): Promise<number> {
  const detail = await graphGet(convId, {
    fields: 'id,updated_time,participants,messages.limit(12){id,from,to,message,created_time,attachments}',
  }, acc.token);
  const parts: any[] = participants ?? detail.participants?.data ?? [];
  const other = parts.find((p) => !isOurs(acc, p.id, p.username)) ?? null;
  const msgs: any[] = (detail.messages?.data ?? []).slice().sort(
    (a: any, b: any) => new Date(a.created_time).getTime() - new Date(b.created_time).getTime());
  const last = msgs[msgs.length - 1];
  const lastIn = [...msgs].reverse().find((m) => !isOurs(acc, m.from?.id, m.from?.username));
  const lastOut = [...msgs].reverse().find((m) => isOurs(acc, m.from?.id, m.from?.username));

  const { data: thread, error } = await db.from('social_dm_threads').upsert({
    entity_id: acc.entity_id, account_id: acc.account_id, platform: 'instagram',
    remote_thread_id: convId,
    participant_id: other?.id ?? null,
    participant_handle: other?.username ? `@${bare(other.username)}` : null,
    participant_name: other?.name ?? null,
    last_message_at: last?.created_time ?? detail.updated_time ?? null,
    last_inbound_at: lastIn?.created_time ?? null,
    status: last && !isOurs(acc, last.from?.id, last.from?.username) ? 'waiting' : 'open',
    fetched_at: new Date().toISOString(),
  }, { onConflict: 'remote_thread_id' }).select('id').single();
  if (error || !thread) throw new Error(`social_dm_threads upsert: ${error?.message}`);

  const ids = msgs.map((m) => m.id);
  const { data: have } = ids.length
    ? await db.from('social_dm_messages').select('remote_message_id').in('remote_message_id', ids)
    : { data: [] as any[] };
  const haveSet = new Set((have ?? []).map((h: any) => h.remote_message_id));
  const lastInboundId = lastIn?.id ?? null;
  const lastOutAt = lastOut ? new Date(lastOut.created_time).getTime() : 0;

  const rows = msgs.filter((m) => !haveSet.has(m.id)).map((m) => {
    const out = isOurs(acc, m.from?.id, m.from?.username);
    const t = new Date(m.created_time).getTime();
    let status = 'replied';
    if (!out) status = m.id === lastInboundId && t > lastOutAt ? 'new' : (t > lastOutAt ? 'skipped' : 'replied');
    return {
      thread_id: thread.id, entity_id: acc.entity_id, remote_message_id: m.id,
      direction: out ? 'out' : 'in', sender_id: m.from?.id ?? null,
      text: m.message ?? null, attachments: m.attachments?.data ?? null,
      sent_at: m.created_time ?? null, status, fetched_at: new Date().toISOString(),
    };
  });
  if (rows.length) {
    const { error: e2 } = await db.from('social_dm_messages').upsert(rows, { onConflict: 'remote_message_id', ignoreDuplicates: true });
    if (e2) throw new Error(`social_dm_messages upsert: ${e2.message}`);
  }
  return rows.length;
}

/* One account, everything. Never throws — the caller logs the outcome. */
export async function pullAccount(db: SupabaseClient, acc: Account, via: string, forceBackfill = false) {
  const { data: prior } = await db.from('social_inbox_pulls').select('id').eq('account_id', acc.account_id).eq('ok', true).limit(1);
  const backfill = forceBackfill || !(prior?.length);
  const counts: Record<string, unknown> = { backfill };
  let ok = true, err: string | null = null;
  try {
    if (acc.platform === 'instagram') {
      counts.comments = await pullInstagramComments(db, acc, backfill);
      // DMs: while the app has only Standard Access to instagram_manage_messages,
      // Meta times the conversations call out ("too many conversations with
      // users who do not have a role on app", subcode 2534084). Don't burn 40s
      // on every 10-minute run — back off for 6h after that error.
      const { data: lastDm } = await db.from('social_inbox_pulls').select('ran_at, counts')
        .eq('account_id', acc.account_id).order('id', { ascending: false }).limit(1);
      const lastErr = String((lastDm?.[0]?.counts as any)?.dms?.error ?? '');
      const backoff = /advanced access|do not have a role|2534084|Timeout/i.test(lastErr)
        && lastDm?.[0]?.ran_at && Date.now() - new Date(lastDm[0].ran_at).getTime() < 6 * 3600_000;
      if (backoff) counts.dms = { skipped: 'backoff after Meta timeout — instagram_manage_messages needs Advanced Access', last_error: lastErr };
      else {
        try { counts.dms = await pullInstagramDms(db, acc, backfill); }
        catch (e) { counts.dms = { error: scrub(String(e instanceof Error ? e.message : e)) }; }
      }
    } else {
      counts.comments = await pullFacebookComments(db, acc, backfill);
    }
  } catch (e) {
    ok = false; err = scrub(String(e instanceof Error ? e.message : e));
  }
  await db.from('social_inbox_pulls').insert({ account_id: acc.account_id, via, ok, counts, error: err });
  if (!ok) await db.from('social_accounts').update({ last_error: `inbox: ${err}` }).eq('id', acc.account_id);
  return { account: acc.handle, platform: acc.platform, ok, counts, error: err };
}
