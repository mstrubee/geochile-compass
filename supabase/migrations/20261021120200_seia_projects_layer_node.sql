-- =============================================================================
-- PROPUESTA (NO APLICADA) — Proyectos puntuales del SEIA, parte 3/3: hoja en el árbol de capas
-- =============================================================================
-- Requiere 20261021120000/20261021120100 y la migración 20261020120200 (thematic_layers).
-- APLICAR DESPUÉS de desplegar el front con ProyectosHost: antes de ese despliegue la hoja
-- aparecería en el árbol sin que el mapa sepa pintarla (mismo criterio que permits_layer_node).
--
-- La hoja "Proyectos SEIA" es PROPIA del SEIA y cuelga de "Edificación y expansión urbana" (se busca por slug;
-- si la carpeta aún no existe se crea igual que lo hace la migración de permisos, así el orden entre ramas no importa).
-- Se marca en thematic_layers con renderer 'points_projects' y dataset 'seia_projects': ProyectosHost elige el
-- componente por ESE dataset. Otra fuente de puntos (p. ej. INE) agrega su propia hoja y su propio dataset.
--
-- default_params.typology: tipologías con que la capa NACE filtrada. Es un dato (editable por un admin), no código. Cada valor
--   es un código ('h.1') o un GRUPO ('g' = g, g.1…g.4): el panel lo expande con los códigos que EXISTEN en los datos.
--   Valor inicial ['g', 'h.1'] = desarrollo urbano/turístico (g.*) + proyectos inmobiliarios (h.1), según el sondeo real del
--   2026-10-17 (docs/proyectos-parte4/HALLAZGOS_SONDEO.md en feat/proyectos-parte4). EXCLUYE h.2 (industriales) y h.3-h.6
--   (planes de ordenamiento: no son obras). OJO: h.1 incluye proyectos NO residenciales (fábricas, centros comerciales).
--   Es una decisión editable; el panel muestra el filtro activo y permite pasar a "todas".
--
-- Rollback: supabase/rollbacks/20261021120200_seia_projects_layer_node_down.sql
-- =============================================================================

select pg_advisory_xact_lock(hashtext('layer_nodes_v1'));   -- mismo lock que las demás migraciones del árbol
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('seia_projects_layer_node_v1', 'start');

do $$
begin
  if to_regclass('public.seia_projects') is null then
    raise exception 'Guardrail: faltan las tablas del SEIA (20261021120000); aplicarlas primero';
  end if;
  if to_regclass('public.thematic_layers') is null then
    raise exception 'Guardrail: falta thematic_layers (20261020120200_permits_layer_node); aplicarla primero';
  end if;
end $$;

create temp table _seia_counts_before on commit drop as
  select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
  union all select 'territorial_features', count(*) from public.territorial_features
  union all select 'thematic_layers', count(*) from public.thematic_layers;

do $$
declare v_root uuid; v_layer uuid;
begin
  -- carpeta raíz (se busca por slug, no por nombre: guardrail §1). La comparte con "Permisos de edificación".
  select id into v_root from public.layer_nodes
   where kind = 'folder' and parent_id is null and scope = 'shared' and style ->> 'slug' = 'edificacion_expansion';
  if v_root is null then
    insert into public.layer_nodes (parent_id, kind, name, position, style, scope)
    values (null, 'folder', 'Edificación y expansión urbana', public._layer_nodes_next_position(null),
            jsonb_build_object('slug', 'edificacion_expansion', 'color', '#0ea5e9', 'icon', 'building-2', 'visible_default', false),
            'shared')
    returning id into v_root;
  end if;

  -- hoja: detalle en territorial_layers; el trigger legacy crea el nodo
  select t.id into v_layer from public.territorial_layers t where t.group_id = v_root and t.name = 'Proyectos SEIA';
  if v_layer is null then
    insert into public.territorial_layers (group_id, name, color, icon)
    values (v_root, 'Proyectos SEIA', '#f97316', 'map-pin')
    returning id into v_layer;
  end if;

  insert into public.thematic_layers (layer_id, renderer, dataset, default_params)
  values (v_layer, 'points_projects', 'seia_projects',
          jsonb_build_object('source_keys', jsonb_build_array('seia_proyectos_eia', 'seia_proyectos_dia'),
                             'typology', jsonb_build_array('g', 'h.1')))
  on conflict (layer_id) do nothing;
end $$;

do $$
declare v_nodes int;
begin
  if (select count(*) from public.territorial_features) <> (select n from _seia_counts_before where t = 'territorial_features') then
    raise exception 'Guardrail: cambió territorial_features';
  end if;
  select count(*) into v_nodes from public.layer_nodes n
   where n.id in (select layer_id from public.thematic_layers where dataset = 'seia_projects')
     and n.kind = 'layer' and n.archived_at is null
     and n.parent_id = (select id from public.layer_nodes where kind = 'folder' and parent_id is null and style ->> 'slug' = 'edificacion_expansion');
  if v_nodes <> 1 then
    raise exception 'Guardrail: la hoja "Proyectos SEIA" no quedó en el árbol (nodos encontrados: %)', v_nodes;
  end if;
end $$;

insert into public._migration_log (sprint, notes) values ('seia_projects_layer_node_v1', 'done');
