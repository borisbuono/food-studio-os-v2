-- Pillars #4 — Files module.
--
-- A universal document store that sits above the three pillars (visible via
-- a small icon on the top nav). Anything that a manager, gestoría, or
-- auditor might need to reference in the future: HACCP records, contracts,
-- brand assets, gestoría exports, bank statements, insurance certificates,
-- certifications, historical menu PDFs.
--
-- Design:
--   * files_documents — one row per file. Entity-scoped via RLS so BM /
--     IFL / BBH stay isolated from each other, but visible across pillars
--     (the file's category tags it, not the pillar).
--   * A file's binary lives in Supabase Storage bucket `documents` (which
--     must be created manually — see the storage-bucket note at the bottom
--     of this migration, since bucket-creation is an Admin API operation).
--   * category is a controlled vocabulary (not FK) so we can add new
--     categories without a migration.
--   * valid_until (nullable) lets the UI amber-badge expiring certs
--     (insurance, food handler cards, contracts approaching renewal).
--   * archived_at (nullable) → soft-delete pattern used elsewhere in the OS.
--   * uploaded_by is a plain uuid (nullable, no FK) since profiles is
--     currently loose-typed elsewhere in this repo.

create table if not exists public.files_documents (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null check (entity_code in ('IFL','BM','BBH')),
  category text not null default 'other'
    check (category in (
      'haccp','contract','brand','gestoria','statement',
      'legal','insurance','certification','menu_pdf','other'
    )),
  title text not null,
  description text,
  -- Storage path — full "bucket/path/to/file.pdf" including bucket prefix
  -- so the UI can call `supabase.storage.from(bucket).download(path)`.
  file_url text not null,
  file_bytes bigint,
  mime_type text,
  tags text[] not null default array[]::text[],
  uploaded_by uuid,
  uploaded_at timestamptz not null default now(),
  -- Expiring documents (insurance, food handler cards, contracts) — the UI
  -- amber-badges when we're within 30d of this.
  valid_until date,
  archived_at timestamptz
);

create index if not exists files_documents_entity_idx
  on public.files_documents(entity_code, uploaded_at desc);
create index if not exists files_documents_category_idx
  on public.files_documents(entity_code, category, uploaded_at desc);
create index if not exists files_documents_valid_until_idx
  on public.files_documents(valid_until) where valid_until is not null and archived_at is null;
create index if not exists files_documents_tags_gin
  on public.files_documents using gin(tags);

alter table public.files_documents enable row level security;

-- Authenticated users can read + write; entity isolation is enforced at the
-- application layer via the fs_entity cookie (same pattern as the finance
-- tables). If a hard RLS boundary is needed later, add a `user_entity`
-- helper and predicate on `entity_code = user_entity(auth.uid())`.
do $$ begin
  create policy files_documents_auth_read on public.files_documents
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy files_documents_auth_write on public.files_documents
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy files_documents_service_all on public.files_documents
    for all to service_role using (true) with check (true);
exception when duplicate_object then null; end $$;

comment on table public.files_documents is
  'Files module — universal document store (HACCP, contracts, brand, gestoría, statements, insurance, certifications, menu PDFs). Entity-scoped, category-tagged, tag-searchable. Binary lives in storage bucket `documents`.';
comment on column public.files_documents.file_url is
  'Storage path inside the `documents` bucket (e.g. `IFL/haccp/2026-05-fridge-log.pdf`). Read with supabase.storage.from(''documents'').download(path).';
comment on column public.files_documents.valid_until is
  'Expiry date for expiring documents (insurance, food handler cards, contracts). UI amber-badges when within 30d.';

-- =========================================================================
-- STORAGE BUCKET SETUP
-- =========================================================================
--
-- The `documents` bucket must be created manually via the Supabase Admin API
-- or Dashboard because bucket creation from a migration requires elevated
-- privileges that the migration runner does not have in Vercel deploys.
--
-- One-shot setup (run once via SQL editor as service_role):
--
--   insert into storage.buckets (id, name, public)
--   values ('documents', 'documents', false)
--   on conflict (id) do nothing;
--
--   drop policy if exists "documents_authenticated_read" on storage.objects;
--   drop policy if exists "documents_authenticated_insert" on storage.objects;
--   drop policy if exists "documents_authenticated_update" on storage.objects;
--   drop policy if exists "documents_authenticated_delete" on storage.objects;
--   create policy "documents_authenticated_read"   on storage.objects
--     for select to authenticated using (bucket_id = 'documents');
--   create policy "documents_authenticated_insert" on storage.objects
--     for insert to authenticated with check (bucket_id = 'documents');
--   create policy "documents_authenticated_update" on storage.objects
--     for update to authenticated using (bucket_id = 'documents');
--   create policy "documents_authenticated_delete" on storage.objects
--     for delete to authenticated using (bucket_id = 'documents');
--
-- Objects inside the bucket should be laid out as:
--   documents/<entity_code>/<category>/<yyyy-mm-dd>_<short-title>.<ext>
-- so a filesystem-style browse is possible via the Supabase Dashboard.
