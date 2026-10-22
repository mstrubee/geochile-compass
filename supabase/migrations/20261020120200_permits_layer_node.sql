-- =============================================================================
-- PROPUESTA (NO APLICADA) — Permisos de edificación, parte 3/4: capa en el árbol
-- =============================================================================
-- Requiere las partes 1 y 2. APLICAR DESPUÉS de desplegar el código del front que sabe pintar
-- capas temáticas (mismo criterio que 20261015000000_retire_legacy_layer_tables.sql): antes de
-- ese despliegue, la capa aparecería en el árbol sin que el mapa sepa qué hacer con ella.
--
--   thematic_layers   marca una hoja del árbol como capa TEMÁTICA (se pinta desde una RPC, no desde
--                     territorial_features). Evita copiar 345 polígonos por cada capa coroplética.
--   Carpeta raíz "Edificación y expansión urbana" y hoja "Permisos de edificación".
--
-- La hoja se crea insertando en territorial_layers (tabla de detalle): el trigger legacy
-- trg_legacy_layer_before_insert crea el nodo de layer_nodes, igual que hace hoy el importador.
-- HIPÓTESIS A PROBAR: que el front actual tolere una capa con feature_count = 0 (ver DISENO.md §8).
--
-- Rollback: supabase/rollbacks/20261020120200_permits_layer_node_down.sql
-- =============================================================================

select pg_advisory_xact_lock(hashtext('layer_nodes_v1'));   -- mismo lock que las demás migraciones del árbol
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('permits_layer_node_v1', 'start');

do $$
begin
  if to_regclass('public.building_permit_statistics') is null then
    raise exception 'Guardrail: falta la parte 2 (permits_statistics_v1); aplicarla primero';
  end if;
end $$;

create temp table _permits_counts_before on commit drop as
  select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
  union all select 'territorial_layers', count(*) from public.territorial_layers
  union all select 'territorial_features', count(*) from public.territorial_features;

create table if not exists public.thematic_layers (
  layer_id       uuid primary key references public.territorial_layers(id) on delete cascade,
  renderer       text not null check (renderer in ('choropleth_comuna', 'points_projects')),
  dataset        text not null check (dataset ~ '^[a-z0-9_]{3,40}$'),
  default_params jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

alter table public.thematic_layers enable row level security;
drop policy if exists thematic_layers_read on public.thematic_layers;
create policy thematic_layers_read on public.thematic_layers for select to authenticated using (true);
drop policy if exists thematic_layers_write on public.thematic_layers;
create policy thematic_layers_write on public.thematic_layers for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
revoke all on public.thematic_layers from anon;
-- Data API: desde el 2026-10-30 Supabase ya no concede permisos automáticos sobre tablas nuevas de public; se declaran aquí (anon sigue sin acceso).
grant select, insert, update, delete on public.thematic_layers to authenticated;
grant all on public.thematic_layers to service_role;

do $$
declare v_root uuid; v_layer uuid;
begin
  -- carpeta raíz (se busca por slug, no por nombre: guardrail §1)
  select id into v_root from public.layer_nodes
   where kind = 'folder' and parent_id is null and scope = 'shared' and style ->> 'slug' = 'edificacion_expansion';
  if v_root is null then
    insert into public.layer_nodes (parent_id, kind, name, position, style, scope)
    values (null, 'folder', 'Edificación y expansión urbana', public._layer_nodes_next_position(null),
            jsonb_build_object('slug', 'edificacion_expansion', 'color', '#0ea5e9', 'icon', 'building-2', 'visible_default', false),
            'shared')
    returning id into v_root;
  end if;

  -- hoja: detalle en territorial_layers; el trigger crea el nodo
  select t.id into v_layer from public.territorial_layers t where t.group_id = v_root and t.name = 'Permisos de edificación';
  if v_layer is null then
    insert into public.territorial_layers (group_id, name, color, icon)
    values (v_root, 'Permisos de edificación', '#0ea5e9', 'building-2')
    returning id into v_layer;
  end if;

  insert into public.thematic_layers (layer_id, renderer, dataset, default_params)
  values (v_layer, 'choropleth_comuna', 'building_permits',
          jsonb_build_object('source_key', 'minvu_cedoc_permisos_anual', 'metric', 'units',
                             'destination_class', 'housing_total', 'granularity', 'year'))
  on conflict (layer_id) do nothing;
end $$;

do $$
declare v_bad text; v_nodes int;
begin
  -- solo debe haber crecido layer_nodes (+2) y territorial_layers (+1) la primera vez; features no cambia
  if (select count(*) from public.territorial_features) <> (select n from _permits_counts_before where t = 'territorial_features') then
    raise exception 'Guardrail: cambió territorial_features';
  end if;
  select count(*) into v_nodes from public.layer_nodes n
   where n.id in (select layer_id from public.thematic_layers)
     and n.kind = 'layer' and n.archived_at is null
     and n.parent_id = (select id from public.layer_nodes where kind = 'folder' and parent_id is null and style ->> 'slug' = 'edificacion_expansion');
  if v_nodes <> 1 then
    raise exception 'Guardrail: la hoja "Permisos de edificación" no quedó en el árbol (nodos encontrados: %)', v_nodes;
  end if;
end $$;

insert into public._migration_log (sprint, notes) values ('permits_layer_node_v1', 'done');
