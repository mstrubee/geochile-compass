-- Parte B de supabase/tests/health_capacity_rollback.sql (se corre después de los down; NO es una migración).
select pg_temp.assert_that('el rollback deja sin tablas ni funciones de capacidad y sin la clave de retención',
  to_regclass('public.health_rem20_month') is null and to_regclass('public.health_beds_dotacion') is null and to_regclass('public.health_rem20_month_stage') is null
  and to_regclass('public.health_beds_dotacion_stage') is null and to_regclass('public.health_areas_funcionales') is null and to_regclass('public.health_capacity_fields') is null
  and not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and (proname like '%health_capacity%' or proname like 'publish_health_rem20%' or proname like 'publish_health_dotacion%'))
  and not exists (select 1 from public.pipeline_settings where key = 'retention.keep_capacidad_snapshots'));
select pg_temp.assert_that('las fuentes CONSERVAN su captura (la FK las protege) y nada ajeno cambió (otras fuentes, capturas de otras fuentes, comunas, establecimientos, settings)',
  (select count(*) = 2 from public.data_sources where source_key in ('deis_rem20_hospitalizacion', 'deis_dotacion_camas'))
  and (select count(*) from public.source_snapshots where source_id not in (select id from public.data_sources where source_key in ('deis_rem20_hospitalizacion', 'deis_dotacion_camas'))) = (select snaps_otras + 1 from _before)
  and (select count(*) from public.data_sources where source_key not in ('deis_rem20_hospitalizacion', 'deis_dotacion_camas')) = (select fuentes_otras from _before)
  and (select count(*) from public.comunas) = (select comunas from _before)
  and (select count(*) from public.health_establishments) = (select est + 1 from _before)
  and (select count(*) from public.pipeline_settings) = (select settings_otros from _before));
