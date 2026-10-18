-- Pruebas del ROLLBACK 20261104000000_censo_poblacion_down.sql. NO es una migración. Receta (una transacción que termina en error):
--   \i supabase/migrations/20261104000000_censo_poblacion.sql
--   \i supabase/tests/censo_poblacion_rollback.sql                 (parte A: deja una captura publicada y guarda conteos)
--   \i supabase/rollbacks/20261104000000_censo_poblacion_down.sql  (dos veces: idempotencia)
--   \i supabase/tests/censo_poblacion_rollback_check.sql           (parte B: comprueba)
--   \i supabase/migrations/20261104000000_censo_poblacion.sql      (se puede volver a aplicar)
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
  select (select count(*) from public.source_snapshots where source_id not in (select id from public.data_sources where source_key = 'ine_censo2024_poblacion_comunal')) as snaps_otras,
         (select count(*) from public.data_sources where source_key <> 'ine_censo2024_poblacion_comunal') as fuentes_otras,
         (select count(*) from public.comunas) as comunas, (select count(*) from public.pipeline_settings where key <> 'retention.keep_censo_snapshots') as settings_otros;
-- parte A: una captura publicada con las 346 comunas y 18 grupos de edad (inventados)
insert into public.source_snapshots (source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, declared_date, granularity, row_count_raw, status)
  select d.id, 'test', 'manual_download', 'https://example.test/r', 'test/r', encode(sha256('r'::bytea), 'hex'), date '2024-01-01', date '2024-12-31', date '2025-03-27', 'snapshot', 346, 'validated'
    from public.data_sources d where d.source_key = 'ine_censo2024_poblacion_comunal';
insert into public.poblacion_comunal_stage (snapshot_n, cut, comuna, region_cut, province_cut, total, hombres, mujeres)
  select s.n, c.cut, c.name, c.region_cut, c.province_cut, 18, 9, 9 from public.comunas c, public.source_snapshots s where s.storage_path = 'test/r';
insert into public.poblacion_comunal_edad_stage (snapshot_n, cut, grupo_edad, total, hombres, mujeres)
  select s.n, c.cut, g, 1, 1, 0 from public.comunas c, public.source_snapshots s,
         unnest(array['0 a 4','5 a 9','10 a 14','15 a 19','20 a 24','25 a 29','30 a 34','35 a 39','40 a 44','45 a 49','50 a 54','55 a 59','60 a 64','65 a 69','70 a 74','75 a 79','80 a 84','85 o más']) g where s.storage_path = 'test/r';
update public.poblacion_comunal_edad_stage set mujeres = 0;
-- 18 grupos de 1 persona: hombres 1, mujeres 0 en cada comuna ⇒ Σ edades = 18 hombres; la comuna dice 9 y 9 ⇒ se ajusta para que cuadre
update public.poblacion_comunal_stage set hombres = 18, mujeres = 0;
update public.source_snapshots set validation_report = jsonb_build_object(
    'pais', jsonb_build_object('total', 346 * 18, 'hombres', 346 * 18, 'mujeres', 0),
    'regiones', (select jsonb_object_agg(region_cut, jsonb_build_object('total', n * 18, 'hombres', n * 18, 'mujeres', 0)) from (select region_cut, count(*) n from public.comunas group by 1) a))
  where storage_path = 'test/r';
select public.publish_poblacion_snapshot((select id from public.source_snapshots where storage_path = 'test/r'));
select pg_temp.assert_that('parte A: hay una captura publicada y las 346 comunas con edades', (select count(*) from public.poblacion_comunal) = 346 and (select count(*) from public.poblacion_comunal_edad) = 346 * 18);
