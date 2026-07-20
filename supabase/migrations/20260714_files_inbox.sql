-- Files INBOX — triage front-end sitting *ahead* of files_documents.
--
-- Companion to 20260714_files_module.sql. Where files_documents is the
-- resting library (only rows Boris has confirmed), files_inbox is the
-- staging conveyor belt: raw attachments arrive here from the admin@
-- mailboxes (Gmail auto-ingest), WhatsApp, the Chef FAB camera, or
-- manual drops. Anthropic vision classifies them (category / entity /
-- title / valid_until) and they wait as `needs_triage` for a human
-- confirmation before being promoted into files_documents.
--
-- Status ladder:
--   pending_classify  → just landed, classifier hasn't run yet
--   classified        → classifier finished (transient — moves to needs_triage
--                       almost immediately; kept as a separate state so we
--                       can distinguish "vision failed" from "vision succeeded
--                       but no human has seen it")
--   needs_triage      → the queue Boris sees at /files/inbox
--   filed             → promoted → files_documents row created
--   rejected          → user said "not a document" (spam attachment, footer
--                       logo, wine list from a personal thread, etc.)
--
-- We never delete an inbox row. Rejected rows stay for audit (someone might
-- want to know why a supplier statement never got filed).

-- Storage bucket note (must be created manually via SQL editor as service_role):
--
--   insert into storage.buckets (id, name, public)
--   values ('documents-inbox', 'documents-inbox', false)
--   on conflict (id) do nothing;
--
--   drop policy if exists "documents_inbox_authenticated_read"   on storage.objects;
--   drop policy if exists "documents_inbox_authenticated_insert" on storage.objects;
--   drop policy if exists "documents_inbox_authenticated_update" on storage.objects;
--   drop policy if exists "documents_inbox_authenticated_delete" on storage.objects;
--   create policy "documents_inbox_authenticated_read"   on storage.objects
--     for select to authenticated using (bucket_id = 'documents-inbox');
--   create policy "documents_inbox_authenticated_insert" on storage.objects
--     for insert to authenticated with check (bucket_id = 'documents-inbox');
--   create policy "documents_inbox_authenticated_update" on storage.objects
--     for update to authenticated using (bucket_id = 'documents-inbox');
--   create policy "documents_inbox_authenticated_delete" on storage.objects
--     for delete to authenticated using (bucket_id = 'documents-inbox');
--
-- Layout inside the bucket:
--   documents-inbox/<yyyy-mm-dd>/<inbox_id>_<sanitised-filename>.<ext>
-- (Once filed, the approve step COPIES the binary to
--  `documents/<entity>/<category>/…` in the sister bucket so the library
--  layout stays clean; the inbox object is kept for provenance.)

create table if not exists public.files_inbox (
  id uuid primary key default gen_random_uuid(),

  -- ---- provenance -------------------------------------------------------
  source text not null check (source in (
    'gmail_admin_bm',
    'gmail_admin_ifl',
    'gmail_admin_bbh',
    'whatsapp',
    'chef_fab_upload',
    'manual'
  )),
  source_ref text,                         -- gmail message id / whatsapp msg id / null
  sender text,                             -- rfc-2822 From header, or WhatsApp phone
  received_at timestamptz not null default now(),
  subject text,                            -- gmail Subject, or null

  -- ---- payload ----------------------------------------------------------
  file_url text not null,                  -- storage path inside `documents-inbox`
  file_bytes bigint,
  mime_type text,
  thumbnail_url text,                      -- optional preview (data-url ok for small imgs)

  -- ---- vision output ----------------------------------------------------
  suggested_category text
    check (suggested_category is null or suggested_category in (
      'contract','statement','modelo','haccp','insurance',
      'certification','menu_pdf','photo','other'
    )),
  suggested_entity text
    check (suggested_entity is null or suggested_entity in ('IFL','BM','BBH')),
  suggested_title text,
  suggested_valid_until date,
  classification_confidence numeric(4,3)   -- 0.000 .. 1.000
    check (classification_confidence is null or (classification_confidence >= 0 and classification_confidence <= 1)),
  classification_rationale text,

  -- ---- state machine ----------------------------------------------------
  status text not null default 'pending_classify'
    check (status in ('pending_classify','classified','needs_triage','filed','rejected')),
  filed_document_id uuid references public.files_documents(id) on delete set null,

  -- ---- audit ------------------------------------------------------------
  created_at timestamptz not null default now(),
  triaged_at timestamptz,
  triaged_by uuid references auth.users(id) on delete set null
);

-- Perf — the triage list groups by status, filters by entity. The (status,
-- received_at) index serves the "needs_triage newest-first" query cheaply.
create index if not exists files_inbox_status_idx
  on public.files_inbox(status, received_at desc);
create index if not exists files_inbox_entity_status_idx
  on public.files_inbox(suggested_entity, status, received_at desc);
create index if not exists files_inbox_source_ref_idx
  on public.files_inbox(source, source_ref)
  where source_ref is not null;

alter table public.files_inbox enable row level security;

-- RLS policy: an authenticated user can read + write inbox rows. The finer
-- entity boundary is enforced at the app layer via serverEntity() (same
-- pattern as files_documents). If a hard RLS boundary is needed later, add
-- a user_entity() helper and predicate on suggested_entity.
do $$ begin
  create policy files_inbox_auth_read on public.files_inbox
    for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy files_inbox_auth_write on public.files_inbox
    for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy files_inbox_service_all on public.files_inbox
    for all to service_role using (true) with check (true);
exception when duplicate_object then null; end $$;

comment on table public.files_inbox is
  'Files INBOX — triage staging queue. Auto-ingested attachments (admin@ Gmail, WhatsApp, Chef FAB) land here, get Anthropic-vision-classified, wait for Boris to confirm, then get promoted to files_documents. Never auto-files; every row is triaged.';
comment on column public.files_inbox.status is
  'State machine: pending_classify -> classified -> needs_triage -> filed | rejected. Terminal states are filed / rejected.';
comment on column public.files_inbox.classification_confidence is
  'Anthropic vision confidence 0..1. UI badges green >=0.85 / amber 0.65-0.85 / red <0.65.';
comment on column public.files_inbox.filed_document_id is
  'Set once status=filed. FK -> files_documents. Lets us trace an inbox row back to its published library row.';
