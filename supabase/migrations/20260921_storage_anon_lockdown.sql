-- 20260921_storage_anon_lockdown.sql
--
-- Storage still carried the anon policies behind the August incident (six
-- photos uploaded to `captures` while signed out, with no DB row). The read
-- side was worse than the write: `captures_any_read` let anyone holding the
-- public anon key read every photographed invoice and delivery note in the
-- bucket, and `documents_any_insert` let anyone drop a file into the finance
-- inbox.
--
-- All three become authenticated-only. `recipe-images` and `social-media`
-- stay publicly readable — those are the guest-facing buckets (/m, socials).

drop policy if exists captures_any_insert on storage.objects;
drop policy if exists captures_any_read on storage.objects;
drop policy if exists documents_any_insert on storage.objects;

create policy captures_auth_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'captures');

create policy captures_auth_read on storage.objects
  for select to authenticated
  using (bucket_id = 'captures');

create policy documents_auth_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = any (array['documents','documents-inbox']));
