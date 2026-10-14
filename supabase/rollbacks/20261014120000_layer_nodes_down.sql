-- =============================================================================
-- ROLLBACK de la Fase 1 del árbol de capas (20261014120000/100/200)
-- =============================================================================
-- Quita todo lo que crearon las tres migraciones. Las tablas heredadas
-- (territorial_layer_groups, territorial_layers, territorial_features,
-- folder_layer_roles, custom_layers) NO se tocan, salvo que se suelta la columna
-- derivada `territorial_features.geom` y la FK territorial_layers_node_fk.
--
-- Solo es seguro MIENTRAS el árbol sea una copia de lo heredado (hasta la Fase
-- 3). Si ya hay nodos creados en el árbol nuevo (carpetas o capas que no existen
-- en territorial_*), se pierden al soltar layer_nodes: por eso aborta si los
-- encuentra. Para forzarlo a sabiendas:  set local layer_nodes.force_down = 'on';
--
-- Se conservan las copias _backup_territorial_*_v1_20261014 (guardrails §3:
-- los respaldos no se borran en un rollback; se retiran a mano más adelante).
-- =============================================================================

select pg_advisory_xact_lock(hashtext('layer_nodes_v1'));
set local statement_timeout = '5min';

do $$
declare v_extra int;
begin
  if to_regclass('public.layer_nodes') is not null
     and coalesce(current_setting('layer_nodes.force_down', true), '') <> 'on' then
    select count(*) into v_extra
      from public.layer_nodes n
     where not exists (select 1 from public.territorial_layer_groups g where g.id = n.id)
       and not exists (select 1 from public.territorial_layers t where t.id = n.id);
    if v_extra > 0 then
      raise exception 'Guardrail: % nodos del árbol no existen en territorial_*; soltar layer_nodes los perdería. Para forzar: set local layer_nodes.force_down = ''on''', v_extra;
    end if;
  end if;
end $$;

insert into public._migration_log (sprint, notes) values ('layer_nodes_v1_down', 'start');

-- Cron
do $$
begin
  if exists (select 1 from cron.job where jobname = 'purge-archived-layer-nodes') then
    perform cron.unschedule('purge-archived-layer-nodes');
  end if;
end $$;

-- Vista, puente viejo -> nuevo y FK de detalle
drop view if exists public.territorial_layers_active;
drop trigger if exists trg_legacy_group_to_node on public.territorial_layer_groups;
drop trigger if exists trg_legacy_layer_before_insert on public.territorial_layers;
drop trigger if exists trg_legacy_layer_after on public.territorial_layers;
alter table public.territorial_layers drop constraint if exists territorial_layers_node_fk;

drop function if exists public.trg_legacy_group_to_node();
drop function if exists public.trg_legacy_layer_before_insert();
drop function if exists public.trg_legacy_layer_after();
drop function if exists public.sync_layer_nodes_from_legacy(boolean);
drop function if exists public._legacy_group_style(public.territorial_layer_groups);
drop function if exists public._legacy_layer_style(public.territorial_layers);

-- PostGIS
drop trigger if exists trg_territorial_features_set_geom on public.territorial_features;
drop index if exists public.idx_territorial_features_geom;
alter table public.territorial_features drop column if exists geom;
drop function if exists public.territorial_features_set_geom();
drop function if exists public._geojson_point_fast(jsonb);
drop function if exists public.geojson_to_geom(jsonb);

-- RPC y helpers
drop function if exists public.move_node(uuid, uuid, uuid, uuid);
drop function if exists public.rename_node(uuid, text);
drop function if exists public.archive_node(uuid);
drop function if exists public.restore_node(uuid);
drop function if exists public.set_node_visibility(uuid, boolean);
drop function if exists public.purge_archived_layer_nodes(int, int);
drop function if exists public._layer_nodes_rebalance(uuid);
drop function if exists public._layer_nodes_next_position(uuid);
drop function if exists public._layer_nodes_can_edit(text, uuid);

-- Tablas del árbol (layer_node_visibility depende de layer_nodes)
drop table if exists public.layer_node_visibility;
drop table if exists public.layer_node_purge_log;
drop table if exists public.layer_nodes;
drop function if exists public.layer_nodes_guard();

-- Índice fraccional
drop function if exists public.generate_key_between(text, text);
drop function if exists public._fi_decrement_integer(text);
drop function if exists public._fi_increment_integer(text);
drop function if exists public._fi_midpoint(text, text);
drop function if exists public._fi_validate_key(text);
drop function if exists public._fi_integer_part(text);
drop function if exists public._fi_validate_integer(text);
drop function if exists public._fi_integer_length(text);

insert into public._migration_log (sprint, notes) values ('layer_nodes_v1_down', 'done');
