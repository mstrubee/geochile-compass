-- =============================================================================
-- Pruebas de los ROLLBACKS 20261102000100_health_layer_nodes_down.sql y 20261102000000_health_establishments_down.sql. NO es una migración.
-- Receta (una sola transacción que termina en error, nada queda aplicado):
--   <20261102000000_health_establishments.sql>
--   <20261102000100_health_layer_nodes.sql>
--   <este archivo>            -- guarda los conteos previos y ejecuta los down con \i entre medio: ver la receta de abajo
-- Como los down se ejecutan con \i, este archivo se corre en DOS partes:
--   psql -1 -v ON_ERROR_STOP=1 <<EOF
--     \i supabase/migrations/20261102000000_health_establishments.sql
--     \i supabase/migrations/20261102000100_health_layer_nodes.sql
--     \i supabase/tests/health_establishments_rollback.sql          (parte A: guarda conteos)
--     \i supabase/rollbacks/20261102000100_health_layer_nodes_down.sql
--     \i supabase/rollbacks/20261102000100_health_layer_nodes_down.sql      (dos veces: idempotencia)
--     \i supabase/rollbacks/20261102000000_health_establishments_down.sql
--     \i supabase/rollbacks/20261102000000_health_establishments_down.sql   (dos veces)
--     \i supabase/tests/health_rollback_check.sql                    (parte B: select pg_temp.part_b(); comprueba)
--     \i supabase/migrations/20261102000000_health_establishments.sql  (se puede volver a aplicar)
--     \i supabase/migrations/20261102000100_health_layer_nodes.sql
--     do $$ begin raise exception 'DRYRUN_OK %', (select count(*) from _tr); end $$;
--   EOF
-- =============================================================================
create temp table _tr (seq serial primary key, name text not null);
grant all on _tr to public;
grant all on sequence _tr_seq_seq to public;
-- La base de pruebas puede traer cargas previas de pytest; el rollback conserva la fuente si tiene capturas, así que se parte de cero DENTRO de esta transacción.
delete from public.source_checks where source_id in (select id from public.data_sources where source_key = 'deis_establecimientos');
delete from public.health_establishments;
delete from public.health_establishments_stage;
delete from public.source_snapshots where source_id in (select id from public.data_sources where source_key = 'deis_establecimientos');
create temp table _before as
  select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes where style ->> 'slug' is distinct from 'salud' and id not in (select layer_id from public.thematic_layers where dataset = 'health_establishments')
  union all select 'territorial_layers', count(*) from public.territorial_layers where id not in (select layer_id from public.thematic_layers where dataset = 'health_establishments')
  union all select 'thematic_other', count(*) from public.thematic_layers where dataset <> 'health_establishments'
  union all select 'data_sources_other', count(*) from public.data_sources where source_key <> 'deis_establecimientos'
  union all select 'settings_other', count(*) from public.pipeline_settings where key not like 'health.%';

create or replace function pg_temp.assert_that(p_name text, p_cond boolean, p_detail text default null)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL [%]: %', p_name, coalesce(p_detail, 'condición falsa'); end if;
  insert into _tr (name) values (p_name);
end $$;

create or replace function pg_temp.part_b() returns void language plpgsql as $$
begin
  perform pg_temp.assert_that('las tablas, funciones y la fuente de salud desaparecieron',
    to_regclass('public.health_establishments') is null and to_regclass('public.health_establishments_stage') is null
    and to_regclass('public.health_tipo_clasificacion') is null
    and not exists (select 1 from pg_proc where proname like '%health%' and pronamespace = 'public'::regnamespace)
    and not exists (select 1 from public.data_sources where source_key = 'deis_establecimientos')
    and not exists (select 1 from public.pipeline_settings where key like 'health.%'));
  perform pg_temp.assert_that('las hojas y la carpeta «Salud» desaparecieron del árbol',
    not exists (select 1 from public.thematic_layers where dataset = 'health_establishments')
    and not exists (select 1 from public.layer_nodes where style ->> 'slug' = 'salud')
    and not exists (select 1 from public.territorial_layers where name in ('Establecimientos de salud', 'Establecimientos por comuna')));
  perform pg_temp.assert_that('el CHECK de renderer volvió a los cuatro anteriores y la bandera client_ready se quitó (no había otras capas con ella)',
    (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.thematic_layers'::regclass and conname = 'thematic_layers_renderer_check') not like '%health%'
    and (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.thematic_layers'::regclass and conname = 'thematic_layers_renderer_check') like '%polygons_crf%'
    and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'thematic_layers' and column_name like 'client_ready%'));
  perform pg_temp.assert_that('lo que no es de salud quedó idéntico (nodos, capas, temáticas, fuentes, umbrales)', not exists (
    select 1 from _before b join (
      select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
      union all select 'territorial_layers', count(*) from public.territorial_layers
      union all select 'thematic_other', count(*) from public.thematic_layers
      union all select 'data_sources_other', count(*) from public.data_sources
      union all select 'settings_other', count(*) from public.pipeline_settings) a using (t) where a.n <> b.n));
end $$;
