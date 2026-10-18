-- Parte B de supabase/tests/censo_poblacion_rollback.sql (se corre después de los down; NO es una migración).
select pg_temp.assert_that('el rollback deja sin tablas ni funciones de población y sin la clave de retención',
  to_regclass('public.poblacion_comunal') is null and to_regclass('public.poblacion_comunal_edad') is null and to_regclass('public.poblacion_comunal_stage') is null
  and to_regclass('public.poblacion_comunal_edad_stage') is null
  and not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like '%poblacion%')
  and not exists (select 1 from public.pipeline_settings where key = 'retention.keep_censo_snapshots'));
select pg_temp.assert_that('la fuente CONSERVA su captura (la FK la protege) y nada ajeno cambió (otras fuentes, capturas de otras fuentes, comunas, settings)',
  exists (select 1 from public.data_sources where source_key = 'ine_censo2024_poblacion_comunal')
  and (select count(*) from public.source_snapshots where source_id not in (select id from public.data_sources where source_key = 'ine_censo2024_poblacion_comunal')) = (select snaps_otras from _before)
  and (select count(*) from public.data_sources where source_key <> 'ine_censo2024_poblacion_comunal') = (select fuentes_otras from _before)
  and (select count(*) from public.comunas) = (select comunas from _before)
  and (select count(*) from public.pipeline_settings) = (select settings_otros from _before));
