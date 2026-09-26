import { redirect } from "next/navigation";
import { houseNameForSlug } from "@/lib/houses";
import { getHouseBySlug } from "@/lib/houses.server";
import { supabaseServer } from "@/lib/supabaseServer";
import InboxList, { type InboxItem, type AccountChip, type SavedReply } from "./InboxList";

export const dynamic = "force-dynamic";

// /h/<slug>/office/inbox — Meta comments + DMs, one list, one tap per reply.
//
// Scope comes from the URL slug (middleware binds fs_entity on the way in;
// the page itself only trusts params.house → entities.id). Every read here
// is the cookie-bound client, so RLS decides what Boris sees.
//
// Spec: 06_PA/_INBOX/TO_OS_build_prompt_comments_dms_2026-09-23.md §4.

// The Inbox tab of /h/<slug>/comms (slim OS slice 4) — was /h/<slug>/office/inbox.
export default async function InboxPage({ params }: { params: { house: string } }) {
  const slug = params.house;
  const house = await getHouseBySlug(slug);
  if (!house) redirect("/studio");
  const entity_id = house.id;

  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) redirect(`/login?next=/h/${slug}/office/inbox`);

  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [accountsRes, commentsRes, dmsRes, savedRes, pullRes] = await Promise.all([
    sb.from("social_accounts_resolved").select("account_id, kind, handle, status").eq("entity_id", entity_id).eq("provider", "meta"),
    sb.from("social_comments")
      .select("id, account_id, platform, remote_comment_id, parent_remote_id, author_handle, author_name, text, lang, created_at_remote, status, flagged, flag_reason, draft_reply, draft_lang, reply_text, replied_at, error, media_permalink, media_thumbnail_url, media_caption")
      .eq("entity_id", entity_id).gte("created_at_remote", since)
      .order("created_at_remote", { ascending: false }).limit(300),
    sb.from("social_dm_messages")
      .select("id, thread_id, direction, text, lang, sent_at, status, flagged, flag_reason, draft_reply, draft_lang, reply_text, replied_at, error, social_dm_threads!inner(id, account_id, participant_handle, participant_name, last_inbound_at, status)")
      .eq("entity_id", entity_id).gte("sent_at", since)
      .order("sent_at", { ascending: false }).limit(400),
    sb.from("social_saved_replies").select("id, key, title, lang, body").eq("entity_id", entity_id).eq("active", true).order("sort"),
    sb.from("social_inbox_pulls").select("ran_at, ok").order("id", { ascending: false }).limit(1),
  ]);

  const accounts: AccountChip[] = (accountsRes.data ?? []).map((a: any) => ({
    id: a.account_id, handle: a.handle ?? (a.kind === "facebook_page" ? "Facebook" : "Instagram"),
    platform: a.kind === "facebook_page" ? "facebook" : "instagram", active: a.status === "active",
  }));
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const items: InboxItem[] = [];
  for (const c of (commentsRes.data ?? []) as any[]) {
    items.push({
      kind: "comment", id: c.id, account_id: c.account_id, platform: c.platform,
      account_handle: accountById.get(c.account_id)?.handle ?? null,
      who: c.author_handle ?? c.author_name ?? "someone", text: c.text ?? "", lang: c.lang,
      at: c.created_at_remote, status: c.status, flagged: !!c.flagged, flag_reason: c.flag_reason,
      draft: c.reply_text ?? c.draft_reply ?? "", draft_lang: c.draft_lang, replied_at: c.replied_at, error: c.error,
      media: { permalink: c.media_permalink, thumb: c.media_thumbnail_url, caption: c.media_caption },
      is_reply: !!c.parent_remote_id, history: null,
    });
  }
  // DMs: one row per inbound message that is not already answered; the
  // thread's recent history rides along so the row reads like a chat.
  const dmRows = (dmsRes.data ?? []) as any[];
  const byThread = new Map<string, any[]>();
  for (const m of dmRows) {
    const arr = byThread.get(m.thread_id) ?? [];
    arr.push(m); byThread.set(m.thread_id, arr);
  }
  for (const m of dmRows) {
    if (m.direction !== "in") continue;
    if (!["new", "drafted", "approved", "failed", "skipped", "replied"].includes(m.status)) continue;
    const t = m.social_dm_threads;
    const history = (byThread.get(m.thread_id) ?? [])
      .filter((x) => new Date(x.sent_at).getTime() <= new Date(m.sent_at).getTime())
      .slice(0, 6).reverse()
      .map((x) => ({ dir: x.direction as "in" | "out", text: x.text ?? "", at: x.sent_at }));
    items.push({
      kind: "dm", id: m.id, account_id: t?.account_id ?? "", platform: "instagram",
      account_handle: accountById.get(t?.account_id)?.handle ?? null,
      who: t?.participant_handle ?? t?.participant_name ?? "someone", text: m.text ?? "", lang: m.lang,
      at: m.sent_at, status: m.status, flagged: !!m.flagged, flag_reason: m.flag_reason,
      draft: m.reply_text ?? m.draft_reply ?? "", draft_lang: m.draft_lang, replied_at: m.replied_at, error: m.error,
      media: null, is_reply: false, history,
      window_from: t?.last_inbound_at ?? m.sent_at,
    });
  }
  items.sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime());

  const saved: SavedReply[] = (savedRes.data ?? []) as any[];
  const lastPull = pullRes.data?.[0]?.ran_at ?? null;
  const waiting = items.filter((i) => ["new", "drafted"].includes(i.status)).length;

  return (
    <main className="mx-auto max-w-3xl px-3 py-4 sm:px-6 sm:py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-black/10 pb-3">
        <div>
          <h2 className="font-serif text-2xl">
            Comments &amp; DMs
            {waiting ? <span className="ml-2 rounded-full bg-black px-2 py-0.5 align-middle font-mono text-xs text-white">{waiting}</span> : null}
          </h2>
          <p className="mt-1 text-xs text-clay">
            One tap sends. Nothing leaves without it.
            {lastPull ? <> · last pull {new Date(lastPull).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: house.timezone })}</> : null}
          </p>
        </div>
      </div>
      <InboxList slug={slug} items={items} accounts={accounts} saved={saved} />
    </main>
  );
}
