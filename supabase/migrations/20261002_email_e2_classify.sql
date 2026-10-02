-- Email channel — E2: classify + route.
--
-- 1. email_messages.headers: the three list/automation headers the classifier
--    reads (List-Unsubscribe, Precedence, Auto-Submitted).
-- 2. Insert/re-open trigger on email_threads: a thread at status 'new' asks
--    Vercel to classify it (pg_net, Vault secret). Fire-and-forget; the poll
--    sweeps anything still 'new' on its next pass. Same model as the Meta
--    inbox draft trigger. Nothing here can send.

alter table public.email_messages add column if not exists headers jsonb;

create or replace function public.email_thread_request_classify()
returns trigger language plpgsql security definer set search_path = public, vault, net as $$
declare
  v_secret text;
  v_url text := 'https://www.foodstudio.ai/api/email/classify';
begin
  if new.status <> 'new' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'new' then return new; end if;   -- only on the flip to 'new'
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'email_inbox_secret';
  if v_secret is null then return new; end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-inbox-secret', v_secret),
    body := jsonb_build_object('id', new.id),
    timeout_milliseconds := 90000);
  return new;
exception when others then
  return new;   -- classifying is best-effort; never block the insert
end $$;

drop trigger if exists trg_email_threads_classify on public.email_threads;
create trigger trg_email_threads_classify after insert or update of status on public.email_threads
  for each row execute function public.email_thread_request_classify();

comment on function public.email_thread_request_classify() is 'pg_net → POST /api/email/classify {id} when an email_threads row lands at / returns to status new.';
