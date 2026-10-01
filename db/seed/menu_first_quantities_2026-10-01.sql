-- Menu-first loop 2026-10-01 — estimated per-portion quantities for the menu
-- shells (the 09-21 backfill wrote component NAMES only). Every recipe touched
-- here gets quantities_estimated = true and needs_boris_review = true; the
-- margin page shows them as "estimate" until Boris confirms. Written to the
-- CANONICAL (Holdings) row; the mirror sync copies lines to BM / Taller.
-- Lines: (venue slug, menu item, ingredient, qty, unit, sub-recipe canonical name or null)
begin;
create temp table qplan (slug text, item text, ing text, qty numeric, unit text, sub text, ord int) on commit drop;
insert into qplan (slug,item,ing,qty,unit,sub,ord) values
-- ── Bistro Mondo · breakfast ──
('bm','Açaí bowl','açaí',100,'g',null,1),('bm','Açaí bowl','banana',1,'pcs',null,2),('bm','Açaí bowl','granola',40,'g',null,3),('bm','Açaí bowl','fresh fruit',80,'g',null,4),
('bm','Avocado toast','sourdough bread',80,'g',null,1),('bm','Avocado toast','avocado',100,'g',null,2),('bm','Avocado toast','ricotta',40,'g',null,3),('bm','Avocado toast','chilli flakes',1,'g',null,4),('bm','Avocado toast','pickled onion',15,'g',null,5),
('bm','Croissant','croissant (frozen, 70 g)',1,'pcs',null,1),
('bm','Eggs plate','eggs',2,'pcs',null,1),('bm','Eggs plate','mixed salad',40,'g',null,2),('bm','Eggs plate','tomato',60,'g',null,3),
('bm','Fruit plate','fresh fruit',300,'g',null,1),
('bm','Jamón Ibérico & Manchego toast','Iberian ham',40,'g',null,1),('bm','Jamón Ibérico & Manchego toast','manchego',40,'g',null,2),('bm','Jamón Ibérico & Manchego toast','tomato',60,'g',null,3),('bm','Jamón Ibérico & Manchego toast','sourdough bread',80,'g',null,4),
('bm','Manchego toast','sourdough bread',80,'g',null,1),('bm','Manchego toast','manchego',50,'g',null,2),('bm','Manchego toast','tomato',60,'g',null,3),('bm','Manchego toast','rocket',15,'g',null,4),
('bm','Pain au chocolat','pain au chocolat (frozen)',1,'pcs',null,1),
('bm','Pancakes','pancake batter',1,'pcs','MASA PARA PANCAKE',1),('bm','Pancakes','fresh fruit',60,'g',null,2),('bm','Pancakes','ice cream',50,'g',null,3),('bm','Pancakes','maple syrup',30,'ml',null,4),('bm','Pancakes','icing sugar',5,'g',null,5),
('bm','Prosciutto cotto toast','cooked ham',50,'g',null,1),('bm','Prosciutto cotto toast','tomato',60,'g',null,2),('bm','Prosciutto cotto toast','mixed salad',30,'g',null,3),('bm','Prosciutto cotto toast','sourdough bread',80,'g',null,4),
('bm','Ricotta toast','ricotta',60,'g',null,1),('bm','Ricotta toast','tomato jam',30,'g',null,2),('bm','Ricotta toast','rocket',15,'g',null,3),('bm','Ricotta toast','basil',3,'g',null,4),('bm','Ricotta toast','sourdough bread',80,'g',null,5),
('bm','Rye bread','rye bread',100,'g',null,1),('bm','Rye bread','butter',15,'g',null,2),('bm','Rye bread','jam',30,'g',null,3),
('bm','Sourdough rustic bread','sourdough bread',100,'g',null,1),('bm','Sourdough rustic bread','butter',15,'g',null,2),('bm','Sourdough rustic bread','jam',30,'g',null,3),
('bm','Toast bread','toast bread',80,'g',null,1),('bm','Toast bread','butter',15,'g',null,2),('bm','Toast bread','jam',30,'g',null,3),
('bm','Greek yogurt','greek yogurt',150,'g',null,1),('bm','Greek yogurt','fresh fruit',60,'g',null,2),('bm','Greek yogurt','granola',30,'g',null,3),('bm','Greek yogurt','honey',15,'g',null,4),
-- ── cocktails · softs · house spirits ──
('bm','Caipirinha','cachaça',50,'ml',null,1),('bm','Caipirinha','lime',1,'pcs',null,2),('bm','Caipirinha','sugar',15,'g',null,3),
('bm','Mojito','white rum',50,'ml',null,1),('bm','Mojito','lime',1,'pcs',null,2),('bm','Mojito','mint',5,'g',null,3),('bm','Mojito','sugar',15,'g',null,4),('bm','Mojito','soda water',100,'ml',null,5),
('bm','Negroni','gin',30,'ml',null,1),('bm','Negroni','Campari',30,'ml',null,2),('bm','Negroni','vermouth rosso',30,'ml',null,3),('bm','Negroni','orange',0.1,'pcs',null,4),
('bm','Bellini','cava',100,'ml',null,1),('bm','Bellini','peach juice',50,'ml',null,2),
('bm','Bloody / Mezcal Mary','vodka',50,'ml',null,1),('bm','Bloody / Mezcal Mary','tomato juice',120,'ml',null,2),('bm','Bloody / Mezcal Mary','spices',3,'g',null,3),('bm','Bloody / Mezcal Mary','lemon',0.25,'pcs',null,4),
('bm','Combinados','spirit',50,'ml',null,1),('bm','Combinados','mixer',200,'ml',null,2),
('bm','Premium Combinados','premium spirit',50,'ml',null,1),('bm','Premium Combinados','mixer',200,'ml',null,2),
('bm','Mezcal Mule','mezcal',50,'ml',null,1),('bm','Mezcal Mule','lime juice',20,'ml',null,2),('bm','Mezcal Mule','ginger beer',150,'ml',null,3),
('bm','Mimosa','cava',100,'ml',null,1),('bm','Mimosa','orange juice',60,'ml',null,2),
('bm','Green','kale',60,'g',null,1),('bm','Green','celery',80,'g',null,2),('bm','Green','lime',0.5,'pcs',null,3),('bm','Green','cucumber',120,'g',null,4),
('bm','SunRise','orange',2,'pcs',null,1),('bm','SunRise','carrot',100,'g',null,2),('bm','SunRise','pineapple',120,'g',null,3),
('bm','Lemongrass & ginger','lemongrass',10,'g',null,1),('bm','Lemongrass & ginger','ginger',10,'g',null,2),('bm','Lemongrass & ginger','water',250,'ml',null,3),('bm','Lemongrass & ginger','sugar',15,'g',null,4),('bm','Lemongrass & ginger','lime',0.25,'pcs',null,5),
('bm','Tepache','pineapple',60,'g',null,1),('bm','Tepache','piloncillo',30,'g',null,2),('bm','Tepache','cinnamon',1,'g',null,3),('bm','Tepache','water',300,'ml',null,4),
('bm','Sexy pomegranate','sexy pomegranate tea blend',3,'g',null,1),('bm','Sexy pomegranate','water',250,'ml',null,2),('bm','Sexy pomegranate','sugar',10,'g',null,3),
('bm','Freshly-squeezed orange','orange',4,'pcs',null,1),
('bm','Kombucha','kombucha',330,'ml',null,1),
('bm','Hierba Ibicenca','anise liqueur',50,'ml',null,1),('bm','Hierba Ibicenca','Ibizan herbs',5,'g',null,2),('bm','Hierba Ibicenca','lemon',0.1,'pcs',null,3),
('bm','Limoncello','lemon',0.5,'pcs',null,1),('bm','Limoncello','neutral alcohol 96',20,'ml',null,2),('bm','Limoncello','sugar',20,'g',null,3),('bm','Limoncello','water',20,'ml',null,4),
-- ── dessert ──
('bm','Cheesecake','cream cheese',100,'g',null,1),('bm','Cheesecake','eggs',0.5,'pcs',null,2),('bm','Cheesecake','sugar',30,'g',null,3),('bm','Cheesecake','cream',40,'ml',null,4),('bm','Cheesecake','biscuit base',30,'g',null,5),('bm','Cheesecake','red fruit compote',40,'g',null,6),
('bm','Soft ice cream','milk',80,'ml',null,1),('bm','Soft ice cream','cream',40,'ml',null,2),('bm','Soft ice cream','sugar',25,'g',null,3),('bm','Soft ice cream','egg yolk',1,'pcs',null,4),('bm','Soft ice cream','fresh fruit',20,'g',null,5),
('bm','Tart of the day','flour',40,'g',null,1),('bm','Tart of the day','butter',30,'g',null,2),('bm','Tart of the day','sugar',30,'g',null,3),('bm','Tart of the day','eggs',1,'pcs',null,4),('bm','Tart of the day','fresh fruit',80,'g',null,5),('bm','Tart of the day','cream',30,'ml',null,6),
-- ── dinner ──
('bm','Bufalina','pizza dough',1,'pcs','Pizza Dough, 48h Cold Ferment',1),('bm','Bufalina','buffalo mozzarella',125,'g',null,2),('bm','Bufalina','cherry tomato',80,'g',null,3),('bm','Bufalina','rocket',20,'g',null,4),
('bm','Margherita','pizza dough',1,'pcs','Pizza Dough, 48h Cold Ferment',1),('bm','Margherita','tomato sauce',80,'g',null,2),('bm','Margherita','mozzarella',120,'g',null,3),('bm','Margherita','basil',3,'g',null,4),
('bm','Marinara','pizza dough',1,'pcs','Pizza Dough, 48h Cold Ferment',1),('bm','Marinara','cherry tomato',100,'g',null,2),('bm','Marinara','garlic oil',10,'ml',null,3),('bm','Marinara','oregano',1,'g',null,4),
('bm','Jamón Ibérico pizza','pizza dough',1,'pcs','Pizza Dough, 48h Cold Ferment',1),('bm','Jamón Ibérico pizza','tomato sauce',80,'g',null,2),('bm','Jamón Ibérico pizza','mozzarella',120,'g',null,3),('bm','Jamón Ibérico pizza','rocket',20,'g',null,4),('bm','Jamón Ibérico pizza','parmesan',15,'g',null,5),('bm','Jamón Ibérico pizza','Iberian ham',40,'g',null,6),
('bm','Pizza of the day','pizza dough',1,'pcs','Pizza Dough, 48h Cold Ferment',1),('bm','Pizza of the day','tomato sauce',80,'g',null,2),('bm','Pizza of the day','mozzarella',120,'g',null,3),('bm','Pizza of the day','topping of the day',60,'g',null,4),
('bm','Prosciutto cotto pizza','pizza dough',1,'pcs','Pizza Dough, 48h Cold Ferment',1),('bm','Prosciutto cotto pizza','tomato sauce',80,'g',null,2),('bm','Prosciutto cotto pizza','mozzarella',120,'g',null,3),('bm','Prosciutto cotto pizza','cooked ham',60,'g',null,4),
('bm','Sobrasada','pizza dough',1,'pcs','Pizza Dough, 48h Cold Ferment',1),('bm','Sobrasada','tomato sauce',80,'g',null,2),('bm','Sobrasada','mozzarella',120,'g',null,3),('bm','Sobrasada','sobrasada',50,'g',null,4),
('bm','Chicken milanesa','chicken breast',220,'g',null,1),('bm','Chicken milanesa','breadcrumbs',40,'g',null,2),('bm','Chicken milanesa','eggs',1,'pcs',null,3),('bm','Chicken milanesa','flour',20,'g',null,4),('bm','Chicken milanesa','garnish of the day',120,'g',null,5),
('bm','Green salad','mesclun',80,'g',null,1),('bm','Green salad','ferments',20,'g',null,2),('bm','Green salad','crudités',60,'g',null,3),('bm','Green salad','chardonnay vinaigrette',20,'ml',null,4),
('bm','Pasta Pollonesa','bronze-extruded pasta',120,'g',null,1),('bm','Pasta Pollonesa','chicken ragù',180,'g',null,2),('bm','Pasta Pollonesa','parmesan',15,'g',null,3),
('bm','Pasta caponata','bronze-extruded pasta',120,'g',null,1),('bm','Pasta caponata','vegetable caponata',180,'g',null,2),('bm','Pasta caponata','parmesan',10,'g',null,3),
('bm','Rib eye','rib eye',350,'g',null,1),('bm','Rib eye','salt',3,'g',null,2),('bm','Rib eye','garnish of the day',120,'g',null,3),
('bm','Seabass','sea bass',400,'g',null,1),('bm','Seabass','organic vegetables',150,'g',null,2),('bm','Seabass','lemon',0.5,'pcs',null,3),('bm','Seabass','garlic parsley oil',15,'ml',null,4),
('bm','Buffalo mozzarella, ibérico & melon','buffalo mozzarella',125,'g',null,1),('bm','Buffalo mozzarella, ibérico & melon','Iberian ham',40,'g',null,2),('bm','Buffalo mozzarella, ibérico & melon','melon',150,'g',null,3),
-- ── snacks ──
('bm','Arancini','mushroom risotto',150,'g',null,1),('bm','Arancini','breadcrumbs',30,'g',null,2),('bm','Arancini','truffle mayo',30,'g',null,3),
('bm','Boquerones','boquerones en vinagre',80,'g',null,1),('bm','Boquerones','pickled onion',20,'g',null,2),('bm','Boquerones','herbs',2,'g',null,3),('bm','Boquerones','extra virgin olive oil',15,'ml',null,4),
('bm','Focaccia','focaccia dough',1,'pcs','Focaccia (Sourdough)',1),('bm','Focaccia','rosemary',1,'g',null,2),('bm','Focaccia','extra virgin olive oil',10,'ml',null,3),('bm','Focaccia','alioli',30,'g',null,4),
('bm','Truffle fries','potatoes',250,'g',null,1),('bm','Truffle fries','truffle mayo',40,'g',null,2),('bm','Truffle fries','frying oil',30,'ml',null,3),('bm','Truffle fries','salt',2,'g',null,4),
('bm','Tuna tartare','tuna',120,'g',null,1),('bm','Tuna tartare','avocado',60,'g',null,2),('bm','Tuna tartare','chilli',3,'g',null,3),('bm','Tuna tartare','lime',0.5,'pcs',null,4),
('bm','Chicken liver pâté','chicken liver',80,'g',null,1),('bm','Chicken liver pâté','butter',30,'g',null,2),('bm','Chicken liver pâté','shallot',15,'g',null,3),('bm','Chicken liver pâté','brandy',10,'ml',null,4),('bm','Chicken liver pâté','sourdough bread',60,'g',null,5),('bm','Chicken liver pâté','mustard',10,'g',null,6),
('bm','Grilled aubergine','aubergine',200,'g',null,1),('bm','Grilled aubergine','garlic',5,'g',null,2),('bm','Grilled aubergine','extra virgin olive oil',15,'ml',null,3),('bm','Grilled aubergine','herbs',2,'g',null,4),
('bm','Grilled courgette','courgette',200,'g',null,1),('bm','Grilled courgette','lemon',0.25,'pcs',null,2),('bm','Grilled courgette','oregano',1,'g',null,3),
('bm','Grilled peppers','red pepper',200,'g',null,1),('bm','Grilled peppers','capers',10,'g',null,2),('bm','Grilled peppers','oregano',1,'g',null,3),('bm','Grilled peppers','sherry vinegar',10,'ml',null,4),
('bm','Japanese aubergine','japanese aubergine',200,'g',null,1),('bm','Japanese aubergine','miso',20,'g',null,2),('bm','Japanese aubergine','sesame',5,'g',null,3),('bm','Japanese aubergine','mirin',15,'ml',null,4),
-- ── Taller · the Experience, per person ──
('taller','Arancini','mushroom risotto',60,'g',null,1),('taller','Arancini','breadcrumbs',10,'g',null,2),('taller','Arancini','black truffle',2,'g',null,3),
('taller','Beef','Galician blond beef',120,'g',null,1),('taller','Beef','sherry reduction',20,'ml',null,2),('taller','Beef','sweet spices',1,'g',null,3),('taller','Beef','kale',30,'g',null,4),('taller','Beef','potato millefeuille',60,'g',null,5),
('taller','Croqueta','saffron béchamel',40,'g',null,1),('taller','Croqueta','breadcrumbs',10,'g',null,2),('taller','Croqueta','alioli',10,'g',null,3),
('taller','Gambusín','small prawns',50,'g',null,1),('taller','Gambusín','alioli',10,'g',null,2),
('taller','Gazpacho','tomato consommé',80,'ml',null,1),('taller','Gazpacho','green oil',5,'ml',null,2),('taller','Gazpacho','tomato cracker',1,'pcs',null,3),
('taller','House bread','house bread',60,'g',null,1),('taller','House bread','herb butter',20,'g',null,2),('taller','House bread','dried flowers',0.5,'g',null,3),
('taller','Lemon','lemon sorbet',60,'g',null,1),('taller','Lemon','lemon oil',5,'ml',null,2),('taller','Lemon','lemon leaf',1,'pcs',null,3),('taller','Lemon','salt',0.5,'g',null,4),
('taller','Monkfish','monkfish',100,'g',null,1),('taller','Monkfish','aubergine',60,'g',null,2),('taller','Monkfish','monkfish sauce',30,'ml',null,3),('taller','Monkfish','spinach',20,'g',null,4),
('taller','Oyster','oyster',1,'pcs',null,1),('taller','Oyster','oyster foam',15,'g',null,2),('taller','Oyster','sobrasada sauce',10,'g',null,3),
('taller','Red prawn','red prawn',40,'g',null,1),('taller','Red prawn','prawn oil',5,'ml',null,2),('taller','Red prawn','prawn emulsion',15,'g',null,3),('taller','Red prawn','pollen',0.5,'g',null,4),('taller','Red prawn','edible flowers',0.5,'g',null,5),('taller','Red prawn','carrot',20,'g',null,6),
('taller','Sardine','sardine',40,'g',null,1),('taller','Sardine','toast',15,'g',null,2),('taller','Sardine','black truffle',1,'g',null,3),
('taller','Skate','skate',100,'g',null,1),('taller','Skate','tomato',40,'g',null,2),('taller','Skate','shiso',1,'g',null,3),('taller','Skate','olives',15,'g',null,4),
('taller','Strawberries','strawberry sorbet',50,'g',null,1),('taller','Strawberries','strawberries',60,'g',null,2),('taller','Strawberries','saffron',0.05,'g',null,3),('taller','Strawberries','yogurt mousse',40,'g',null,4),
('taller','Tuna','tuna',80,'g',null,1),('taller','Tuna','figs',40,'g',null,2),('taller','Tuna','greek yogurt',30,'g',null,3);

do $$
declare it record; v_item uuid; v_recipe uuid; v_canon uuid; l record; v_sub uuid; i int;
begin
  perform set_config('app.recipe_sync', 'on', true);
  for it in select distinct slug, item from qplan loop
    select mi.id, mi.recipe_id into v_item, v_recipe from menu_items mi join restaurants r on r.id = mi.restaurant_id join entities e on e.id = r.entity_id
     where e.slug = it.slug and mi.name = it.item limit 1;
    if v_recipe is null then raise exception 'unbound item % / %', it.slug, it.item; end if;
    select coalesce(origin_recipe_id, id) into v_canon from recipes where id = v_recipe;
    delete from recipe_ingredients where recipe_id = v_canon;
    i := 0;
    for l in select * from qplan q where q.slug = it.slug and q.item = it.item order by ord loop
      i := i + 1; v_sub := null;
      if l.sub is not null then
        select id into v_sub from recipes where entity_id = 'd1ee19b6-5fb4-460c-8326-685dc86e47df' and origin_recipe_id is null and name = l.sub and coalesce(is_archived,false) = false limit 1;
        if v_sub is null then raise exception 'sub-recipe not found: %', l.sub; end if;
      end if;
      insert into recipe_ingredients (recipe_id, name, ingredient_name, quantity, unit, sort_order, order_idx, sub_recipe_id, notes)
      values (v_canon, l.ing, l.ing, l.qty::text, l.unit, i, i, v_sub, 'estimated quantity — confirm');
    end loop;
    update recipes set quantities_estimated = true, servings = 1, portions = 1,
           metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('needs_boris_review', true, 'quantities_estimated_at', '2026-10-01', 'quantities_estimated_by', 'menu-first-builder'),
           updated_at = now()
     where id = v_canon;
    update recipes set quantities_estimated = true, servings = 1, portions = 1, updated_at = now() where origin_recipe_id = v_canon;
    perform fn_recipe_sync_mirror_ingredients(v_canon);
  end loop;
  perform set_config('app.recipe_sync', 'off', true);
end $$;

-- Aperol Spritz Spec: the seed reads 6 servings for one 180 ml build — cost came out at a sixth. One glass = one serving.
update recipes set servings = 1, portions = 1, metadata = coalesce(metadata,'{}'::jsonb) || '{"needs_boris_review": true, "note_2026-10-01": "servings 6→1: the lines are one glass"}'::jsonb
 where name = 'Aperol Spritz Spec' and coalesce(is_archived,false) = false;
commit;
