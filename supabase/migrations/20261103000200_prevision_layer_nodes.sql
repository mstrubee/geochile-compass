-- =============================================================================
-- PROPUESTA (NO APLICADA) — Salud, Fase 1b (3/3): las dos capas de previsión en el árbol, dentro de la carpeta «Salud»
-- =============================================================================
--   Isapre: beneficiarios por comuna              renderer choropleth_isapre     dataset isapre_cartera   (coropleta + filtros; valor por comuna como RANGO si hay celdas suprimidas)
--   Previsión regional (CASEN, estimada)          renderer panel_casen_region    dataset casen_prevision  (SOLO panel: no pinta comunas, D6)
-- Ambas nacen con client_ready = false («pendiente de revisión del dueño», regla 6; mismo procedimiento que 1a, docs/salud/RUNBOOK_1A.md §5).
--
-- APLICAR DESPUÉS de desplegar el front que sabe pintarlas (mismo criterio que 20261102000100). Requiere 20261102000100 (carpeta «Salud», thematic_layers.client_ready),
-- 20261103000000 y 20261103000100. Las hojas nacen insertando en territorial_layers (el trigger legacy crea el nodo).
-- Rollback: supabase/rollbacks/20261103000200_prevision_layer_nodes_down.sql
-- =============================================================================

select pg_advisory_xact_lock(hashtext('layer_nodes_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('prevision_layer_nodes_v1', 'start');

do $$
begin
  if to_regclass('public.isapre_cartera_celda') is null or to_regclass('public.casen_prevision_region') is null then
    raise exception 'Guardrail: faltan 20261103000000 (isapre_cartera) y/o 20261103000100 (casen_prevision); aplicarlas primero';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'thematic_layers' and column_name = 'client_ready') then
    raise exception 'Guardrail: falta 20261102000100 (thematic_layers.client_ready); aplicarla primero';
  end if;
  if not exists (select 1 from public.layer_nodes where kind = 'folder' and parent_id is null and scope = 'shared' and style ->> 'slug' = 'salud') then
    raise exception 'Guardrail: no existe la carpeta «Salud» (20261102000100)';
  end if;
end $$;

drop table if exists pg_temp._prev_nodes_before;
create temp table _prev_nodes_before on commit drop as
  select 'territorial_features'::text as t, count(*)::bigint as n from public.territorial_features
  union all select 'thematic_other', count(*) from public.thematic_layers where renderer not in ('choropleth_isapre', 'panel_casen_region');

alter table public.thematic_layers drop constraint if exists thematic_layers_renderer_check;
alter table public.thematic_layers add constraint thematic_layers_renderer_check
  check (renderer in ('choropleth_comuna', 'points_projects', 'points_permits', 'polygons_crf', 'points_health', 'choropleth_health', 'choropleth_isapre', 'panel_casen_region'));

do $$
declare v_root uuid; v_layer uuid; r record;
begin
  select id into v_root from public.layer_nodes where kind = 'folder' and parent_id is null and scope = 'shared' and style ->> 'slug' = 'salud';
  for r in
    select * from (values
      ('Isapre: beneficiarios por comuna',        '#8b5cf6', 'users',    'choropleth_isapre',   'isapre_cartera',  '{"source_key":"superdesalud_isapre_cartera_comunal"}'::jsonb),
      ('Previsión regional (CASEN, estimada)',    '#06b6d4', 'bar-chart-3', 'panel_casen_region', 'casen_prevision', '{"source_key":"mds_casen_2024_nacional"}'::jsonb)
    ) as t(name, color, icon, renderer, dataset, params)
  loop
    select t.id into v_layer from public.territorial_layers t where t.group_id = v_root and t.name = r.name;
    if v_layer is null then
      insert into public.territorial_layers (group_id, name, color, icon) values (v_root, r.name, r.color, r.icon) returning id into v_layer;
    end if;
    insert into public.thematic_layers (layer_id, renderer, dataset, default_params, client_ready, client_ready_note)
    values (v_layer, r.renderer, r.dataset, r.params, false,
            'Pendiente de revisión del dueño (regla 6): licencia de la fuente sin confirmar' ||
            case r.renderer when 'choropleth_isapre' then '; información provisional y semántica de la comuna no declarada; conteos de 1 a 4 suprimidos.'
                            else '; estimación regional con error muestral (nunca comunal).' end)
    on conflict (layer_id) do nothing;
  end loop;
end $$;

do $$
declare v_nodes int;
begin
  if (select count(*) from public.thematic_layers where renderer in ('choropleth_isapre', 'panel_casen_region')) <> 2 then
    raise exception 'Guardrail: se esperaban exactamente 2 capas temáticas de previsión';
  end if;
  if (select count(*) from public.territorial_features) <> (select n from _prev_nodes_before where t = 'territorial_features') then raise exception 'Guardrail: cambió territorial_features'; end if;
  if (select count(*) from public.thematic_layers where renderer not in ('choropleth_isapre', 'panel_casen_region')) <> (select n from _prev_nodes_before where t = 'thematic_other') then
    raise exception 'Guardrail: cambió el número de otras capas temáticas';
  end if;
  select count(*) into v_nodes from public.layer_nodes n
   where n.id in (select layer_id from public.thematic_layers where renderer in ('choropleth_isapre', 'panel_casen_region')) and n.kind = 'layer' and n.archived_at is null
     and n.parent_id = (select id from public.layer_nodes where kind = 'folder' and parent_id is null and style ->> 'slug' = 'salud');
  if v_nodes <> 2 then raise exception 'Guardrail: las hojas de previsión no quedaron en el árbol (nodos encontrados: %)', v_nodes; end if;
end $$;

insert into public._migration_log (sprint, notes) values ('prevision_layer_nodes_v1', 'done');
