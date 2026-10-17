-- =============================================================================
-- PROPUESTA (NO APLICADA) — Parte 4, 4/4: las tres capas en el árbol, dentro de "Edificación y expansión urbana"
-- =============================================================================
--   Permisos georreferenciados (INE)                 renderer points_permits   dataset ine_permit_points
--   Recepciones finales (INE)                        renderer polygons_crf     dataset ine_crf
--   Proyectos SEIA (inmobiliarios y urbanos)         renderer points_projects  dataset building_projects
--
-- APLICAR DESPUÉS de desplegar el front que sabe pintarlas (mismo criterio que 20261020120200_permits_layer_node):
-- antes de eso la capa aparecería en el árbol sin que el mapa sepa qué hacer con ella.
-- Requiere 20261020120200_permits_layer_node (carpeta + thematic_layers) y las tres migraciones de datos de la Parte 4.
-- Las hojas nacen insertando en territorial_layers (el trigger legacy crea el nodo), como la capa MINVU.
-- Rollback: supabase/rollbacks/20261021120300_projects_layer_nodes_down.sql
-- =============================================================================

select pg_advisory_xact_lock(hashtext('layer_nodes_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('projects_layer_nodes_v1', 'start');

do $$
begin
  if to_regclass('public.thematic_layers') is null then
    raise exception 'Guardrail: falta 20261020120200_permits_layer_node (thematic_layers); aplicarla primero';
  end if;
  if to_regclass('public.ine_pe_points') is null or to_regclass('public.ine_crf_polygons') is null or to_regclass('public.building_projects') is null then
    raise exception 'Guardrail: faltan las migraciones de datos de la Parte 4 (INE PE, INE CRF, SEIA)';
  end if;
  if not exists (select 1 from public.layer_nodes where kind = 'folder' and parent_id is null and scope = 'shared'
                  and style ->> 'slug' = 'edificacion_expansion') then
    raise exception 'Guardrail: no existe la carpeta edificacion_expansion (20261020120200)';
  end if;
end $$;

create temp table _p4_counts_before on commit drop as
  select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
  union all select 'territorial_layers', count(*) from public.territorial_layers
  union all select 'territorial_features', count(*) from public.territorial_features;

-- los renderers permitidos crecen (la restricción original solo conocía dos)
alter table public.thematic_layers drop constraint if exists thematic_layers_renderer_check;
alter table public.thematic_layers add constraint thematic_layers_renderer_check
  check (renderer in ('choropleth_comuna', 'points_projects', 'points_permits', 'polygons_crf'));

do $$
declare v_root uuid; v_layer uuid; r record;
begin
  select id into v_root from public.layer_nodes
   where kind = 'folder' and parent_id is null and scope = 'shared' and style ->> 'slug' = 'edificacion_expansion';

  for r in
    select * from (values
      ('Permisos georreferenciados (INE)',             '#f97316', 'map-pin',     'points_permits',  'ine_permit_points',
        '{"source_key":"ine_pe_nacional","min_precision":2}'::jsonb),
      ('Recepciones finales (INE)',                    '#10b981', 'badge-check', 'polygons_crf',    'ine_crf',
        '{"source_key":"ine_crf_nacional"}'::jsonb),
      ('Proyectos SEIA (inmobiliarios y urbanos)',     '#8b5cf6', 'landmark',    'points_projects', 'building_projects',
        '{"source_keys":["seia_proyectos_eia","seia_proyectos_dia"],"states":["Aprobado","En Calificación"]}'::jsonb)
    ) as t(name, color, icon, renderer, dataset, params)
  loop
    select t.id into v_layer from public.territorial_layers t where t.group_id = v_root and t.name = r.name;
    if v_layer is null then
      insert into public.territorial_layers (group_id, name, color, icon) values (v_root, r.name, r.color, r.icon) returning id into v_layer;
    end if;
    insert into public.thematic_layers (layer_id, renderer, dataset, default_params)
    values (v_layer, r.renderer, r.dataset, r.params)
    on conflict (layer_id) do nothing;
  end loop;
end $$;

do $$
begin
  if (select count(*) from public.thematic_layers where renderer in ('points_permits', 'polygons_crf', 'points_projects')) <> 3 then
    raise exception 'Guardrail: se esperaban exactamente 3 capas temáticas nuevas';
  end if;
  if (select count(*) from public.territorial_features) <> (select n from _p4_counts_before where t = 'territorial_features') then
    raise exception 'Guardrail: cambió territorial_features';
  end if;
end $$;

insert into public._migration_log (sprint, notes) values ('projects_layer_nodes_v1', 'done');
