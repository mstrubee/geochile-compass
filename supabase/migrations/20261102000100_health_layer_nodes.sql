-- =============================================================================
-- PROPUESTA (NO APLICADA) — Salud, Fase 1a: las dos capas en el árbol, dentro de la carpeta raíz «Salud»
-- =============================================================================
--   Establecimientos de salud             renderer points_health      dataset health_establishments   (puntos por bbox con filtros)
--   Establecimientos por comuna           renderer choropleth_health  dataset health_establishments   (capa derivada: conteo por comuna + ranking)
--
-- También agrega a thematic_layers la bandera client_ready (regla 6, docs/salud/DISENO.md §2.8):
--   NULL  = sin evaluar (las capas que ya existen NO cambian de comportamiento)
--   false = no entra a informes ni exportaciones (el panel lo avisa) — las dos capas de salud nacen así hasta que el dueño las apruebe
--   true  = apta para entregar a clientes
-- Los renderers de salud son PROPIOS: «choropleth_comuna» lo captura PermitsHost y pintaría salud como permisos.
--
-- APLICAR DESPUÉS de desplegar el front que sabe pintarlas (mismo criterio que 20261021120300_projects_layer_nodes): antes de eso la capa
-- aparecería en el árbol sin que el mapa sepa qué hacer con ella. Requiere 20261102000000_health_establishments y la parte 3 de permisos (thematic_layers).
-- Las hojas nacen insertando en territorial_layers (el trigger legacy crea el nodo), como la capa MINVU.
-- Rollback: supabase/rollbacks/20261102000100_health_layer_nodes_down.sql
-- =============================================================================

select pg_advisory_xact_lock(hashtext('layer_nodes_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('health_layer_nodes_v1', 'start');

do $$
begin
  if to_regclass('public.thematic_layers') is null then
    raise exception 'Guardrail: falta 20261020120200_permits_layer_node (thematic_layers); aplicarla primero';
  end if;
  if to_regclass('public.health_establishments') is null then
    raise exception 'Guardrail: falta 20261102000000_health_establishments; aplicarla primero';
  end if;
end $$;

drop table if exists pg_temp._salud_nodes_before;            -- por si la migración se aplica dos veces en la misma transacción (prueba de idempotencia)
create temp table _salud_nodes_before on commit drop as
  select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
  union all select 'territorial_layers', count(*) from public.territorial_layers
  union all select 'territorial_features', count(*) from public.territorial_features
  union all select 'thematic_layers_other', count(*) from public.thematic_layers where renderer not in ('points_health', 'choropleth_health');

alter table public.thematic_layers add column if not exists client_ready boolean;
alter table public.thematic_layers add column if not exists client_ready_note text;
comment on column public.thematic_layers.client_ready is
  'Regla 6: NULL = sin evaluar (se trata como lista, comportamiento previo); false = no entra a informes ni exportaciones; true = apta para clientes.';

-- los renderers permitidos crecen (los cuatro de permisos/proyectos + los dos de salud)
alter table public.thematic_layers drop constraint if exists thematic_layers_renderer_check;
alter table public.thematic_layers add constraint thematic_layers_renderer_check
  check (renderer in ('choropleth_comuna', 'points_projects', 'points_permits', 'polygons_crf', 'points_health', 'choropleth_health'));

do $$
declare v_root uuid; v_layer uuid; r record;
begin
  select id into v_root from public.layer_nodes
   where kind = 'folder' and parent_id is null and scope = 'shared' and style ->> 'slug' = 'salud';
  if v_root is null then
    insert into public.layer_nodes (parent_id, kind, name, position, style, scope)
    values (null, 'folder', 'Salud', public._layer_nodes_next_position(null),
            jsonb_build_object('slug', 'salud', 'color', '#ef4444', 'icon', 'heart-pulse', 'visible_default', false), 'shared')
    returning id into v_root;
  end if;

  for r in
    select * from (values
      ('Establecimientos de salud',        '#ef4444', 'hospital',   'points_health',     'health_establishments',
        '{"source_key":"deis_establecimientos","include_closed":false}'::jsonb),
      ('Establecimientos por comuna',      '#f97316', 'bar-chart-3', 'choropleth_health', 'health_establishments',
        '{"source_key":"deis_establecimientos","include_closed":false}'::jsonb)
    ) as t(name, color, icon, renderer, dataset, params)
  loop
    select t.id into v_layer from public.territorial_layers t where t.group_id = v_root and t.name = r.name;
    if v_layer is null then
      insert into public.territorial_layers (group_id, name, color, icon) values (v_root, r.name, r.color, r.icon) returning id into v_layer;
    end if;
    insert into public.thematic_layers (layer_id, renderer, dataset, default_params, client_ready, client_ready_note)
    values (v_layer, r.renderer, r.dataset, r.params, false,
            'Pendiente de revisión del dueño (regla 6): clase ambulatorio/hospitalario imputada por tabla de diseño y dos definiciones de alta complejidad.')
    on conflict (layer_id) do nothing;
  end loop;
end $$;

do $$
declare v_bad text; v_nodes int;
begin
  if (select count(*) from public.thematic_layers where renderer in ('points_health', 'choropleth_health')) <> 2 then
    raise exception 'Guardrail: se esperaban exactamente 2 capas temáticas de salud';
  end if;
  if (select count(*) from public.territorial_features) <> (select n from _salud_nodes_before where t = 'territorial_features') then
    raise exception 'Guardrail: cambió territorial_features';
  end if;
  if (select count(*) from public.thematic_layers where renderer not in ('points_health', 'choropleth_health'))
     <> (select n from _salud_nodes_before where t = 'thematic_layers_other') then
    raise exception 'Guardrail: cambió el número de capas temáticas que no son de salud';
  end if;
  select count(*) into v_nodes from public.layer_nodes n
   where n.id in (select layer_id from public.thematic_layers where renderer in ('points_health', 'choropleth_health'))
     and n.kind = 'layer' and n.archived_at is null
     and n.parent_id = (select id from public.layer_nodes where kind = 'folder' and parent_id is null and style ->> 'slug' = 'salud');
  if v_nodes <> 2 then
    raise exception 'Guardrail: las hojas de salud no quedaron en el árbol (nodos encontrados: %)', v_nodes;
  end if;
end $$;

insert into public._migration_log (sprint, notes) values ('health_layer_nodes_v1', 'done');
