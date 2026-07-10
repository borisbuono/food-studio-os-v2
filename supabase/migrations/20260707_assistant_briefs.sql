-- Assistant Layer Sprint 2 — daily briefs table.
-- One row per (entity, user, date). The morning brief lives here so Home can
-- render it without re-hitting the model on every page load.

create table if not exists assistant_briefs (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null check (entity_code in ('IFL','BM','BBH')),
  user_id uuid references auth.users(id) on delete cascade,
  date date not null,
  body text,
  created_at timestamptz not null default now()
);

create unique index if not exists assistant_briefs_entity_user_date_idx on assistant_briefs (entity_code, user_id, date);
create index if not exists assistant_briefs_user_recent_idx on assistant_briefs (user_id, date desc);

alter table assistant_briefs enable row level security;
create policy "assistant_briefs_own_select" on assistant_briefs for select to authenticated using (user_id = auth.uid() or user_id is null);
create policy "assistant_briefs_own_write"  on assistant_briefs for all    to authenticated using (user_id = auth.uid() or user_id is null) with check (user_id = auth.uid() or user_id is null);
