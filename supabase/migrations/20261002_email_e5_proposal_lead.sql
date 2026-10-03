-- Email channel — E5: enquiry fields → the proposal funnel.
-- An email enquiry becomes a leads row the moment it is sorted (source
-- 'inbound-email'); the proposal page /m/<slug>/proposal?… completes the
-- same row (utm_content 'email:<ref>'). Additive only; no policy touched.
alter table public.email_threads add column if not exists lead_id uuid references public.leads(id) on delete set null;
create index if not exists email_threads_lead_idx on public.email_threads (lead_id) where lead_id is not null;
-- the proposal page finds the lead it completes by this key (one lead per thread)
create unique index if not exists leads_email_ref_uidx on public.leads (utm_content) where source = 'inbound-email' and utm_content like 'email:%';
comment on column public.email_threads.lead_id is 'E5: the leads row this enquiry opened (source inbound-email). Set by lib/email/funnel.ts; completed by /m/<slug>/proposal.';
