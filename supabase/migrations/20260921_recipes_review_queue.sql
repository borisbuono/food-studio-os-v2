-- recipes: _review_queue (2026-09-21)
-- Boris's batch decision on seeded / drafted recipes. SECURITY INVOKER on purpose:
-- RLS + tg_recipes_guard still apply, so only an owner of the canonical's entity
-- (BBH) can flip is_public. Approve = reviewed + published (if it was a public
-- candidate with a reserved slug). Discard = archived everywhere (canonical + mirrors).
create or replace function public.recipe_review_decide(p_ids uuid[], p_action text)
returns int language plpgsql security invoker set search_path = public, pg_temp as $$
declare n int := 0;
begin
  if auth.uid() is null then raise exception 'sign in required' using errcode = '42501'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then return 0; end if;
  if array_length(p_ids, 1) > 200 then raise exception 'max 200 per batch'; end if;

  if p_action = 'approve' then
    update public.recipes r
       set metadata = (r.metadata - 'needs_boris_review')
                      || jsonb_build_object('reviewed_at', now(), 'reviewed_by', auth.uid(), 'review', 'approved'),
           is_public = coalesce((r.metadata->>'public_candidate')::boolean, false) and r.public_slug is not null
     where r.id = any(p_ids) and r.origin_recipe_id is null
       and coalesce((r.metadata->>'needs_boris_review')::boolean, false);
    get diagnostics n = row_count;
  elsif p_action = 'approve_private' then
    update public.recipes r
       set metadata = (r.metadata - 'needs_boris_review')
                      || jsonb_build_object('reviewed_at', now(), 'reviewed_by', auth.uid(), 'review', 'approved_private')
     where r.id = any(p_ids) and r.origin_recipe_id is null
       and coalesce((r.metadata->>'needs_boris_review')::boolean, false);
    get diagnostics n = row_count;
  elsif p_action = 'discard' then
    update public.recipes r
       set is_archived = true, is_active = false, is_public = false,
           metadata = r.metadata || jsonb_build_object('discarded_at', now(), 'discarded_by', auth.uid(), 'review', 'discarded')
     where (r.id = any(p_ids) and r.origin_recipe_id is null)
        or r.origin_recipe_id = any(p_ids);
    get diagnostics n = row_count;
  elsif p_action = 'unpublish' then
    update public.recipes r set is_public = false
     where r.id = any(p_ids) and r.origin_recipe_id is null and r.is_public;
    get diagnostics n = row_count;
  else
    raise exception 'unknown action %', p_action;
  end if;
  return n;
end $$;
revoke all on function public.recipe_review_decide(uuid[], text) from public, anon;
grant execute on function public.recipe_review_decide(uuid[], text) to authenticated;
