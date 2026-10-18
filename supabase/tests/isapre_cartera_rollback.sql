-- =============================================================================
-- Pruebas del ROLLBACK 20261103000000_isapre_cartera_down.sql. NO es una migración. Receta (una transacción que termina en error):
--   \i supabase/migrations/20261103000000_isapre_cartera.sql
--   \i supabase/tests/isapre_cartera_rollback.sql                (parte A: guarda conteos y deja un snapshot cargado)
--   \i supabase/rollbacks/20261103000000_isapre_cartera_down.sql  (dos veces: idempotencia)
--   \i supabase/tests/isapre_cartera_rollback_check.sql           (parte B: comprueba)
--   \i supabase/migrations/20261103000000_isapre_cartera.sql      (se puede volver a aplicar)
--   do $$ begin raise exception 'DRYRUN_OK %', (select count(*) from _tr); end $$;
-- =============================================================================
create temp table _tr (seq serial primary key, name text not null);
grant all on _tr to public;
grant all on sequence _tr_seq_seq to public;
delete from public.source_checks where source_id in (select id from public.data_sources where source_key = 'superdesalud_isapre_cartera_comunal');
delete from public.source_snapshots where source_id in (select id from public.data_sources where source_key = 'superdesalud_isapre_cartera_comunal');
create temp table _before as
  select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
  union all select 'thematic_layers', count(*) from public.thematic_layers
  union all select 'data_sources_other', count(*) from public.data_sources where source_key <> 'superdesalud_isapre_cartera_comunal'
  union all select 'settings_other', count(*) from public.pipeline_settings where key not in ('salud.suppress_below', 'salud.min_aggregate_comunas', 'retention.keep_isapre_snapshots');
create or replace function pg_temp.assert_that(p_name text, p_cond boolean, p_detail text default null) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL [%]: %', p_name, coalesce(p_detail, 'condición falsa'); end if;
  insert into _tr (name) values (p_name);
end $$;
create or replace function pg_temp.part_b() returns void language plpgsql as $$
begin
  perform pg_temp.assert_that('el esquema restringido, las tablas publicadas y las funciones de Isapre desaparecieron, y la fuente también (no tenía capturas)',
    not exists (select 1 from pg_namespace where nspname = 'salud_restringido')
    and to_regclass('public.isapre_cartera_celda') is null and to_regclass('public.isapre_cartera_grupo') is null
    and to_regclass('public.isapre_cartera_region') is null and to_regclass('public.isapre_cartera_unidad') is null
    and not exists (select 1 from pg_proc where proname like '%isapre%' and pronamespace = 'public'::regnamespace)
    and not exists (select 1 from public.data_sources where source_key = 'superdesalud_isapre_cartera_comunal')
    and not exists (select 1 from public.pipeline_settings where key in ('salud.suppress_below', 'salud.min_aggregate_comunas', 'retention.keep_isapre_snapshots')));
  perform pg_temp.assert_that('lo que no es de la fase quedó idéntico (nodos, capas temáticas, fuentes, umbrales) y el registro de establecimientos sigue intacto',
    to_regclass('public.health_establishments') is not null and not exists (
      select 1 from _before b join (
        select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
        union all select 'thematic_layers', count(*) from public.thematic_layers
        union all select 'data_sources_other', count(*) from public.data_sources
        union all select 'settings_other', count(*) from public.pipeline_settings) a using (t) where a.n <> b.n));
end $$;
