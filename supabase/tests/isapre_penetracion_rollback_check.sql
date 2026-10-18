-- Parte B de supabase/tests/isapre_penetracion_rollback.sql (se corre después de los down; NO es una migración).
select pg_temp.assert_that('el rollback quita las dos funciones de penetración',
  to_regprocedure('public.get_isapre_penetracion(text,integer)') is null and to_regprocedure('public._penetracion_denominador(integer,text,integer)') is null);
select pg_temp.assert_that('no se perdió ningún dato ni función ajena: capturas, fuentes, comunas, settings, celdas Isapre, población y las RPC de Isapre y Censo siguen',
  (select count(*) from public.source_snapshots) = (select snaps from _before) and (select count(*) from public.data_sources) = (select fuentes from _before)
  and (select count(*) from public.comunas) = (select comunas from _before) and (select count(*) from public.pipeline_settings) = (select settings from _before)
  and (select count(*) from public.isapre_cartera_celda) = (select celdas from _before) and (select count(*) from public.poblacion_comunal) = (select pobl from _before)
  and (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('get_isapre_comuna', 'get_poblacion_comunal', 'get_poblacion_comunal_edad', '_isapre_comuna_rango')) = (select fns from _before));
select pg_temp.assert_that('el historial de _migration_log se conserva (start y done)',
  exists (select 1 from public._migration_log where sprint = 'isapre_penetracion_v1' and notes = 'start') and exists (select 1 from public._migration_log where sprint = 'isapre_penetracion_v1' and notes = 'done'));
