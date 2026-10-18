-- =============================================================================
-- Pruebas de 20261103000200_prevision_layer_nodes.sql y de los rollbacks de 1b. NO es una migración. Receta (una transacción que termina en error):
--   <1a: 20261102000000, 20261102000100> <1b: 20261103000000, 20261103000100, 20261103000200 (dos veces)> <este archivo>
--   <rollbacks en orden inverso, dos veces cada uno>  \i supabase/tests/prevision_rollback_check.sql  <migraciones otra vez>
--   do $$ begin raise exception 'DRYRUN_OK %', (select count(*) from _tr); end $$;
-- =============================================================================
create temp table _tr (seq serial primary key, name text not null);
grant all on _tr to public;
grant all on sequence _tr_seq_seq to public;
create or replace function pg_temp.assert_that(p_name text, p_cond boolean, p_detail text default null) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL [%]: %', p_name, coalesce(p_detail, 'condición falsa'); end if;
  insert into _tr (name) values (p_name);
end $$;
create or replace function pg_temp.try_sql(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'OK'; exception when others then return sqlstate || ':' || sqlerrm; end $$;

create temp table _before as
  select 'territorial_features'::text as t, count(*)::bigint as n from public.territorial_features
  union all select 'thematic_non_prevision', count(*) from public.thematic_layers where renderer not in ('choropleth_isapre', 'panel_casen_region')
  union all select 'layer_nodes_non_prevision', count(*) from public.layer_nodes where id not in (select layer_id from public.thematic_layers where renderer in ('choropleth_isapre', 'panel_casen_region'))
  union all select 'salud_folder', count(*) from public.layer_nodes where style ->> 'slug' = 'salud';

select pg_temp.assert_that('las dos capas de previsión existen con renderers PROPIOS, nacen client_ready = false con nota, y no reutilizan choropleth_comuna',
  (select count(*) from public.thematic_layers where renderer in ('choropleth_isapre', 'panel_casen_region') and client_ready is false and client_ready_note like 'Pendiente%') = 2
  and (select count(*) from public.thematic_layers where renderer = 'choropleth_comuna' and dataset in ('isapre_cartera', 'casen_prevision')) = 0);
select pg_temp.assert_that('cuelgan de la carpeta raíz «Salud» (la de 1a), junto a las dos de establecimientos',
  (select count(*) from public.layer_nodes n where n.kind = 'layer' and n.parent_id = (select id from public.layer_nodes where kind = 'folder' and parent_id is null and style ->> 'slug' = 'salud')) = 4);
select pg_temp.assert_that('el CHECK admite los ocho renderers y rechaza uno desconocido',
  (select count(*) from pg_constraint where conrelid = 'public.thematic_layers'::regclass and conname = 'thematic_layers_renderer_check'
      and pg_get_constraintdef(oid) like '%choropleth_isapre%' and pg_get_constraintdef(oid) like '%panel_casen_region%' and pg_get_constraintdef(oid) like '%points_health%') = 1
  and pg_temp.try_sql($$update public.thematic_layers set renderer = 'otro' where renderer = 'panel_casen_region'$$) like '23514%');
select pg_temp.assert_that('las capas que ya existían (incluidas las de establecimientos) NO cambian: client_ready de las de 1a sigue en false y el resto en NULL',
  (select count(*) from public.thematic_layers where renderer in ('points_health', 'choropleth_health') and client_ready is false) = 2
  and (select count(*) from public.thematic_layers where renderer not in ('points_health', 'choropleth_health', 'choropleth_isapre', 'panel_casen_region') and client_ready is not null) = 0);
