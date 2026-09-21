-- Extend apply_page_info so /apply/[slug] can theme itself from brand_kits.
-- Adds `brand_kit` (palette + typography) alongside the existing accent.
--
-- Also flip BM's entities.accent_color from the terracotta #9A3122 (which
-- contradicts the Bistro Mondo brand book) to Mondo Emerald #1E6B54. Boris
-- approved 2026-09-21.
update public.entities set accent_color = '#1E6B54'
 where slug = 'bm' and accent_color <> '#1E6B54';

create or replace function public.apply_page_info(p_slug text)
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'id', e.id,
    'name', e.name,
    'legal_name', coalesce(e.legal_name, e.name),
    'accent', e.accent_color,
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
