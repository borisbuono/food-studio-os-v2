-- Day 5 — Inbox external ingestion (read-only first)
-- Grounded seed of mirrored outside channels for Utopia so the unified Inbox
-- (/administrate/decisions) reads as a live feed before the real connectors land.
-- Idempotent: a partial unique index on external_id + ON CONFLICT DO NOTHING,
-- and received_at is relative to now() so it always looks fresh whenever it runs.

create unique index if not exists inbox_items_external_id_key
  on inbox_items (external_id) where external_id is not null;

insert into inbox_items
  (restaurant_id, source, category, sender_name, sender_handle, subject, body,
   received_at, status, priority, external_id, external_url, metadata)
values
  -- ── Google reviews ─────────────────────────────────────────────
  ('a0000000-0000-4000-8000-000000000001','google_reviews','review','Marta Ferrer','Local Guide · 42 reviews',
   'Best meal of our Ibiza trip',
   'Tasting menu was faultless and the wine pairing surprised us twice. Service warm without hovering. We''ll be back next summer.',
   now() - interval '5 hours','new','normal','grev_utopia_0608_01','https://maps.google.com/?cid=utopia',
   '{"rating":5,"reviewer_location":"Barcelona"}'::jsonb),

  ('a0000000-0000-4000-8000-000000000001','google_reviews','review','James Whitlock',null,
   'Lovely food, slow on the pass',
   'The cooking is genuinely excellent. We waited 35 minutes between starter and main on a Friday though — front of house apologised but it took the shine off.',
   now() - interval '1 day 3 hours','new','high','grev_utopia_0608_02','https://maps.google.com/?cid=utopia',
   '{"rating":3,"reviewer_location":"London","theme":"pacing"}'::jsonb),

  ('a0000000-0000-4000-8000-000000000001','google_reviews','review','Sofia Lindqvist','Local Guide · 118 reviews',
   'The oyster and the natural wine list',
   'Came for a glass, stayed for three. The team know their list cold. One star off only because the terrace got loud after 22:00.',
   now() - interval '2 days 6 hours','new','normal','grev_utopia_0608_03','https://maps.google.com/?cid=utopia',
   '{"rating":4,"reviewer_location":"Stockholm"}'::jsonb),

  -- ── Email (Gmail summaries) ────────────────────────────────────
  ('a0000000-0000-4000-8000-000000000001','gmail','customer','Harmke de Bruine','harmke@parcom.nl',
   'Folklore BBQ — final headcount + ham cortador',
   'Hi Boris — confirming 20 guests for the 17 June villa BBQ. One question still open: are we able to get the Iberico ham cortador for the evening? Let me know cost and we''ll sign off.',
   now() - interval '7 hours','new','high','gmail_utopia_0608_01','https://mail.google.com/mail/u/0/#inbox/parcom-bbq',
   '{"thread":"parcom-folklore","amount_eur":null}'::jsonb),

  ('a0000000-0000-4000-8000-000000000001','gmail','supplier','Cashllot Distribució','pedidos@cashllot.es',
   'Albarán 4471 — entrega jueves',
   'Resumen del pedido confirmado para entrega el jueves: pescado fresco, hielo, y los cítricos. Factura a 30 días. Avísanos si cambia el número de cubiertos del fin de semana.',
   now() - interval '11 hours','new','normal','gmail_utopia_0608_02','https://mail.google.com/mail/u/0/#inbox/cashllot-4471',
   '{"thread":"cashllot","albaran":"4471"}'::jsonb),

  ('a0000000-0000-4000-8000-000000000001','gmail','press','Eivissa Magazine','redaccio@eivissamag.com',
   'Summer feature — would love 30 min with the chef',
   'We''re running a July piece on Ibiza''s new dining and would love to include Utopia. Could we book a short call or a quiet lunch this week to talk through the menu story?',
   now() - interval '1 day 9 hours','new','normal','gmail_utopia_0608_03','https://mail.google.com/mail/u/0/#inbox/eivissa-feature',
   '{"thread":"eivissa-press"}'::jsonb),

  -- ── WhatsApp Business mirror ───────────────────────────────────
  ('a0000000-0000-4000-8000-000000000001','whatsapp','booking','+34 612 044 119','WhatsApp Business',
   'Table for 4 tonight?',
   'Hola! Any chance of a table for 4 around 21:00 tonight? It''s a birthday. Gracias!',
   now() - interval '2 hours','new','high','wa_utopia_0608_01',null,
   '{"channel":"whatsapp_business","party_size":4}'::jsonb),

  ('a0000000-0000-4000-8000-000000000001','whatsapp','booking','+34 671 339 802','WhatsApp Business',
   'Coeliac in our group on Saturday',
   'Booking under Nguyen, Saturday 20:30. One of us is strictly gluten-free — can the kitchen handle the tasting menu? Want to confirm before we come.',
   now() - interval '20 hours','new','high','wa_utopia_0608_02',null,
   '{"channel":"whatsapp_business","tag":"allergen"}'::jsonb),

  ('a0000000-0000-4000-8000-000000000001','whatsapp','customer','+34 600 712 558','WhatsApp Business',
   'Left a navy jacket last night',
   'Think I left a navy linen jacket on the back of a chair on the terrace last night. Any luck? Can collect tomorrow.',
   now() - interval '1 day 1 hour','new','normal','wa_utopia_0608_03',null,
   '{"channel":"whatsapp_business","tag":"lost_property"}'::jsonb)
on conflict (external_id) where external_id is not null do nothing;
