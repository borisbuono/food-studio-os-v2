-- Legally complete privacy notice on /apply/[slug]: return the entity's CIF
-- (tax_id), registered address and country so the consent step can show a
-- proper "Responsable / CIF / Domicilio / Contacto / Plazo" block. The apply
-- page blocks the submit button when tax_id or address_line1 is null so we
-- never accept an application without a valid controller notice.
create or replace function public.apply_page_info(p_slug text)
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'id', e.id,
    'name', e.name,
    'legal_name', coalesce(e.legal_name, e.name),
    'accent', e.accent_color,
    'tax_id', e.tax_id,
    'address_line1', e.address_line1,
    'city', e.city,
    'postal_code', e.postal_code,
    'country', e.country,
    'brand_kit', (select jsonb_build_object(
                    'palette', bk.palette,
                    'typography', bk.typography)
                  from public.brand_kits bk where bk.entity_id = e.id),
    'openings', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'title', o.title, 'station', o.station,
                  'role', o.role, 'languages_required', o.languages_required) order by o.created_at desc)
                  from public.job_openings o where o.entity_id = e.id and o.status = 'open'), '[]'::jsonb))
  from public.entities e
  where e.slug = p_slug and coalesce(e.hiring_enabled, true) and coalesce(e.is_active, true);
$$;
revoke all on function public.apply_page_info(text) from public;
grant execute on function public.apply_page_info(text) to anon, authenticated;
