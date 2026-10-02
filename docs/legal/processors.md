# Processors (encargados y subencargados) — 2026-10-02

Who touches personal data on our behalf, for what, where, and whether the data-processing agreement (DPA) is on file. **Boris keeps the signed/accepted DPAs**; this list is the index the privacy notice points at. Update it when a provider is added or dropped, and update `PROCESSORS` in `lib/legal/privacyNotice.ts` in the same commit.

| provider | what they process | data | where | transfer basis | DPA |
|---|---|---|---|---|---|
| Supabase Inc. | database, auth, storage, edge functions | everything | eu-west-1 (Ireland) | EU | accept in dashboard (Supabase DPA) — **Boris: confirm** |
| Vercel Inc. | app hosting, serverless functions, logs | request logs (IP, path), rendered pages | EU/US edge | SCC / DPF | accept in dashboard — **Boris: confirm** |
| Anthropic PBC | LLM: CV parsing, email classification/drafting, Chef intents, synthesis | CV text, email bodies, assistant requests | US | SCC / DPF; zero-retention API; no training | commercial terms include DPA — **Boris: confirm** |
| OpenAI (Whisper) / Deepgram | voice transcription for Chef | audio → text | US | SCC / DPF | OpenAI DPA online; Deepgram on request — **Boris** |
| Google LLC (Workspace, OAuth, Calendar, Drive) | sign-in, team mail, calendar sync, Drive files | staff emails, calendar events, documents | EU/US | SCC / DPF | Workspace DPA (accepted with Workspace) |
| Resend | transactional email | recipient address, invite/confirmation content | US | SCC / DPF | on request — **Boris** |
| Meta Platforms Ireland | Instagram/Facebook messages the house answers | guest messages | EU/US | Meta terms | platform terms (Meta is independent controller for its side) |
| Fresto | POS | tickets, bookings, guest names on bookings | EU | EU | contract with the house |
| Holded | accounting, invoicing, payroll | invoices, payroll data | EU (Spain) | EU | Holded terms (DPA included) |
| GitHub (Microsoft) | source code | no personal data by policy (repo public — no secrets, no data) | US | — | n/a |

Not processors: the AEAT, banks, Seguridad Social — independent controllers we are obliged to report to.
