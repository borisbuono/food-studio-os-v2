-- Capture funnel (2026-09-26): paper → OS → (one tick) → Holded with PDF.
-- Additive only. Old values in the status checks stay valid.

-- BBH needs its CIF on the entity row so the addressee resolver can see it.
update public.entities set tax_id = 'B13655717'
 where slug = 'holdings' and tax_id is null;

-- ── invoice_inbox ───────────────────────────────────────────────────────
alter table public.invoice_inbox
  add column if not exists vat_bands           jsonb,        -- [{rate, base, cuota}]
  add column if not exists entity_source       text,         -- document_cif | document_name | session_guess
  add column if not exists addressee_vat_id    text,
  add column if not exists addressee_name      text,
  add column if not exists supplier_id         uuid references public.controller_suppliers(id),
  add column if not exists flags               text[] not null default '{}',
  add column if not exists conflict_values     jsonb,        -- other copies of the same doc number
  add column if not exists file_sha256         text,
  add column if not exists page_count          integer,
  add column if not exists holded_attachment_ref text,       -- Holded returns no attachment id; see lib/capture/holded.ts
  add column if not exists holded_pushed_at    timestamptz,
  add column if not exists holded_pushed_by    uuid,
  add column if not exists holded_push_log     jsonb;

alter table public.invoice_inbox drop constraint if exists invoice_inbox_match_status_check;
alter table public.invoice_inbox add constraint invoice_inbox_match_status_check
  check (match_status = any (array['unmatched','matched_albaran','matched_order','approved','rejected','duplicate',
                                   'needs_triage','conflicting_copies']));

create index if not exists invoice_inbox_sha_idx on public.invoice_inbox (file_sha256);
create index if not exists invoice_inbox_dedup_idx on public.invoice_inbox (supplier_vat_id, invoice_number);

-- ── albarans ────────────────────────────────────────────────────────────
alter table public.albarans
  add column if not exists supplier_id         uuid references public.controller_suppliers(id),
  add column if not exists supplier_name       text,
  add column if not exists supplier_vat_id     text,
  add column if not exists doc_number          text,
  add column if not exists document_date       date,
  add column if not exists subtotal_eur        numeric,
  add column if not exists vat_eur             numeric,
  add column if not exists grand_total_eur     numeric,
  add column if not exists vat_bands           jsonb,
  add column if not exists storage_path        text,
  add column if not exists entity_source       text,
  add column if not exists addressee_vat_id    text,
  add column if not exists flags               text[] not null default '{}',
  add column if not exists conflict_values     jsonb,
  add column if not exists file_sha256         text,
  add column if not exists extraction_confidence numeric,
  add column if not exists raw_ocr_text        text,
  add column if not exists linked_invoice_id   uuid references public.invoice_inbox(id) on delete set null,
  add column if not exists link_method         text;         -- referenced | subset | manual

alter table public.albarans drop constraint if exists albarans_match_status_check;
alter table public.albarans add constraint albarans_match_status_check
  check (match_status = any (array['matched','unmatched','awaiting_invoice','drop_in','needs_triage','conflicting_copies','rejected']));

create unique index if not exists albarans_storage_path_uniq on public.albarans (storage_path) where storage_path is not null;
create index if not exists albarans_sha_idx on public.albarans (file_sha256);
create index if not exists albarans_supplier_open_idx on public.albarans (supplier_id, entity_id) where linked_invoice_id is null;

-- ── purchase_lines ──────────────────────────────────────────────────────
alter table public.purchase_lines
  add column if not exists albaran_id uuid references public.albarans(id) on delete cascade,
  add column if not exists arithmetic_ok boolean;
create index if not exists purchase_lines_albaran_idx on public.purchase_lines (albaran_id);

-- second pass (applied as capture_funnel_triage_20260926): who cleared what, and why
alter table public.invoice_inbox add column if not exists triage_log jsonb;
alter table public.albarans      add column if not exists triage_log jsonb;
