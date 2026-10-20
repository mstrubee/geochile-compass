-- Pruebas del ROLLBACK 20261108000000_health_capacity_down.sql. NO es una migración. Receta (una transacción que termina en error):
--   \i supabase/migrations/20261108000000_health_capacity.sql
--   \i supabase/tests/health_capacity_rollback.sql                 (parte A: deja capturas publicadas de las dos fuentes y guarda conteos)
--   \i supabase/rollbacks/20261108000000_health_capacity_down.sql  (dos veces: idempotencia)
--   \i supabase/tests/health_capacity_rollback_check.sql           (parte B: comprueba)
--   \i supabase/migrations/20261108000000_health_capacity.sql      (se puede volver a aplicar)
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
  select (select count(*) from public.source_snapshots where source_id not in (select id from public.data_sources where source_key in ('deis_rem20_hospitalizacion', 'deis_dotacion_camas'))) as snaps_otras,
         (select count(*) from public.data_sources where source_key not in ('deis_rem20_hospitalizacion', 'deis_dotacion_camas')) as fuentes_otras,
         (select count(*) from public.comunas) as comunas, (select count(*) from public.health_establishments) as est,
         (select count(*) from public.pipeline_settings where key <> 'retention.keep_capacidad_snapshots') as settings_otros;
-- parte A: una captura de establecimientos vigente (inventada) y una captura publicada de cada fuente
insert into public.source_snapshots (source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, granularity, row_count_raw, status, loaded_at)
  select d.id, 'test', 'manual_download', 'https://example.test/est', 'test/est', encode(sha256('est'::bytea), 'hex'), current_date, current_date, 'snapshot', 1, 'loaded', now()
    from public.data_sources d where d.source_key = 'deis_establecimientos';
insert into public.health_establishments (snapshot_n, code, name, region_cut, comuna_cut, tipo_glosa, tipo_norm, dependencia_norm, snss, complejidad, tipo_atencion, clase_servicio, clase_fuente, alta_hospital, alta_ampliada, estado, geo_status)
  select n, '112101', 'FIXTURE', '13', '13101', 'Hospital', 'hospital', 'servicio_salud', true, 'alta', 'hospitalaria', 'hospitalario', 'oficial', false, false, 'vigente', 4 from public.source_snapshots where storage_path = 'test/est';
insert into public.source_snapshots (source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, granularity, row_count_raw, status)
  select d.id, 'test', 'manual_download', 'https://example.test/rem', 'test/rem', encode(sha256('rem'::bytea), 'hex'), date '2025-01-01', date '2025-01-31', 'month', 1, 'validated' from public.data_sources d where d.source_key = 'deis_rem20_hospitalizacion';
insert into public.health_rem20_month_stage select n, '112101', date '2025-01-01', 402, 10, 20, 1, 1, 0, 0, 1 from public.source_snapshots where storage_path = 'test/rem';
update public.source_snapshots set validation_report = '{"rows_raw":1,"rows_stage":1,"establecimientos":1,"totales":{"dias_cama_ocupados":10,"dias_cama_disponibles":20,"dias_estada":1,"egresos":1}}'::jsonb where storage_path = 'test/rem';
select public.publish_health_rem20_snapshot((select id from public.source_snapshots where storage_path = 'test/rem'));
insert into public.source_snapshots (source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, granularity, row_count_raw, status)
  select d.id, 'test', 'manual_download', 'https://example.test/dot', 'test/dot', encode(sha256('dot'::bytea), 'hex'), date '2025-01-01', date '2025-12-31', 'year', 1, 'validated' from public.data_sources d where d.source_key = 'deis_dotacion_camas';
insert into public.health_beds_dotacion_stage select n, '112101', 2025, 100, 5 from public.source_snapshots where storage_path = 'test/dot';
update public.source_snapshots set validation_report = '{"rows_stage":1,"establecimientos":1,"total_pais":{"2025":5}}'::jsonb where storage_path = 'test/dot';
select public.publish_health_dotacion_snapshot((select id from public.source_snapshots where storage_path = 'test/dot'));
select pg_temp.assert_that('parte A: hay una captura publicada de cada fuente',
  (select count(*) from public.health_rem20_month) = 1 and (select count(*) from public.health_beds_dotacion) = 1 and public.get_health_capacity('112101') -> 'dotacion' ->> 'total' = '5');
