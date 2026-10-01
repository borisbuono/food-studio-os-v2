-- 20261002_cleaning_s1_seed_bm_taller.sql
-- Cleaning S1 seed — the printed sheets as templates, wording kept as the team
-- wrote it (ES/EN mixed, like the paper). Sources:
--   BM  06_PA/Menus_Current/Bistro_Mondo_FOH_Checklists.pdf (FOH opening / closing / deep clean, 2026-09-28)
--       Bistro_Mondo_Task_Lists_STAGING.md (kitchen daily A, deep clean B — Boris 2026-05-20)
--   Taller Taller_Task_Lists_STAGING.md (BOH weekly rota T1 — day columns lost in the paste)
-- Every template whose day or detail the paper does not settle carries
-- metadata.needs_boris_review = true and says why in metadata.review.
-- Idempotent: keyed on (entity_id, name); re-running updates items.

create or replace function pg_temp._cl_items(labels text[]) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('label', l, 'order', o) order by o), '[]'::jsonb)
    from unnest(labels) with ordinality as x(l, o);
$$;

create or replace function pg_temp._cl_put(p_slug text, p_name text, p_area text, p_freq text, p_weekday int, p_sort int, p_items jsonb, p_meta jsonb) returns void language plpgsql as $$
declare eid uuid; existing uuid;
begin
  select id into eid from public.entities where slug = p_slug;
  if eid is null then return; end if;
  select id into existing from public.cleaning_templates where entity_id = eid and name = p_name;
  if existing is null then
    insert into public.cleaning_templates(entity_id, name, area, frequency, weekday, sort_order, items, metadata)
    values (eid, p_name, p_area, p_freq, p_weekday, p_sort, p_items, p_meta);
  else
    update public.cleaning_templates set area = p_area, frequency = p_freq, weekday = p_weekday, sort_order = p_sort, items = p_items, metadata = metadata || p_meta, updated_at = now() where id = existing;
  end if;
end $$;

-- ============================================================ Bistro Mondo
-- Kitchen daily (List A)
select pg_temp._cl_put('bm', 'Cocina · Apertura 12:00', 'Cocina', 'opening', null, 10, pg_temp._cl_items(array[
  'Prender cuchipasta',
  'Prender horno de desayuno — 180°, modo infinito',
  'Prender horno de pizza',
  'Prender freidora — 160°',
  'Armar plaza de pizzas — tabla · cuchillos · corta pizza · espátulas · sémola · descongelar falafel y arancino · topper freidora con papel · revisar faltantes y reportar a salón',
  'Armar plaza de cocina — tabla · boul de ensaladas · cucharas · espátulas · pinzas · mandolina · cuchara de helado · mantequilla · papel de horno · revisar faltantes y reportar a salón'
]), '{"source":"Bistro_Mondo_Task_Lists_STAGING.md List A opening","needs_boris_review":true,"review":"confirm the list matches the sheet on the kitchen wall"}');

select pg_temp._cl_put('bm', 'Cocina · Repaso 16:30', 'Cocina', 'daily', null, 20, pg_temp._cl_items(array[
  'Limpiar todos los sectores',
  'Guardar mercadería en refri',
  'Barrer'
]), '{"source":"Bistro_Mondo_Task_Lists_STAGING.md List A mid-service reset","needs_boris_review":true,"review":"mid-service block kept as its own list; confirm 16:30 is right"}');

select pg_temp._cl_put('bm', 'Cocina · Cierre 22:00', 'Cocina', 'closing', null, 30, pg_temp._cl_items(array[
  'Apagar horno de pizza',
  'Apagar freidora',
  'Apagar cuchipasta',
  'Apagar horno de desayuno',
  'Guardar todo en refrigeradores, tapado y rotulado',
  'Controlar faltantes y producción para el día siguiente',
  'Limpiar mesadas, puertas y paredes (esponja, agua, detergente)',
  'Limpiar utensilios y devolver a sus sectores',
  'Barrer',
  'Baldear o pasar fregona',
  'Guardar platos y topper',
  'Colocar trapos y delantales en la lavadora',
  'Controlar refrigeradores y congeladores prendidos',
  'Limpiar suelo de pizzería con cepillo y recogedor',
  'Limpiar suelo de cocina prep con cepillo y recogedor',
  'Remontar cocinas junto a sus utensilios',
  'Deep cleaning de inducciones',
  'Mantener limpio y ordenado a toda hora'
]), '{"source":"Bistro_Mondo_Task_Lists_STAGING.md List A closing + List B daily_close (cocinas)","needs_boris_review":true,"review":"List B daily lines for pizzería / prep / inducciones folded into the kitchen closing list"}');

-- Pica (List B)
select pg_temp._cl_put('bm', 'Pica · Cierre', 'Pica', 'closing', null, 40, pg_temp._cl_items(array[
  'Organize and start the dishwashing circle',
  'Limpiar cubiertos',
  'Secar todo',
  'Recoger y organizar la ropa del tendedero',
  'Vaciar lavadora y tender la ropa',
  'Limpiar suelo de pica con cepillo y recogedor',
  'Sacar basura / contenedores',
  'Vaciar máquina de lavar platos y limpiar',
  'Limpiar lavavajillas por dentro y fuera',
  'Limpiar bacha con pared y piso',
  'Limpiar y despejar pica'
]), '{"source":"Bistro_Mondo_Task_Lists_STAGING.md List B Pica daily_close + List A Pica lines"}');

select pg_temp._cl_put('bm', 'Pica · Semanal lunes', 'Pica', 'weekly', 1, 41, pg_temp._cl_items(array[
  'Limpiar desagües',
  'Organizar productos de limpieza',
  'Limpiar cubos de basura',
  'Deep cleaning de pica: walls, shelfs, armario',
  'Deep cleaning de máquina de pica',
  'Deep cleaning debajo de pica'
]), '{"source":"Bistro_Mondo_Task_Lists_STAGING.md List B weekly_monday"}');

select pg_temp._cl_put('bm', 'Pica · Semanal martes', 'Pica', 'weekly', 2, 42, pg_temp._cl_items(array[
  'Limpiar suelo de barra exterior',
  'Limpiar almacén',
  'Rellenar dispensadores de papel'
]), '{"source":"Bistro_Mondo_Task_Lists_STAGING.md List B weekly_tuesday"}');

select pg_temp._cl_put('bm', 'Pica · Semanal miércoles', 'Pica', 'weekly', 3, 43, pg_temp._cl_items(array[
  'Limpiar techos, telarañas',
  'Ordenar todas las bandejas'
]), '{"source":"Bistro_Mondo_Task_Lists_STAGING.md List B weekly_wednesday"}');

-- Cocinas weekly (List B)
select pg_temp._cl_put('bm', 'Cocina · Semanal lunes', 'Cocina', 'weekly', 1, 50, pg_temp._cl_items(array[
  'Limpiar campana'
]), '{"source":"Bistro_Mondo_Task_Lists_STAGING.md List B (no day on the sheet — default Monday)","needs_boris_review":true,"review":"limpiar campana has no day on the sheet; Monday is a default"}');

select pg_temp._cl_put('bm', 'Cocina · Semanal miércoles', 'Cocina', 'weekly', 3, 51, pg_temp._cl_items(array[
  'Limpiar campanas por fuera'
]), '{"source":"Bistro_Mondo_Task_Lists_STAGING.md List B weekly_wednesday"}');

select pg_temp._cl_put('bm', 'Cocina · Semanal viernes', 'Cocina', 'weekly', 5, 52, pg_temp._cl_items(array[
  'Deep cleaning de pizzería',
  'Limpiar hornos de pizza',
  'Limpiar freidora'
]), '{"source":"Bistro_Mondo_Task_Lists_STAGING.md List B weekly_friday"}');

select pg_temp._cl_put('bm', 'Cocina · Semanal domingo', 'Cocina', 'weekly', 7, 53, pg_temp._cl_items(array[
  'Deep cleaning de cocina de preparación',
  'Limpiar hornos',
  'Limpiar neveras'
]), '{"source":"Bistro_Mondo_Task_Lists_STAGING.md List B weekly_sunday (limpiar neveras: no day on the sheet — default Sunday)","needs_boris_review":true,"review":"limpiar neveras has no day on the sheet; Sunday is a default"}');

-- FOH (printed PDF 2026-09-28)
select pg_temp._cl_put('bm', 'Sala · Opening', 'Sala', 'opening', null, 60, pg_temp._cl_items(array[
  'Bar & bathroom — Turn on glasswasher',
  'Bar & bathroom — Light up wine and water fridges',
  'Bar & bathroom — Open toldo (awning) on the entrance',
  'Front terrace & bar — Position service station: cutlery, napkins, plates, dirty dishes box',
  'Front terrace & bar — Position table for menus',
  'Front terrace & bar — Clean tables',
  'Front terrace & bar — Clean front terrace floor: broom & mop',
  'Front terrace & bar — Table set up: cutlery, glass, plates',
  'Garden — Clean tables',
  'Garden — Clean floor: broom & mop',
  'Garden — Fill up service station',
  'Garden — Pillows clean & in order',
  'Garden — Clean chiringuito counter',
  'Garden — Clean trees area',
  'Garden — Clean & order garbage bin area',
  'Everywhere — Refill menage: salt, pepper, oil, tabasco, 3-chili set, allioli, olives, cacahuetes',
  'Everywhere — Check bathrooms',
  'Everywhere — Refill toilet & hand paper and soap',
  'Everywhere — Clean bar table pavement: broom & mop',
  'Everywhere — Clean cutlery',
  'Before the evening (18:00) — Check up & re-set up tables',
  'Before the evening (18:00) — Candle lights on the tables',
  'Before the evening (18:00) — Big candle on the stairs'
]), '{"source":"Bistro_Mondo_FOH_Checklists.pdf FOH · OPENING 2026-09-28"}');

select pg_temp._cl_put('bm', 'Sala · Closing', 'Sala', 'closing', null, 61, pg_temp._cl_items(array[
  'Bar & bathroom — Switch off & empty glasswasher',
  'Bar & bathroom — Clean filter glasswasher',
  'Bar & bathroom — Take off candles from tables',
  'Bar & bathroom — Clean bar counter',
  'Bar & bathroom — Clean coffee machine',
  'Bar & bathroom — Clean beer draft',
  'Bar & bathroom — Clean inside floor / bathroom: broom & mop',
  'Bar & bathroom — Empty & throw away garbage bins',
  'Front terrace — Take off service station',
  'Front terrace — Take off table menus',
  'Front terrace — Clean / sanitize table tops',
  'Front terrace — Cutlery, glass & plates ready for next day',
  'Garden — Clean tables',
  'Garden — Clean floor: broom & mop',
  'Garden — Throw away paper & organic garbage',
  'Garden — Clean bar counter',
  'Garden — Clean trees area',
  'Before you leave — Help dishwashing to close',
  'Before you leave — Set up internal table',
  'Before you leave — Clean all the tables'
]), '{"source":"Bistro_Mondo_FOH_Checklists.pdf FOH · CLOSING 2026-09-28"}');

select pg_temp._cl_put('bm', 'Sala · Deep clean (weekly)', 'Sala', 'weekly', 1, 62, pg_temp._cl_items(array[
  'Front terraces — Plants and take off wild grass',
  'Front terraces — Clean floor with Karcher',
  'Front terraces — Clean wooden door',
  'Bar & bathroom — Deep clean floor with dishwasher soap',
  'Bar & bathroom — Clean entrance door frame and glass',
  'Bar & bathroom — Fridges: wine, soft drinks, food',
  'Bar & bathroom — Coffee machine: deep cleaning filters',
  'Bar & bathroom — Water bottles area',
  'Bar & bathroom — Mirror',
  'Bar & bathroom — Spirits shelf',
  'Bar & bathroom — Under-counter shelf',
  'Bar & bathroom — Sharing plates closet',
  'Bar & bathroom — Spiderweb everywhere',
  'Bar & bathroom — Sanitary deep cleaning',
  'Bar & bathroom — Deep cleaning dry storage',
  'Garden / washing area — Deep cleaning floor around washing area & garden patio (Karcher)',
  'Garden / washing area — Clean chiringuito',
  'Garden / washing area — Water plants and take off wild grass',
  'Garden / washing area — Take off dry leaves on the ground',
  'Garden / washing area — Clean walking stones',
  'Garden / washing area — Clean and set up storage by the side of the garden'
]), '{"source":"Bistro_Mondo_FOH_Checklists.pdf FOH · DEEP CLEAN (weekly, no day printed — default Monday)","needs_boris_review":true,"review":"the sheet says weekly with no day; Monday is a default — pick the day or split it"}');

-- ============================================================ Taller Sa Penya
-- T1 BOH weekly rota: the Mon–Sun columns were lost in the paste. Daily
-- lines (5×/week) become the closing list; the once-weekly lines are spread
-- across the week as a DEFAULT. All of it is for Boris to confirm.
select pg_temp._cl_put('taller', 'Cocina · Cierre', 'Cocina', 'closing', null, 10, pg_temp._cl_items(array[
  'Floor & drain',
  'Bring out garbage'
]), '{"source":"Taller_Task_Lists_STAGING.md T1 (5×/week lines)","needs_boris_review":true,"review":"floor & drain and garbage run 5 days a week on the sheet — here every service day; confirm"}');

select pg_temp._cl_put('taller', 'Cocina · Semanal lunes', 'Cocina', 'weekly', 1, 21, pg_temp._cl_items(array['Fridges','Walls','Shelfs']),
  '{"source":"Taller_Task_Lists_STAGING.md T1 (day columns lost — default spread)","needs_boris_review":true,"review":"day assignment is a default, not the sheet"}');
select pg_temp._cl_put('taller', 'Cocina · Semanal martes', 'Cocina', 'weekly', 2, 22, pg_temp._cl_items(array['Oven','Extraction']),
  '{"source":"Taller_Task_Lists_STAGING.md T1 (day columns lost — default spread)","needs_boris_review":true,"review":"day assignment is a default, not the sheet"}');
select pg_temp._cl_put('taller', 'Cocina · Semanal miércoles', 'Cocina', 'weekly', 3, 23, pg_temp._cl_items(array['Freezers','Drystore shelfs']),
  '{"source":"Taller_Task_Lists_STAGING.md T1 (day columns lost — default spread)","needs_boris_review":true,"review":"day assignment is a default, not the sheet"}');
select pg_temp._cl_put('taller', 'Cocina · Semanal jueves', 'Cocina', 'weekly', 4, 24, pg_temp._cl_items(array['Fridges','Garbage bins clean']),
  '{"source":"Taller_Task_Lists_STAGING.md T1 (fridges 2×/week; day columns lost — default spread)","needs_boris_review":true,"review":"day assignment is a default, not the sheet"}');
select pg_temp._cl_put('taller', 'Cocina · Semanal viernes', 'Cocina', 'weekly', 5, 25, pg_temp._cl_items(array['Windows','Lamps']),
  '{"source":"Taller_Task_Lists_STAGING.md T1 (day columns lost — default spread)","needs_boris_review":true,"review":"day assignment is a default, not the sheet"}');
select pg_temp._cl_put('taller', 'Cocina · Semanal sábado', 'Cocina', 'weekly', 6, 26, pg_temp._cl_items(array['Filters in fridges','Cleaning all machines']),
  '{"source":"Taller_Task_Lists_STAGING.md T1 (day columns lost — default spread)","needs_boris_review":true,"review":"day assignment is a default, not the sheet"}');
select pg_temp._cl_put('taller', 'Cocina · Semanal domingo', 'Cocina', 'weekly', 7, 27, pg_temp._cl_items(array['Move fridges','Fryer']),
  '{"source":"Taller_Task_Lists_STAGING.md T1 (day columns lost — default spread)","needs_boris_review":true,"review":"day assignment is a default, not the sheet"}');

-- Taller has no printed opening list; the fridge temperature sheet (T2) is
-- the opening record and lands as temp items in S2.
