-- Menu-first loop, slice 4 — one tap: "the quantities on this recipe are right".
-- Clears quantities_estimated on the canonical and its mirrors (security
-- definer: the mirror guard refuses direct edits); the caller re-costs the menu.
create or replace function public.recipe_quantities_confirm(p_recipe uuid) returns int
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_canon uuid; n int;
begin
  if auth.uid() is not null and not exists (select 1 from public.recipes where id = p_recipe) then
    raise exception 'recipe % not visible', p_recipe;
  end if;
  select coalesce(origin_recipe_id, id) into v_canon from public.recipes where id = p_recipe;
  perform set_config('app.recipe_sync', 'on', true);
  update public.recipes set quantities_estimated = false,
         metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('quantities_confirmed_at', now(), 'quantities_confirmed_by', auth.uid())
   where id = v_canon or origin_recipe_id = v_canon;
  get diagnostics n = row_count;
  perform set_config('app.recipe_sync', 'off', true);
  return n;
end $$;
grant execute on function public.recipe_quantities_confirm(uuid) to authenticated;
