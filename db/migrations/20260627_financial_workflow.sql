-- Financial workflow schema — 2026-06-27
-- Pattern: NEED → ORDER → SENT → RECEIVED → INVOICED → COSTED → POSTED → PAID
-- Each state can be filled in any order. Adapter-agnostic.

update orders set status = 'received' where status = 'delivered';

alter table orders
  add column if not exists entity_id text,
  add column if not exists sent_payload jsonb,
  add column if not exists holded_purchase_id text,
  add column if not exists expected_delivery date,
  add column if not exists ordered_at timestamptz default now();
do $$ begin
  if not exists (select 1 from pg_constraint where conname='orders_status_check') then
    alter table orders add constraint orders_status_check
      check (status in ('draft','sent','received','invoiced','closed','cancelled') or status is null);
  end if;
end $$;

alter table order_items
  add column if not exists ingredient_id uuid references inventory_items(id),
  add column if not exists expected_unit_price numeric,
  add column if not exists received_unit_price numeric,
  add column if not exists albaran_ref text;

create table if not exists albarans (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id),
  entity_id text,
  order_id uuid references orders(id),
  provider_id uuid references providers(id),
  received_at timestamptz not null default now(),
  received_by uuid,
  photo_url text,
  ocr_extracted jsonb,
  temperature_log jsonb,
  notes text,
  match_status text check (match_status in ('matched','unmatched','awaiting_invoice')) default 'unmatched',
  created_at timestamptz default now()
);

create table if not exists invoice_inbox (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id),
  entity_id text,
  provider_id uuid references providers(id),
  arrived_at timestamptz not null default now(),
  source text not null check (source in ('holded_scan','email_forward','whatsapp','manual_upload','paper_photo','portal')),
  source_ref text,
  doc_url text,
  ocr_extracted jsonb,
  holded_doc_id text,
  match_status text not null default 'unmatched'
    check (match_status in ('unmatched','matched_albaran','matched_order','approved','rejected','duplicate')),
  linked_albaran_id uuid references albarans(id),
  linked_order_id uuid references orders(id),
  flagged_reason text,
  amount_eur numeric,
  vat_eur numeric,
  notes text,
  triaged_by uuid,
  triaged_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists bank_movements (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null,
  bank_account text not null,
  movement_date date not null,
  amount_eur numeric not null,
  description text,
  holded_movement_id text,
  reconciled_to text check (reconciled_to in ('invoice','salesreceipt','asiento','intercompany','tax','tip','fee','unmatched')) default 'unmatched',
  reconciled_to_id text,
  reconciled_at timestamptz,
  reconciled_by uuid,
  notes text,
  created_at timestamptz default now()
);

-- RLS: authenticated read+write on all three new tables (lockdown phase already covers anon)
alter table albarans enable row level security;
alter table invoice_inbox enable row level security;
alter table bank_movements enable row level security;

create policy "Auth read albarans"        on albarans        for select to authenticated using (true);
create policy "Auth write albarans"       on albarans        for all    to authenticated using (true) with check (true);
create policy "Auth read invoice_inbox"   on invoice_inbox   for select to authenticated using (true);
create policy "Auth write invoice_inbox"  on invoice_inbox   for all    to authenticated using (true) with check (true);
create policy "Auth read bank_movements"  on bank_movements  for select to authenticated using (true);
create policy "Auth write bank_movements" on bank_movements  for all    to authenticated using (true) with check (true);

create index if not exists albarans_provider_idx       on albarans(provider_id, received_at desc);
create index if not exists albarans_order_idx          on albarans(order_id) where order_id is not null;
create index if not exists invoice_inbox_status_idx    on invoice_inbox(match_status, arrived_at desc);
create index if not exists invoice_inbox_provider_idx  on invoice_inbox(provider_id, arrived_at desc);
create index if not exists invoice_inbox_entity_idx    on invoice_inbox(entity_id, arrived_at desc);
create index if not exists bank_movements_entity_date_idx on bank_movements(entity_id, movement_date desc);
create index if not exists bank_movements_unmatched_idx   on bank_movements(reconciled_to) where reconciled_to = 'unmatched';
create unique index if not exists bank_movements_holded_uniq on bank_movements(holded_movement_id) where holded_movement_id is not null;

create or replace view v_orders_open as
  select o.*, p.name as provider_name, p.preferred_channel, r.name as restaurant_name
    from orders o
    left join providers p on p.id = o.provider_id
    left join restaurants r on r.id = o.restaurant_id
   where o.status in ('draft','sent','received','invoiced') or o.status is null;
