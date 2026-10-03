# Google OAuth — one client per house

Written 2026-10-03 (Boris's ruling: credentials are per entity). Read this before touching
`/api/email/connect`, `lib/email/accounts.ts`, `lib/google/oauthClient.ts`, the edge function
`email-reply`, or anything in Google Cloud Console.

## Where we are today: Internal, one client per Workspace

The OS reads and answers Gmail for two Google Workspaces: **ibzfoodstudio.com** (Taller /
Holdings — `info@`, `boris@`) and **bistro-mondo.com** (Bistro Mondo — `info@`, `admin@`).

Google offers two audiences for an OAuth app:

| Audience | What it means for us | Verdict (03-10-2026) |
|---|---|---|
| **Internal** | Only users of the app's own Workspace can consent. No Google verification, no CASA audit, refresh tokens do not expire. **One GCP project + one client per Workspace.** | **Chosen.** |
| External, *Testing* | Any listed test user can consent, but refresh tokens expire after **7 days**. Mailboxes would need reconnecting weekly. | Rejected. |
| External, *In production* | Anyone can consent. The Gmail scopes we need (`gmail.readonly`, `gmail.send`, `gmail.modify`) are **restricted**, so Google requires brand verification plus an annual **CASA Tier 2** security assessment (third-party lab, weeks, money). | Rejected for now; see "Selling the module". |

Internal means the code cannot hold a single `GOOGLE_OAUTH_CLIENT_ID / _SECRET` pair: the
ibzfoodstudio client refuses a bistro-mondo.com user and vice versa. So the pair became a **row
per entity**.

## Shape

```
entities ──< oauth_clients (entity_id, provider 'google', client_id, secret_vault_id, hosted_domain, status)
                 │  secret lives in Supabase Vault; the row holds only its id
                 └─ fn_oauth_client_for(entity_id, provider)   SECURITY DEFINER, service_role only
email_accounts.oauth_client_id   = the client_id that minted this mailbox's refresh token
```

- **Write path:** a *manager of the house* pastes client ID + secret on **Comms › Mail → "Google
  client for this house"** → `POST /api/email/google-client` → RPC `oauth_client_set` (checks
  `app_my_managed_entities()` itself, writes the secret to Vault). *Replace* overwrites in place;
  *Disable* flips `status` and deletes the Vault secret. Nothing is typed by automation.
- **Read path (secret):** only `fn_oauth_client_for`, called with the service-role client from
  `lib/google/oauthClient.ts → googleClientFor()`. Two callers: the connect route + callback, and
  the token-refresh path (`lib/email/accounts.ts → accessTokenFor`, and the edge function
  `email-reply` as a last resort). No view, no column grant, no RPC exposes the secret to
  `authenticated`.
- **Read path (UI):** `oauth_clients` is selectable by managers of the entity on the safe columns
  only (`secret_vault_id` has no grant). The card shows the id prefix, the hosted domain and
  "set on <date>".
- **Env fallback:** `googleClientFor(…, { allowEnv })`. `true` on the refresh path for mailboxes
  minted before this change (`oauth_client_id is null`) and for the calendar connector, which
  still reads the env pair directly; `false` on the email connect path — the env client is the
  Supabase *sign-in* app and must never be sent to Gmail consent.
- **Client replaced after connect:** a refresh token is bound to the client that issued it. If
  the house's `client_id` no longer matches `email_accounts.oauth_client_id`, the refresh throws
  `client_changed` and the row goes to `needs_reconnect` with a plain message, instead of Google
  answering `invalid_client`.
- **`hd`:** when the row has a `hosted_domain`, the consent URL carries `hd=<domain>` so Google's
  account picker pre-filters to that Workspace. It is a hint; the Internal client is the gate.

## Setting up a client in Google Cloud Console (per Workspace)

Signed in as a user **of that Workspace** (for bistro-mondo.com, `info@bistro-mondo.com` works —
see memory `email_google_oauth_2026-10-03`):

1. Project (one per Workspace): `fs-os-email-ibzfoodstudio`, `fs-os-email-bistro-mondo`.
2. **APIs & Services → Library → Gmail API → Enable.**
3. **OAuth consent screen (Google Auth Platform → Branding/Audience):** user type **Internal**.
   App name "Food Studio OS Email", support + contact = a mailbox of that Workspace.
4. **Data access (Scopes):** add `https://www.googleapis.com/auth/gmail.readonly`,
   `https://www.googleapis.com/auth/gmail.send`, `https://www.googleapis.com/auth/gmail.modify`
   (plus `openid`, `email`, which the connect flow asks for to learn the mailbox address).
5. **Credentials → Create OAuth client → Web application.** Authorised redirect URIs — exactly:
   - `https://www.foodstudio.ai/api/email/callback`
   - `https://foodstudio.ai/api/email/callback`
   (NOT the Supabase functions URL — that was a mistake made once on 03-10.) Vercel previews
   cannot complete the consent — only production domains are on the client.
6. Copy **Client ID** and **Client secret** → OS → `/h/<slug>/comms?tab=mail` → "Google client for
   this house" → paste → *Save to vault*. Then **Connect a mailbox**.

The secret is shown by Google only at creation (and on the client's page under "Client secrets").
If it is lost, add a new secret on the same client and *Replace* in the OS — same client ID, so
connected mailboxes keep working.

## Which client goes to which house

| House (slug) | Workspace | GCP project | Mailboxes |
|---|---|---|---|
| Taller Sa Penya (`taller`) | ibzfoodstudio.com | `fs-os-email-ibzfoodstudio` | info@, boris@ibzfoodstudio.com |
| Boris Buono Holdings (`holdings`) | ibzfoodstudio.com | the same client may be pasted again | — |
| Bistro Mondo (`bm`) | bistro-mondo.com | `fs-os-email-bistro-mondo` | info@, admin@bistro-mondo.com |

The same Google client can be pasted into several houses of the same Workspace — the row is
per entity, the client is per Workspace.

## Selling the email module: External + CASA is a prerequisite

A customer restaurant is on its own Workspace (or on plain Gmail). An Internal client cannot
admit them, so **before the email module is sold to a third party** one of two things has to be
true:

1. **We verify one External app.** Google brand verification (privacy policy, homepage,
   demo video of the consent flow) **and** a CASA Tier 2 assessment for the restricted Gmail
   scopes, renewed yearly. Then one client serves every customer and this table holds one row
   that every entity can inherit (add a `platform` fallback row or reinstate the env pair as the
   verified client). Budget weeks and an external assessor.
2. **The customer brings their own client (BYO).** The customer's Workspace admin creates an
   Internal app + client in *their* GCP project (the six steps above), and pastes the pair into
   their house's card. Works today with zero verification on our side, because the app is
   Internal to *their* org. Cost: a 15-minute admin task on their side, which we document as an
   onboarding step. Plain-Gmail (`@gmail.com`) customers cannot do this — they have no
   Workspace — and need option 1.

Either way the code does not change: the client is already a row per entity.

## Tests and probes

- `sh scripts/test_email_channel.sh` — pure checks: row beats env, env only where allowed, hd
  only with a hosted domain, `client_changed` detection, id-shape check at paste time.
- `scripts/probes/oauth_clients_probe.sql` — rolled-back RLS probe on prod: stranger 0 rows,
  `secret_vault_id` not selectable, `vault` schema not reachable, RPCs refused for a non-manager,
  Boris can set / replace / disable, `fn_oauth_client_for` refused for `authenticated`.
  Runs inside `test_email_channel.sh` when `SUPABASE_DB_URL` + `psql` are present.

## Related

`docs/systems/release.md` · `supabase/migrations/20261003_oauth_clients_per_entity.sql` (+ `_ROLLBACK`) ·
memory `email_google_oauth_2026-10-03`, `security_and_email_shipped_2026-10-02`, `social_publishing_architecture`.
