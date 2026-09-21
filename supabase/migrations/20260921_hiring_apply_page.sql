-- public application page (/apply/<slug>): rate-limit key, consent stamp, self-declared answers.
alter table public.candidates
  add column if not exists ip_hash text,
  add column if not exists consent_at timestamptz,
  add column if not exists answers jsonb;
create index if not exists idx_candidates_ip_hash_recent on public.candidates (ip_hash, created_at desc) where ip_hash is not null;
