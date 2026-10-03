-- S6b (2026-10-02): the controller block of the privacy notice, per house (entity slug or a restaurant's public_slug).
-- Service-role only (same P0-8 model as apply_page_legal): /legal/privacy renders it
-- server-side; the browser never gets an API that returns a tax id.
create or replace function public.privacy_page_controller(p_slug text)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'slug', e.slug, 'name', e.name, 'legal_name', coalesce(e.legal_name, e.name), 'tax_id', e.tax_id,
    'address', nullif(concat_ws(', ', e.address_line1, nullif(concat_ws(' ', e.postal_code, e.city), ''), e.country_code), ''),
    'entity_type', e.entity_type)
  from public.entities e
  where (e.slug = p_slug or e.id in (select r.entity_id from public.restaurants r where r.public_slug = p_slug))
    and coalesce(e.is_active, true)
  limit 1;
$$;
revoke all on function public.privacy_page_controller(text) from public, anon, authenticated;
grant execute on function public.privacy_page_controller(text) to service_role;
