-- Applied live 2026-06-27. Captured here for repo provenance.
insert into storage.buckets (id, name, public)
values ('captures', 'captures', false)
on conflict (id) do nothing;

drop policy if exists "captures_authenticated_read" on storage.objects;
drop policy if exists "captures_authenticated_insert" on storage.objects;
create policy "captures_authenticated_read" on storage.objects
  for select to authenticated using (bucket_id = 'captures');
create policy "captures_authenticated_insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'captures');
