-- Email channel — E4: the send gate. Brief: build_brief_email_channel_2026-10-02.
--
-- approved_by_boris on email_threads is written in ONE place: email_reply_claim(),
-- a service-role-only definer RPC called ONLY by the edge function email-reply,
-- and only after the chef_confirm_tokens row behind the tap / spoken yes has
-- been CONSUMED (used_at set by /api/chef/act or the inbox page tick) for THIS
-- user, THIS action hash (thread id + reply text) within the last 10 minutes.
-- No TS code path writes approved_by_boris. Nothing sends outside email-reply.
--
-- Additive only. No policy on any existing table is touched (sec/hardening owns policies).

-- one consumed token approves one thread, ever
create unique index if not exists email_threads_confirm_token_uidx
  on public.email_threads (approved_confirm_token) where approved_confirm_token is not null;

create or replace function public.email_reply_claim(
  p_thread uuid, p_token uuid, p_user uuid, p_action_hash text, p_text text, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := current_setting('request.jwt.claim.role', true);
  t record; k record; v_other uuid; v_text text := nullif(btrim(coalesce(p_text, '')), '');
begin
  if coalesce(v_role, current_user) not in ('service_role','postgres') then
    raise exception 'email_reply_claim: forbidden' using errcode = '42501';
  end if;
  select id, entity_id, account_id, gmail_thread_id, subject, from_address, from_name, draft_lang, first_received_at, status, approved_confirm_token
    into t from public.email_threads where id = p_thread;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if t.status = 'replied' then return jsonb_build_object('ok', false, 'reason', 'already_replied'); end if;
  if v_text is null then return jsonb_build_object('ok', false, 'reason', 'empty_reply'); end if;
  if p_token is null or p_user is null then return jsonb_build_object('ok', false, 'reason', 'missing'); end if;

  -- THE GATE: a consumed one-shot token for this user and this exact action.
  select token, user_id, action_type, action_hash, used_at, used_via, expires_at into k
    from public.chef_confirm_tokens where token = p_token;
  if k.token is null or k.user_id is distinct from p_user then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if k.used_at is null then return jsonb_build_object('ok', false, 'reason', 'not_consumed'); end if;
  if k.action_type <> 'approve_email' or k.action_hash is distinct from p_action_hash then return jsonb_build_object('ok', false, 'reason', 'mismatch'); end if;
  if k.used_at < now() - interval '10 minutes' then return jsonb_build_object('ok', false, 'reason', 'stale'); end if;
  select id into v_other from public.email_threads where approved_confirm_token = p_token and id <> p_thread limit 1;
  if v_other is not null then return jsonb_build_object('ok', false, 'reason', 'used'); end if;
  if not coalesce(public.fn_is_entity_manager(p_user, t.entity_id), false) then return jsonb_build_object('ok', false, 'reason', 'not_manager'); end if;

  if not p_dry_run then
    update public.email_threads
       set approved_by_boris = true, approved_at = now(), approved_by_user = p_user, approved_confirm_token = p_token,
           reply_text = v_text, status = 'approved', error = null
     where id = p_thread;
  end if;
  return jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'via', k.used_via,
    'thread', jsonb_build_object('id', t.id, 'entity_id', t.entity_id, 'account_id', t.account_id, 'gmail_thread_id', t.gmail_thread_id,
      'subject', t.subject, 'from_address', t.from_address, 'from_name', t.from_name, 'draft_lang', t.draft_lang, 'first_received_at', t.first_received_at));
end $$;
revoke all on function public.email_reply_claim(uuid,uuid,uuid,text,text,boolean) from public, anon, authenticated;

-- After Gmail accepted the message: the thread is replied (hours_to_answer
-- fills itself), the sent mail is thread history (direction out), and the
-- reply Boris approved becomes a voice example for the drafter.
create or replace function public.email_reply_record_sent(
  p_thread uuid, p_gmail_message_id text, p_message_id_header text, p_to text[], p_prompt_text text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role text := current_setting('request.jwt.claim.role', true);
  t record; a record; v_now timestamptz := now(); v_hours numeric;
begin
  if coalesce(v_role, current_user) not in ('service_role','postgres') then
    raise exception 'email_reply_record_sent: forbidden' using errcode = '42501';
  end if;
  select * into t from public.email_threads where id = p_thread;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not t.approved_by_boris then return jsonb_build_object('ok', false, 'reason', 'not_approved'); end if;
  select address, display_name into a from public.email_accounts where id = t.account_id;

  update public.email_threads
     set status = 'replied', replied_at = v_now, reply_gmail_message_id = p_gmail_message_id, error = null,
         message_count = message_count + 1, labels = array_remove(labels, 'UNREAD')
   where id = p_thread;

  insert into public.email_messages (thread_id, entity_id, account_id, gmail_message_id, direction, from_address, from_name,
                                     to_addresses, subject, snippet, body_text, received_at, labels, message_id_header, in_reply_to, references_header)
  values (t.id, t.entity_id, t.account_id, p_gmail_message_id, 'out', a.address, a.display_name,
          coalesce(p_to, '{}'), t.subject, left(t.reply_text, 200), t.reply_text, v_now, array['SENT'], p_message_id_header, null, null)
  on conflict (gmail_message_id) do nothing;

  insert into public.brand_voice_examples (entity_id, kind, lang, prompt_text, text, source)
  values (t.entity_id, 'approved_reply', t.draft_lang, left(p_prompt_text, 2000), t.reply_text, 'email');

  select hours_to_answer into v_hours from public.email_threads where id = p_thread;
  return jsonb_build_object('ok', true, 'replied_at', v_now, 'hours_to_answer', v_hours);
end $$;
revoke all on function public.email_reply_record_sent(uuid,text,text,text[],text) from public, anon, authenticated;

comment on function public.email_reply_claim is 'E4 gate. The ONLY writer of email_threads.approved_by_boris. Service role only; called by edge function email-reply after a consumed chef_confirm_tokens row (approve_email) for this user + action hash, <10 min old, not reused.';
