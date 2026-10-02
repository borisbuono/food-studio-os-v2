import { redirect } from "next/navigation";
import { getHouseBySlug } from "@/lib/houses.server";
import { supabaseServer } from "@/lib/supabaseServer";
import MailboxList, { type MailboxRow } from "./MailboxList";

export const dynamic = "force-dynamic";

// The Mail tab of /h/<slug>/comms — connected mailboxes for THIS house.
// Connect = two taps (button → Google consent → back here). Rows, never
// secrets: the tokens sit in Vault behind email_account_* RPCs; this page reads
// the health view through the cookie-bound client, so RLS (manager-only on
// email_accounts) decides who sees what. "Not connected" is a clean state,
// not an error.
export default async function Mailboxes({ params, notice }: { params: { house: string }; notice?: string | null }) {
  const slug = params.house;
  const house = await getHouseBySlug(slug);
  if (!house) redirect("/studio");
  const sb = supabaseServer();
  const { data: u } = await sb.auth.getUser();
  if (!u.user?.id) redirect(`/login?next=/h/${slug}/comms?tab=mail`);

  const [{ data: rows }, { data: mgr }] = await Promise.all([
    sb.from("email_connection_health").select("account_id, address, status, forwards_to_holded, connected_at, last_pull_at, last_error, consecutive_failures, waiting, last_ok_pull").eq("entity_id", house.id).order("connected_at"),
    sb.rpc("fn_is_entity_manager", { uid: u.user.id, ent: house.id }),
  ]);
  const list: MailboxRow[] = ((rows || []) as any[]).map((r) => ({
    id: r.account_id, address: r.address, status: r.status, forwards_to_holded: !!r.forwards_to_holded,
    connected_at: r.connected_at, last_pull_at: r.last_pull_at, last_error: r.last_error, waiting: Number(r.waiting || 0),
  }));
  const configured = !!process.env.GOOGLE_OAUTH_CLIENT_ID;

  return (
    <main className="mx-auto max-w-3xl px-3 py-4 sm:px-6 sm:py-6">
      <div className="border-b border-black/10 pb-3">
        <h2 className="font-serif text-2xl">Mailboxes</h2>
        <p className="mt-1 text-xs text-clay">
          The OS reads the connected mailboxes every 10 minutes, sorts what came in, and drafts replies. Nothing is sent without your tap.
        </p>
      </div>
      <MailboxList slug={slug} rows={list} canManage={mgr === true} configured={configured} notice={notice ?? null} />
    </main>
  );
}
