-- hiring SOP layer: parsed CV profile, screening score, drafted question sets, private CV bucket.
alter table public.candidates
  add column if not exists profile jsonb not null default '{}'::jsonb,   -- {field: {value, confidence 0..1}}
  add column if not exists summary text,
  add column if not exists location text,
  add column if not exists availability text,
  add column if not exists review_flags text[] not null default '{}',
  add column if not exists score int,                                     -- 0..100, rules-based, see lib/hiring-sop.ts
  add column if not exists score_reasons jsonb not null default '[]'::jsonb,
  add column if not exists cv_path text,                                  -- hiring-cvs/<entity_id>/<candidate_id>.pdf
  add column if not exists parsed_at timestamptz,
  add column if not exists retain_until date;                             -- GDPR: purge unsuccessful CVs after this

alter table public.candidate_touches
  add column if not exists kind text,          -- 'question_set' | 'reply' | null (plain log)
  add column if not exists status text,        -- 'drafted' | 'sent' | null
  add column if not exists subject text,
  add column if not exists body text,
  add column if not exists body_alt text,      -- second language version
  add column if not exists language text;

-- private bucket, path = <entity_id>/<file>
-- CASE guards the uuid cast: storage policies are evaluated against every bucket's rows.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hiring-cvs', 'hiring-cvs', false, 10485760,
        array['application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword'])
on conflict (id) do nothing;

drop policy if exists hiring_cvs_member_read on storage.objects;
create policy hiring_cvs_member_read on storage.objects for select to authenticated
  using (bucket_id = 'hiring-cvs'
         and public.fn_is_entity_member(auth.uid(), case when bucket_id = 'hiring-cvs' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then ((storage.foldername(name))[1])::uuid end));
drop policy if exists hiring_cvs_member_insert on storage.objects;
create policy hiring_cvs_member_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'hiring-cvs'
         and public.fn_is_entity_member(auth.uid(), case when bucket_id = 'hiring-cvs' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then ((storage.foldername(name))[1])::uuid end));
drop policy if exists hiring_cvs_manager_delete on storage.objects;
create policy hiring_cvs_manager_delete on storage.objects for delete to authenticated
  using (bucket_id = 'hiring-cvs'
         and public.fn_is_entity_manager(auth.uid(), case when bucket_id = 'hiring-cvs' and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then ((storage.foldername(name))[1])::uuid end));
