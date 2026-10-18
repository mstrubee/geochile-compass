-- Pruebas del ROLLBACK 20261105000000_isapre_penetracion_down.sql. NO es una migración. Receta (una transacción que termina en error):
--   \i supabase/migrations/20261105000000_isapre_penetracion.sql
--   \i supabase/tests/isapre_penetracion_rollback.sql                 (parte A: guarda conteos de lo que NO debe cambiar)
--   \i supabase/rollbacks/20261105000000_isapre_penetracion_down.sql  (dos veces: idempotencia)
--   \i supabase/tests/isapre_penetracion_rollback_check.sql           (parte B: comprueba)
--   \i supabase/migrations/20261105000000_isapre_penetracion.sql      (se puede volver a aplicar)
--   do $$ begin raise exception 'DRYRUN_OK %', (select count(*) from _tr); end $$;
create temp table _tr (seq serial primary key, name text not null);
grant all on _tr to public;
grant all on sequence _tr_seq_seq to public;
create or replace function pg_temp.assert_that(p_name text, p_cond boolean, p_detail text default null) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL [%]: %', p_name, coalesce(p_detail, 'condición falsa'); end if;
  insert into _tr (name) values (p_name);
end $$;
create temp table _before as
  select (select count(*) from public.source_snapshots) as snaps, (select count(*) from public.data_sources) as fuentes, (select count(*) from public.comunas) as comunas,
         (select count(*) from public.pipeline_settings) as settings, (select count(*) from public.isapre_cartera_celda) as celdas, (select count(*) from public.poblacion_comunal) as pobl,
         (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('get_isapre_comuna', 'get_poblacion_comunal', 'get_poblacion_comunal_edad', '_isapre_comuna_rango')) as fns;
select pg_temp.assert_that('parte A: la migración dejó las dos funciones y el registro «done»',
  to_regprocedure('public.get_isapre_penetracion(text,integer)') is not null and to_regprocedure('public._penetracion_denominador(integer,text,integer)') is not null
  and exists (select 1 from public._migration_log where sprint = 'isapre_penetracion_v1' and notes = 'done'));
