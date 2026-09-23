-- Saved replies seed (spec §6): apply, booking, hours, dogs, parking — per
-- venue, EN + ES. Only the two facts we actually hold are active (the apply
-- link and Bistro Mondo's booking link). Hours / dogs / parking ship as
-- placeholders with active = false: Boris fills the [brackets] on
-- /h/<slug>/office/inbox/saved and switches them on. Nothing invented.
-- Entities resolved through resolve_entity(), no static ids.
do $$
declare v_bm uuid := public.resolve_entity('BM');
        v_tl uuid := public.resolve_entity('taller');
begin
  if v_bm is not null then
    insert into public.social_saved_replies (entity_id, key, title, lang, body, sort, active) values
      (v_bm, 'apply',   'How to apply',      'en', 'Lovely that you asked. Everything about working with us is here: https://foodstudio.ai/apply/bm?src=dm — takes two minutes.', 10, true),
      (v_bm, 'apply',   'Cómo aplicar',      'es', 'Qué bien que preguntes. Todo lo de trabajar con nosotros está aquí: https://foodstudio.ai/apply/bm?src=dm — dos minutos.', 11, true),
      (v_bm, 'booking', 'Booking',           'en', 'Easiest is here: https://shop.fresto.io/en/bistro-mondo/booking — if you don''t see the slot you want, DM us and we''ll look.', 20, true),
      (v_bm, 'booking', 'Reservas',          'es', 'Lo más fácil es aquí: https://shop.fresto.io/en/bistro-mondo/booking — si no ves la hora que buscas, escríbenos por DM y lo miramos.', 21, true),
      (v_bm, 'hours',   'Opening hours',     'en', 'We''re open [days, hours]. Kitchen closes at [time].', 30, false),
      (v_bm, 'hours',   'Horario',           'es', 'Abrimos [días, horas]. La cocina cierra a las [hora].', 31, false),
      (v_bm, 'dogs',    'Dog-friendly',      'en', '[Yes/no — dogs on the terrace / inside]. Just let us know when you book.', 40, false),
      (v_bm, 'dogs',    'Perros',            'es', '[Sí/no — perros en la terraza / dentro]. Avísanos al reservar.', 41, false),
      (v_bm, 'parking', 'Parking',           'en', 'Nearest parking is [where]. [Tip].', 50, false),
      (v_bm, 'parking', 'Aparcamiento',      'es', 'Lo más cerca para aparcar es [dónde]. [Consejo].', 51, false)
    on conflict (entity_id, key, lang) do nothing;
  end if;
  if v_tl is not null then
    insert into public.social_saved_replies (entity_id, key, title, lang, body, sort, active) values
      (v_tl, 'apply',   'How to apply',      'en', 'Thank you for thinking of us. Everything about working with us is here: https://foodstudio.ai/apply/taller?src=dm', 10, true),
      (v_tl, 'apply',   'Cómo aplicar',      'es', 'Gracias por pensar en nosotros. Todo lo de trabajar con nosotros está aquí: https://foodstudio.ai/apply/taller?src=dm', 11, true),
      (v_tl, 'booking', 'Booking',           'en', 'Send us a DM with the date, how many you are and anything we should know, and we''ll come back to you with what''s possible.', 20, true),
      (v_tl, 'booking', 'Reservas',          'es', 'Escríbenos por DM con la fecha, cuántos sois y lo que debamos saber, y te contestamos con lo que es posible.', 21, true),
      (v_tl, 'hours',   'When we open',      'en', 'We open [days / by reservation]. [Detail].', 30, false),
      (v_tl, 'hours',   'Cuándo abrimos',    'es', 'Abrimos [días / con reserva]. [Detalle].', 31, false),
      (v_tl, 'dogs',    'Dog-friendly',      'en', '[Yes/no]. Tell us when you book.', 40, false),
      (v_tl, 'dogs',    'Perros',            'es', '[Sí/no]. Dínoslo al reservar.', 41, false),
      (v_tl, 'parking', 'Parking',           'en', 'Nearest parking is [where]. [Tip].', 50, false),
      (v_tl, 'parking', 'Aparcamiento',      'es', 'Lo más cerca para aparcar es [dónde]. [Consejo].', 51, false)
    on conflict (entity_id, key, lang) do nothing;
  end if;
end $$;
