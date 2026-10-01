-- Menu-first loop, slice 2 — cost the lines (2026-10-01).
--
-- recipe_ingredients line → ingredient price (purchase-derived or provisional)
-- → line_cost → recipes.cost_per_serving_eur → menu_items.food_cost_percent_actual.
-- Everything runs in Postgres so pg_cron can re-cost nightly without a Vercel
-- slot, and the page's "Recost now" is one RPC.
--
-- Honesty rules (Foundation §6): a price that did not come from an invoice is
-- source='provisional' + needs_confirm and surfaces as "estimate", never as a
-- clean number; a purchase line is used only if qty × price == line (the unit
-- contract — memory catalogue_has_no_unit_contract).

-- ── the price table ───────────────────────────────────────────────────────────
create table if not exists public.ingredient_prices (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  canonical_name text not null,
  name_norm text generated always as (public.fn_name_norm(canonical_name)) stored,
  aliases text[] not null default '{}',
  unit text not null check (unit in ('kg','l','pcs')),
  price_eur numeric not null check (price_eur >= 0),           -- per unit, ex-VAT
  unit_weight_kg numeric,                                        -- kg per piece (pcs <-> kg)
  source text not null check (source in ('purchase','provisional','confirmed')),
  needs_confirm boolean not null default false,
  price_asof date,
  sample_count int,
  supplier text,
  purchase_pattern text,                                         -- ilike on purchase_lines.raw_product_text
  pack_qty numeric, pack_unit text,                              -- 1 purchase unit = pack_qty pack_unit (overrides the parser)
  note text,
  estimated_by text,
  confirmed_by uuid, confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, name_norm)
);
create index if not exists ingredient_prices_entity_idx on public.ingredient_prices(entity_id);
alter table public.ingredient_prices enable row level security;
drop policy if exists ingredient_prices_select on public.ingredient_prices;
create policy ingredient_prices_select on public.ingredient_prices for select using (entity_id in (select public.current_person_entities()));
drop policy if exists ingredient_prices_insert on public.ingredient_prices;
create policy ingredient_prices_insert on public.ingredient_prices for insert with check (entity_id in (select public.current_person_entities()));
drop policy if exists ingredient_prices_update on public.ingredient_prices;
create policy ingredient_prices_update on public.ingredient_prices for update using (entity_id in (select public.current_person_entities())) with check (entity_id in (select public.current_person_entities()));
drop policy if exists ingredient_prices_delete on public.ingredient_prices;
create policy ingredient_prices_delete on public.ingredient_prices for delete using (entity_id in (select public.app_my_managed_entities()));

alter table public.recipe_ingredients
  add column if not exists cost_source text,          -- purchase|confirmed|provisional|sub_recipe|none
  add column if not exists unit_price_eur numeric,
  add column if not exists price_id uuid references public.ingredient_prices(id) on delete set null,
  add column if not exists cost_note text;
alter table public.recipes
  add column if not exists cost_source text,          -- purchase|mixed|provisional|none
  add column if not exists cost_coverage numeric,     -- priced lines / lines
  add column if not exists cost_total_eur numeric,
  add column if not exists quantities_estimated boolean default false;

-- ── units ─────────────────────────────────────────────────────────────────────
-- A recipe quantity in whatever the kitchen wrote → (base unit, quantity in it).
create or replace function public.fn_qty_to_base(p_qty text, p_unit text, out base text, out qty numeric)
language plpgsql immutable as $$
declare u text := lower(trim(coalesce(p_unit,''))); q numeric;
begin
  begin q := nullif(replace(trim(coalesce(p_qty,'')), ',', '.'), '')::numeric; exception when others then q := null; end;
  if q is null then base := null; qty := null; return; end if;
  case
    when u in ('g','gr','grs','gram','grams','gramo','gramos') then base := 'kg'; qty := q / 1000;
    when u in ('kg','kgs','kilo','kilos') then base := 'kg'; qty := q;
    when u in ('mg') then base := 'kg'; qty := q / 1000000;
    when u in ('ml','mls') then base := 'l'; qty := q / 1000;
    when u in ('cl') then base := 'l'; qty := q / 100;
    when u in ('l','lt','ltr','litre','liter','litro','litros') then base := 'l'; qty := q;
    when u in ('tsp','cdta','teaspoon') then base := 'l'; qty := q * 0.005;
    when u in ('tbsp','cda','tablespoon') then base := 'l'; qty := q * 0.015;
    when u in ('cup','cups','taza','tazas') then base := 'l'; qty := q * 0.24;
    when u in ('pinch','pizca') then base := 'kg'; qty := q * 0.0005;
    when u in ('oz') then base := 'kg'; qty := q * 0.02835;
    when u in ('lb') then base := 'kg'; qty := q * 0.4536;
    else base := 'pcs'; qty := q;   -- pcs, ud, unit, egg, clove, leaf, slice, portion, '' …
  end case;
end $$;

-- Pack size written into a supplier product name → (base unit, quantity per
-- purchase unit). "BOCCONCINI BUFALA 125 GR *12" → (kg, 1.5); "SOJA 1 L" → (l, 1).
create or replace function public.fn_parse_pack(p_text text, out base text, out qty numeric)
language plpgsql immutable as $$
declare m text[]; n numeric; u text; mult numeric := 1; mm text[];
begin
  base := null; qty := null;
  if p_text is null then return; end if;
  m := regexp_match(lower(public.unaccent(p_text)), '(\d+(?:[.,]\d+)?)\s*(kg|kgs|gr|grs|g|l|lt|ltr|ml|cl)\y');
  if m is null then return; end if;
  n := replace(m[1], ',', '.')::numeric; u := m[2];
  mm := regexp_match(lower(p_text), '[x*]\s*(\d{1,3})\y');
  if mm is null then mm := regexp_match(lower(p_text), '\y(\d{1,3})\s*[x*]\s*\d'); end if;
  if mm is not null then mult := mm[1]::numeric; end if;
  if u in ('kg','kgs') then base := 'kg'; qty := n * mult;
  elsif u in ('g','gr','grs') then base := 'kg'; qty := n * mult / 1000;
  elsif u in ('l','lt','ltr') then base := 'l'; qty := n * mult;
  elsif u = 'ml' then base := 'l'; qty := n * mult / 1000;
  elsif u = 'cl' then base := 'l'; qty := n * mult / 100;
  end if;
  if qty is not null and qty <= 0 then base := null; qty := null; end if;
end $$;

-- entity → purchase_lines.entity_code
create or replace function public.fn_entity_pl_code(p_entity uuid) returns text
language sql stable as $$
  select case p_entity
    when '387f1045-0340-4029-a1e4-28b15c372680'::uuid then 'BM'
    when 'daec58d9-44a2-4c24-9183-2a87219093fb'::uuid then 'IFL'
    when 'd1ee19b6-5fb4-460c-8326-685dc86e47df'::uuid then 'BBH'
    when 'f365f49d-4cd1-43d1-955f-03c21816ad22'::uuid then 'UTOPIA' end
$$;

-- ── purchase prices from invoices ─────────────────────────────────────────────
-- For every price row of the entity that names a purchase pattern: take the
-- lines that match, keep only those whose arithmetic holds (qty × unit price,
-- less discount, == ex-VAT line within 1.5 % / 2 cents), read the pack size,
-- and write a weighted-average €/base-unit over the 90 days up to the newest
-- line. Returns how many rows moved.
create or replace function public.fn_refresh_purchase_prices(p_entity uuid) returns int
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare ip record; v_code text := public.fn_entity_pl_code(p_entity); n int := 0; r record;
        tot_eur numeric; tot_qty numeric; cnt int; newest date; sup text; pk record; base_q numeric;
begin
  if v_code is null then return 0; end if;
  for ip in select * from public.ingredient_prices where entity_id = p_entity and purchase_pattern is not null loop
    tot_eur := 0; tot_qty := 0; cnt := 0; newest := null; sup := null;
    for r in
      select pl.*, coalesce(pl.line_subtotal_eur, pl.line_total_eur) as base_eur
        from public.purchase_lines pl
       where pl.entity_code = v_code and pl.raw_product_text ilike ip.purchase_pattern
         and pl.doc_date >= current_date - 365 and pl.qty > 0 and pl.unit_price_eur > 0
       order by pl.doc_date desc
    loop
      -- the unit contract: qty × price (− discount) must equal the line
      if abs(r.qty * r.unit_price_eur * (1 - coalesce(r.discount_pct,0)/100) - r.base_eur) > greatest(0.02, 0.015 * r.base_eur) then continue; end if;
      if newest is null then newest := r.doc_date; end if;
      if r.doc_date < newest - 90 then exit; end if;
      -- how much of the base unit is one purchase unit?
      if ip.pack_qty is not null and ip.pack_unit is not null then
        select * into pk from public.fn_qty_to_base(ip.pack_qty::text, ip.pack_unit);
      else
        select * into pk from public.fn_parse_pack(r.raw_product_text);
      end if;
      if ip.unit = 'pcs' then
        base_q := case when pk.base = 'pcs' then coalesce(pk.qty,1) else 1 end;
      elsif pk.base = ip.unit then
        base_q := pk.qty;
      elsif pk.base in ('kg','l') and ip.unit in ('kg','l') then
        base_q := pk.qty;  -- kg<->l at density 1, noted below
      else
        continue;          -- no pack size on the line: cannot price per kg honestly
      end if;
      if base_q is null or base_q <= 0 then continue; end if;
      tot_eur := tot_eur + r.qty * r.unit_price_eur * (1 - coalesce(r.discount_pct,0)/100);
      tot_qty := tot_qty + r.qty * base_q;
      cnt := cnt + 1;
      if sup is null then sup := r.doc_ref; end if;
    end loop;
    if cnt > 0 and tot_qty > 0 then
      update public.ingredient_prices
         set price_eur = round(tot_eur / tot_qty, 4), source = 'purchase', needs_confirm = false,
             price_asof = newest, sample_count = cnt, supplier = sup, updated_at = now(),
             note = cnt || ' invoice line(s) to ' || newest
       where id = ip.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ── resolve a line to a price row ─────────────────────────────────────────────
create or replace function public.fn_resolve_price(p_entity uuid, p_name text, out price_id uuid, out how text)
language plpgsql stable as $$
declare k text := public.fn_name_norm(p_name); k2 text; sing text;
begin
  price_id := null; how := null;
  if k = '' then return; end if;
  select id into price_id from public.ingredient_prices where entity_id = p_entity and name_norm = k limit 1;
  if price_id is not null then how := 'exact'; return; end if;
  select ip.id into price_id from public.ingredient_prices ip, unnest(ip.aliases) a
   where ip.entity_id = p_entity and public.fn_name_norm(a) = k limit 1;
  if price_id is not null then how := 'alias'; return; end if;
  -- "tomato, chopped" → "tomato"; "onion (red)" → "onion"
  k2 := public.fn_name_norm(split_part(split_part(p_name, ',', 1), '(', 1));
  if k2 <> k and k2 <> '' then
    select id into price_id from public.ingredient_prices where entity_id = p_entity and name_norm = k2 limit 1;
    if price_id is null then
      select ip.id into price_id from public.ingredient_prices ip, unnest(ip.aliases) a where ip.entity_id = p_entity and public.fn_name_norm(a) = k2 limit 1;
    end if;
    if price_id is not null then how := 'stem'; return; end if;
  end if;
  -- crude singular
  sing := case when k ~ 'ies$' then regexp_replace(k, 'ies$', 'y') when k ~ 'es$' then regexp_replace(k, 'es$', '') when k ~ 's$' then regexp_replace(k, 's$', '') else k end;
  if sing <> k then
    select id into price_id from public.ingredient_prices where entity_id = p_entity and (name_norm = sing or exists (select 1 from unnest(aliases) a where public.fn_name_norm(a) = sing)) limit 1;
    if price_id is not null then how := 'singular'; return; end if;
  end if;
  -- last resort: trigram, tight, and always labelled on the line
  select id into price_id from public.ingredient_prices
   where entity_id = p_entity and similarity(name_norm, k) >= 0.6
   order by similarity(name_norm, k) desc limit 1;
  if price_id is not null then how := 'fuzzy'; end if;
end $$;

-- ── cost one recipe (its own lines, its own venue's prices) ───────────────────
create or replace function public.fn_cost_recipe(p_recipe uuid, p_depth int default 0) returns numeric
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare rec public.recipes; li record; b record; ip public.ingredient_prices; sub public.recipes; sub_cost numeric;
        v_cost numeric; v_src text; v_note text; v_price_id uuid; v_unit_price numeric; v_how text;
        n_lines int := 0; n_priced int := 0; total numeric := 0; any_prov boolean := false; any_purch boolean := false;
        v_serv numeric; sub_base record;
begin
  select * into rec from public.recipes where id = p_recipe;
  if rec.id is null or p_depth > 4 then return null; end if;

  for li in select * from public.recipe_ingredients where recipe_id = p_recipe order by sort_order, order_idx loop
    -- method/notes rows masquerading as ingredients carry no quantity and long text: skip them from the count
    if li.quantity is null and length(coalesce(li.ingredient_name, li.name, '')) > 60 then continue; end if;
    n_lines := n_lines + 1;
    v_cost := null; v_src := 'none'; v_note := null; v_price_id := null; v_unit_price := null;
    select * into b from public.fn_qty_to_base(li.quantity, li.unit);

    if coalesce(li.sub_recipe_id, li.linked_recipe_id) is not null and coalesce(li.sub_recipe_id, li.linked_recipe_id) <> p_recipe then
      select * into sub from public.recipes where id = coalesce(li.sub_recipe_id, li.linked_recipe_id);
      sub_cost := public.fn_cost_recipe(sub.id, p_depth + 1);
      select * into sub from public.recipes where id = sub.id;  -- re-read: cost_* just written
      if sub.cost_total_eur is not null and b.qty is not null then
        if b.base in ('kg','l') then
          -- cost per kg/l of the sub-recipe from its yield
          select * into sub_base from public.fn_qty_to_base(coalesce(sub.yield_qty, sub.yield_grams)::text, case when sub.yield_qty is not null then sub.yield_unit else 'g' end);
          if sub_base.base in ('kg','l') and sub_base.qty > 0 then
            v_cost := b.qty * sub.cost_total_eur / sub_base.qty;
          else
            v_cost := b.qty * coalesce(sub.cost_per_serving_eur, 0); v_note := 'sub-recipe yield not in kg/l — priced per portion';
          end if;
        else
          v_cost := b.qty * coalesce(sub.cost_per_serving_eur, 0);
        end if;
        v_src := 'sub_recipe';
        if sub.cost_source in ('provisional','mixed') or coalesce(sub.quantities_estimated,false) then any_prov := true; end if;
        if sub.cost_source in ('purchase','mixed') then any_purch := true; end if;
        if coalesce(sub.cost_coverage,0) < 1 then v_note := coalesce(v_note || '; ', '') || 'sub-recipe only ' || round(coalesce(sub.cost_coverage,0)*100) || ' % priced'; end if;
      else
        v_note := 'sub-recipe has no cost yet';
      end if;
    else
      select * into v_price_id, v_how from public.fn_resolve_price(rec.entity_id, coalesce(li.ingredient_name, li.name));
      if v_price_id is not null then
        select * into ip from public.ingredient_prices where id = v_price_id;
        if b.qty is null then
          v_note := 'no quantity on the line';
        elsif b.base = ip.unit then
          v_cost := b.qty * ip.price_eur;
        elsif b.base in ('kg','l') and ip.unit in ('kg','l') then
          v_cost := b.qty * ip.price_eur; v_note := 'kg/l taken as 1:1';
        elsif b.base = 'pcs' and ip.unit = 'kg' and ip.unit_weight_kg is not null then
          v_cost := b.qty * ip.unit_weight_kg * ip.price_eur;
        elsif b.base = 'kg' and ip.unit = 'pcs' and ip.unit_weight_kg is not null and ip.unit_weight_kg > 0 then
          v_cost := b.qty / ip.unit_weight_kg * ip.price_eur;
        else
          v_note := 'unit mismatch: line in ' || coalesce(b.base,'?') || ', price per ' || ip.unit;
        end if;
        if v_cost is not null then
          v_src := ip.source; v_unit_price := ip.price_eur;
          if ip.source = 'provisional' then any_prov := true; else any_purch := true; end if;
          if v_how = 'fuzzy' then v_note := coalesce(v_note || '; ', '') || 'price of "' || ip.canonical_name || '" (fuzzy)'; end if;
        end if;
      else
        v_note := 'no price for this ingredient';
      end if;
    end if;

    if v_cost is not null then n_priced := n_priced + 1; total := total + v_cost; end if;
    update public.recipe_ingredients
       set line_cost = case when v_cost is null then 0 else round(v_cost, 4) end,
           cost_source = v_src, unit_price_eur = v_unit_price, price_id = v_price_id, cost_note = v_note
     where id = li.id;
  end loop;

  v_serv := coalesce(nullif(rec.servings,0), nullif(rec.portions,0), 1);
  if coalesce(rec.quantities_estimated,false) then any_prov := true; end if;
  update public.recipes set
    cost_total_eur = case when n_priced > 0 then round(total, 4) else null end,
    cost_per_serving_eur = case when n_priced > 0 then round(total / v_serv, 4) else null end,
    cost_per_portion_eur = case when n_priced > 0 then round(total / v_serv, 4) else null end,
    cost_coverage = case when n_lines > 0 then round(n_priced::numeric / n_lines, 3) else 0 end,
    cost_source = case when n_priced = 0 then 'none' when any_prov and any_purch then 'mixed' when any_prov then 'provisional' else 'purchase' end,
    cost_confidence = case when n_lines = 0 or n_priced = 0 then 'missing'
                           when n_priced = n_lines and not any_prov then 'high'
                           when n_priced = n_lines then 'medium'
                           when n_priced::numeric / n_lines >= 0.5 then 'low' else 'missing' end,
    cost_computed_at = now(), last_costed_at = now()
  where id = p_recipe;
  return case when n_priced > 0 then total / v_serv else null end;
end $$;

-- ── the menu: every current line, worst first ─────────────────────────────────
create or replace function public.fn_recost_menu(p_entity uuid) returns int
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare mi record; rec public.recipes; n int := 0; v_conf text; v_rest uuid;
begin
  select id into v_rest from public.restaurants where entity_id = p_entity limit 1;
  if v_rest is null then return 0; end if;
  for mi in select * from public.menu_items where restaurant_id = v_rest and is_active and coalesce(category,'') <> 'set_menu' loop
    if mi.recipe_id is null then
      update public.menu_items set cost_confidence = case when mi.recipe_match_method = 'none' then 'no_recipe' else 'unbound' end,
             computed_cost = null, food_cost_percent_actual = null, costed_at = now() where id = mi.id;
      continue;
    end if;
    perform public.fn_cost_recipe(mi.recipe_id);
    select * into rec from public.recipes where id = mi.recipe_id;
    v_conf := case when rec.cost_per_serving_eur is null then 'unbound'
                   when coalesce(rec.cost_coverage,0) < 1 then 'partial'
                   when rec.cost_source = 'purchase' and not coalesce(rec.quantities_estimated,false) then 'real'
                   else 'estimate' end;
    update public.menu_items set
      computed_cost = rec.cost_per_serving_eur,
      food_cost_percent_actual = case when mi.price > 0 and rec.cost_per_serving_eur is not null then round(rec.cost_per_serving_eur / mi.price * 100, 1) else null end,
      cost_confidence = v_conf, costed_at = now()
    where id = mi.id;
    n := n + 1;
  end loop;
  -- set menus: the sum of their unpriced courses in the same section
  for mi in select * from public.menu_items where restaurant_id = v_rest and is_active and category = 'set_menu' loop
    update public.menu_items m set
      computed_cost = s.total,
      food_cost_percent_actual = case when mi.price > 0 and s.total is not null then round(s.total / mi.price * 100, 1) else null end,
      cost_confidence = case when s.total is null then 'unbound' when s.n_unbound > 0 or s.n_partial > 0 then 'partial' when s.n_est > 0 then 'estimate' else 'real' end,
      costed_at = now()
    from (select sum(computed_cost) total,
                 count(*) filter (where cost_confidence in ('unbound')) n_unbound,
                 count(*) filter (where cost_confidence = 'partial') n_partial,
                 count(*) filter (where cost_confidence = 'estimate') n_est
            from public.menu_items c where c.restaurant_id = v_rest and c.is_active and c.section = mi.section
             and coalesce(c.category,'') <> 'set_menu' and coalesce(c.price,0) = 0 and c.recipe_match_method <> 'none') s
    where m.id = mi.id;
  end loop;
  return n;
end $$;

-- ── one entity: prices → menu → (optionally) every other recipe ───────────────
create or replace function public.fn_recost_entity(p_entity uuid, p_scope text default 'menu') returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare n_prices int; n_menu int; n_rest int := 0; r record; t0 timestamptz := clock_timestamp();
begin
  n_prices := public.fn_refresh_purchase_prices(p_entity);
  n_menu := public.fn_recost_menu(p_entity);
  if p_scope = 'all' then
    for r in select id from public.recipes where entity_id = p_entity and is_active and coalesce(is_archived,false) = false
               and id not in (select recipe_id from public.menu_items where recipe_id is not null) loop
      perform public.fn_cost_recipe(r.id); n_rest := n_rest + 1;
    end loop;
  end if;
  return jsonb_build_object('entity_id', p_entity, 'prices_refreshed', n_prices, 'menu_items', n_menu, 'other_recipes', n_rest,
                            'ms', round(extract(epoch from clock_timestamp() - t0) * 1000));
end $$;

create or replace function public.fn_recost_all() returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare out jsonb := '[]'::jsonb; e record;
begin
  for e in select id from public.entities where entity_type = 'operating_venue' and is_active loop
    out := out || public.fn_recost_entity(e.id, 'all');
  end loop;
  insert into public.cron_runs (job, triggered_by, finished_at, ok, detail) values ('recost', 'pg_cron', now(), true, out);
  return out;
end $$;

-- the page's tick: a provisional price becomes confirmed (one tap), or edited
create or replace function public.ingredient_price_confirm(p_id uuid, p_price numeric default null, p_unit text default null)
returns public.ingredient_prices
language plpgsql security invoker set search_path to 'public','pg_temp' as $$
declare row public.ingredient_prices;
begin
  update public.ingredient_prices
     set price_eur = coalesce(p_price, price_eur), unit = coalesce(p_unit, unit),
         source = 'confirmed', needs_confirm = false, confirmed_by = auth.uid(), confirmed_at = now(), updated_at = now(),
         note = coalesce(note,'') || case when p_price is not null then ' · set by hand ' || to_char(now(),'DD-MM') else ' · confirmed ' || to_char(now(),'DD-MM') end
   where id = p_id returning * into row;
  return row;
end $$;

grant execute on function public.fn_recost_entity(uuid, text) to authenticated;
grant execute on function public.fn_cost_recipe(uuid, int) to authenticated;
grant execute on function public.ingredient_price_confirm(uuid, numeric, text) to authenticated;
revoke execute on function public.fn_recost_all() from public, anon, authenticated;

-- nightly at 03:40 Europe/Madrid-ish (01:40 UTC in summer): Vercel Hobby cron slots are full
select cron.unschedule(jobid) from cron.job where jobname = 'recost_nightly';
select cron.schedule('recost_nightly', '40 1 * * *', $$select public.fn_recost_all()$$);
