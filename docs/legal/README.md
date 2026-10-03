# RGPD pack — what exists, where, how to run it

Written 2026-10-02 (security hardening, slice S6). Spanish law: RGPD (EU 2016/679) + LOPDGDD 3/2018.

## Roles

- **Each house** (Bistro Mondo Ibiza SL, Ibiza Food Lab SL, a client's company) is the **controller** of its guests', candidates' and staff's data.
- **Food Studio OS** (Boris Buono Holding SL / Ibiza Food Studio) is the **processor** that runs the platform for them, and the **controller** for the platform accounts themselves (the people who sign in).
- Everyone below us is a **sub-processor** — see `processors.md`.

## The pieces

| piece | where | what |
|---|---|---|
| Privacy notice (ES/EN) | `/legal/privacy[?house=<slug>&lang=es|en]` — text in `lib/legal/privacyNotice.ts`, copy in `privacy-notice.md` | Controller block per house (read server-side, `privacy_page_controller()`), purposes, processors, retention, rights, security. Linked from `/apply/<house>`, `/book/<slug>`, `/m/<slug>/book`, `/m/<slug>/private`, the `/onboard` wizard. |
| Processor list | `processors.md` | Who, what for, where, DPA status (Boris keeps the signed DPAs). |
| Retention jobs | `fn_retention_candidates()`, `fn_retention_guests()`, `fn_retention_chef_turns()`, `fn_retention_sweep()`; edge function `retention-sweep`; pg_cron `retention-sweep-daily` 04:20 UTC; log `data_retention_log` | Candidates not hired → anonymised when `retain_until` passes (6 months for new applicants); guests → anonymised 3 years after the last visit/booking; Chef transcripts → scrubbed after 90 days. CV files removed from `hiring-cvs`. |
| Clean exit / portability | `export_tenant_rows(entity)`; edge function `tenant-export`; bucket `exports` (private); log `tenant_exports` | One zip per export: README, manifest, one JSON per table. 39 tables / 954 rows / 78 KB for Utopia on 2026-10-02. |
| Backups | `../systems/backup.md` | Weekly, 8 copies — an erased record leaves the copies within 8 weeks. The notice says so. |

## Retention — the numbers (must match `RETENTION` in `lib/legal/privacyNotice.ts`)

| data | period | job | what remains |
|---|---|---|---|
| Candidates not hired | 6 months from application (`candidates.retain_until`; rows promised 12 months before 2026-10-02 keep their date) | `fn_retention_candidates` | row with status history and scores for funnel statistics; name = "Candidato anonimizado"; interviews' and touches' free text cleared; CV file deleted |
| Guests | 3 years after last visit or booking | `fn_retention_guests` | bookings/visits keep date, covers, spend; name "Anonimizado"; feedback body cleared; newsletter opt-ins deleted, opt-outs kept with a hashed address |
| Chef voice/text turns | 90 days | `fn_retention_chef_turns` | latency, cost, outcome, intent class; `transcript` and `result` null |
| Invoices, tickets, payroll | 6 years (Código de Comercio art. 30; LGT art. 66) | none — never anonymised | everything |
| Leads (public enquiry form) | **not yet** — proposal: 2 years from last touch | follow-up | — |
| Email (`email_*`, comms lane) | **not yet** — the comms lane decides; proposal: 3 years like guests | follow-up | — |

## Run things by hand (SQL editor)

```sql
-- the retention sweep, exactly as the cron runs it
select net.http_post(
  url := 'https://rfdsysrdoncyoytcrzpg.supabase.co/functions/v1/retention-sweep',
  headers := jsonb_build_object('Content-Type','application/json',
    'x-scheduler-secret', (select decrypted_secret from vault.decrypted_secrets where name='rgpd_secret')),
  body := '{"via":"manual"}'::jsonb, timeout_milliseconds := 120000);

-- a tenant export (slug or entity_id); the response carries a 24-hour signed URL
select net.http_post(
  url := 'https://rfdsysrdoncyoytcrzpg.supabase.co/functions/v1/tenant-export',
  headers := jsonb_build_object('Content-Type','application/json',
    'x-scheduler-secret', (select decrypted_secret from vault.decrypted_secrets where name='rgpd_secret')),
  body := '{"slug":"utopia"}'::jsonb, timeout_milliseconds := 120000);

-- read the answers
select id, status_code, content::text from net._http_response order by id desc limit 2;
select * from data_retention_log order by ran_at desc limit 10;
select * from tenant_exports order by created_at desc limit 5;
```

## A data-subject request (access / erasure / portability) — the procedure

1. It arrives at the house's mailbox (`hola@…`) or at `hola@ibzfoodstudio.com`. Reply within **one month** (RGPD art. 12.3).
2. Identify the person: email they wrote from must match the record (guests.email, candidates.email, team_members.email / person_auth_link.email).
3. **Access / portability**: `select to_jsonb(g) from guests g where lower(email)=lower('…')` (+ bookings, guest_visits, guest_feedback by guest_id; or candidates + interviews + candidate_touches; or team_members + memberships + labor_shifts + rota_shifts). Send as JSON or a readable summary.
4. **Erasure**: guests → run the same statements `fn_retention_guests` runs, for that id (anonymise, do not delete — bookings and accounting need the row). Candidates → `update candidates set retain_until = current_date - 1 where id = …` and run the sweep. Staff → **not erasable** while employment-law retention runs (payroll 4 years, contracts 6); anonymise contact fields only after that.
5. Log the request and the answer in the register: `select register_write('BM','correction','RGPD request from <email>: <what>, answered <date>', null, 'pa');`.

## Breach

72 hours to the AEPD (art. 33) if there is a risk to people. Sequence: contain (rotate the secret in Vault, revoke the key, disable the account) → `docs/systems/release.md` rollback if code → assess scope with `backup_runs`/`audit_log` → notify AEPD at sedeagpd.gob.es → notify the people if high risk → write it up in `06_PA/_INBOX/`.

## Rollback of the slice

`supabase/migrations/20261002_security_s6_rgpd_ROLLBACK.sql` — unschedules the cron, drops the functions and the two log tables. Anonymised rows stay anonymised (that is the point). The buckets, the Vault secret and the edge functions are kept; delete by hand if wanted.
