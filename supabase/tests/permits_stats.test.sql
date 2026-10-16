-- =============================================================================
-- PRUEBA de las migraciones 1 y 2 (patrón de supabase/tests/*.sql: termina en ROLLBACK).
-- Requiere: partes 1 y 2 aplicadas y `comunas` sembrada con las 346 comunas REALES vía
-- set_comuna_geometry() (etl/permisos/seed.py).
--
-- ⚠️  Los VALORES de esta prueba son SINTÉTICOS (fixtures): existen solo dentro de esta transacción y
--     se descartan con el ROLLBACK. Las comunas y sus polígonos son reales; los números de permisos no.
--     La prueba con datos reales de MINVU vive en etl/permisos/tests (parser) y en DISENO.md §1.
-- =============================================================================
begin;

create or replace function pg_temp.assert(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FALLA: %', p_msg; end if;
  raise notice 'ok   %', p_msg;
end $$;

create or replace function pg_temp.raises(p_sql text, p_msg text, p_like text default '%') returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm like p_like then raise notice 'ok   % (%)', p_msg, left(sqlerrm, 70); return; end if;
    raise exception 'FALLA: % — error inesperado: %', p_msg, sqlerrm;
  end;
  raise exception 'FALLA: % — no lanzó error', p_msg;
end $$;

-- crea un snapshot 'validated' y devuelve su n
create or replace function pg_temp.mk(p_id uuid, p_source text, p_hash text, p_start date, p_end date, p_from date,
                                      p_gran text, p_layout jsonb default '{}', p_report jsonb default '{}',
                                      p_raw int default null, p_rej int default 0) returns integer language plpgsql as $$
declare v integer;
begin
  insert into public.source_snapshots (id, source_id, captured_by, capture_method, origin_url, storage_path, sha256,
                                       period_start, period_end, load_from, granularity, row_count_raw, rejected_count,
                                       status, validation_report, layout)
  select p_id, id, 'test:SINTETICO', 'manual_download', 'https://example.test/' || p_hash || '.xlsx', 'test/' || p_hash || '.xlsx',
         repeat(p_hash, 64), p_start, p_end, p_from, p_gran, p_raw, p_rej, 'validated', p_report, p_layout
    from public.data_sources where source_key = p_source
  returning n into v;
  return v;
end $$;

-- ============================ 0. COMUNAS (única fuente de CUT) ============================
select pg_temp.assert((select count(*) from public.comunas) = 346, '346 comunas en la referencia');
select pg_temp.assert((select count(*) from public.comunas where cut !~ '^[0-9]{5}$') = 0, 'CUT de 5 dígitos, texto');
select pg_temp.assert((select format_type(atttypid, atttypmod) = 'character(5)' from pg_attribute where attrelid = 'public.comunas'::regclass and attname = 'cut'), 'comunas.cut es char(5)');
select pg_temp.assert((select count(*) = 0 from information_schema.columns
                        where table_schema = 'public' and column_name = 'comuna_cut'
                          and table_name in ('building_permit_statistics', 'permit_stage')
                          and not (data_type = 'character' and character_maximum_length = 5)),
                      'las columnas comuna_cut son char(5) (y FK a comunas)');
select pg_temp.assert((select count(*) from public.comunas where geom is not null) = 345, '345 comunas con geometría');
select pg_temp.assert((select geom_status = 'absent' and geom is null from public.comunas where cut = '12202'), '12202 Antártica sin geometría (pero existe en la tabla para sus datos)');
select pg_temp.assert((select count(*) filter (where geom_status = 'ok') = 343 and count(*) filter (where geom_status = 'repaired') = 2 from public.comunas),
                      '343 comunas ok + 2 reparadas (13110 La Florida y 06204 Marchihue)');
select pg_temp.assert((select bool_and(geom_status = 'repaired' and geom_original is not null and not ST_IsValid(geom_original) and ST_IsValid(geom))
                         from public.comunas where cut in ('13110', '06204')),
                      'las reparadas conservan la geometría ORIGINAL (inválida) aparte y la reparada es válida');
select pg_temp.assert((select count(*) = 2 and bool_and(area_diff_pct <= 1 and status = 'repaired' and invalid_reason like '%Self-intersection%')
                         from public.comuna_geom_repairs where cut in ('13110', '06204')),
                      'registro de la reparación: motivo, método y diferencia de área <= 1 %');
select pg_temp.assert((select count(*) = 0 from public.comunas where geom_status = 'needs_review'), 'ninguna comuna real pide revisión manual');
select pg_temp.assert((select count(*) = 0 from public.comunas where geom_status <> 'repaired' and geom_original is not null), 'geom_original solo existe cuando hubo reparación');

-- casos límite (SINTÉTICOS) sobre comunas existentes dentro de esta transacción
select public.set_comuna_geometry('01101', ST_GeomFromText('POLYGON((-70 -33, -69.9 -32.9, -69.9 -33, -70 -32.9, -70 -33))', 4326), 'TEST-SINTETICO');
select pg_temp.assert((select geom_status = 'needs_review' and geom is not null and geom_original is not null from public.comunas where cut = '01101'),
                      'polígono "corbata" (área original incalculable): needs_review, se dibuja la reparada y se guarda la original');
select public.set_comuna_geometry('01107', ST_GeomFromText('POLYGON((-70 -33, -70 -32.9, -70 -32.8, -70 -33))', 4326), 'TEST-SINTETICO');
select pg_temp.assert((select geom_status = 'needs_review' and geom is null and geom_original is not null from public.comunas where cut = '01107'),
                      'polígono válido de área cero: needs_review, sin geometría publicada');
update public.pipeline_settings set value = -1 where key = 'comunas.geom_repair_max_area_diff_pct';
select public.set_comuna_geometry('13110', (select geom_original from public.comunas where cut = '13110'), 'TEST-SINTETICO');
select pg_temp.assert((select geom_status = 'needs_review' from public.comunas where cut = '13110'), 'el umbral de área es configurable (no está hardcodeado)');
update public.pipeline_settings set value = 1 where key = 'comunas.geom_repair_max_area_diff_pct';
select public.set_comuna_geometry('13110', (select geom_original from public.comunas where cut = '13110'), 'TEST-SINTETICO');
select pg_temp.assert((select geom_status = 'repaired' from public.comunas where cut = '13110'), 'con el umbral en 1 % vuelve a quedar repaired');
select pg_temp.raises($$ select public.set_comuna_geometry('99999', null) $$, 'comuna inexistente rechazada', '%no existe%');
select pg_temp.raises($$ update public.comunas set geom = ST_GeomFromText('MULTIPOLYGON(((0 0, 1 1, 1 0, 0 1, 0 0)))', 4326) where cut = '01401' $$,
                      'el CHECK impide guardar una geometría inválida por la puerta de atrás', '%comunas_geom_valid%');

-- ============================ 1. SETTINGS Y SERIES ============================
select pg_temp.assert((select count(*) = 6 from public.pipeline_settings), '6 umbrales configurables sembrados');
select pg_temp.assert(public.pipeline_setting('publish.max_reject_ratio') = 0.005, 'umbral de rechazo inicial 0,5 % (configurable)');
select pg_temp.raises($$ select public.pipeline_setting('no.existe') $$, 'clave inexistente → error explícito', '%falta la clave%');
select pg_temp.assert((select count(*) = 12 from public.permit_series), '12 series MINVU (6 anuales + 6 mensuales)');
select pg_temp.assert((select count(*) = 6 from public.permit_destination_map), 'mapa de destinos: total/casas/departamentos x 2 fuentes');
select pg_temp.assert((select count(*) = 0 from public.permit_series ps join public.data_sources d on d.id = ps.source_id where d.source_key = 'ine_permisos_superficie'),
                      'INE: sin series (no se carga nada)');

create temp table _fx as
  select (select id from public.permit_series where source_id = (select id from public.data_sources where source_key = 'minvu_cedoc_permisos_anual')
            and metric = 'units' and destination_declared = 'total')   as ser_a,
         (select id from public.permit_series where source_id = (select id from public.data_sources where source_key = 'minvu_cedoc_permisos_mensual')
            and metric = 'units' and destination_declared = 'total')   as ser_m,
         (select id from public.data_sources where source_key = 'minvu_cedoc_permisos_anual')   as src_a,
         (select id from public.data_sources where source_key = 'minvu_cedoc_permisos_mensual') as src_m;
select pg_temp.assert((select ser_a is not null and ser_m is not null from _fx), 'series units/total de cada fuente encontradas');
grant select on _fx to authenticated;

-- ============================ 2. SNAPSHOT ANUAL A (años 2017, 2018, 2024, 2025) ============================
-- layout SINTÉTICO con la forma real: filas por CUT ([fila] o {split,before,from} para Ñuble/ex-Biobío) y columnas por período
select pg_temp.mk('00000000-0000-0000-0000-00000000000a', 'minvu_cedoc_permisos_anual', 'a', date '2002-01-01', date '2026-07-31', date '2017-01-01', 'year',
  p_layout => '{"rows": {"01101": [27], "16101": {"split": "2018-01-01", "before": 396, "from": 120}},
                "cols": {"2017-01-01:year": 18, "2018-01-01:year": 19, "2024-01-01:year": 25, "2025-01-01:year": 26}}'::jsonb,
  p_report => '{"quality": {"definitive_until": 2024, "provisional_note": "Las cifras del año 2025 difieren de la información publicada por el INE (nota del archivo)"}}'::jsonb) as n_a \gset

-- 345 comunas primero (falta 13101): debe rechazarse
insert into public.permit_stage (snapshot_n, series_id, comuna_cut, period, value, is_provisional)
select :n_a, (select ser_a from _fx), c.cut, make_date(y, 1, 1),
       case when c.cut = '01101' and y = 2017 then 0            -- denominador cero: la variación debe ser NULL
            when y = 2017 then 100 when y = 2018 then 150 when y = 2024 then 200 else 60 end,
       y > 2024
  from public.comunas c, unnest(array[2017, 2018, 2024, 2025]) as y
 where c.cut <> '13101';
select pg_temp.raises($$ select public.publish_permit_snapshot('00000000-0000-0000-0000-00000000000a') $$,
                      'publish rechaza una serie con 345 comunas no declaradas', '%trae 345 comunas%');
insert into public.permit_stage (snapshot_n, series_id, comuna_cut, period, value, is_provisional)
select :n_a, (select ser_a from _fx), '13101', make_date(y, 1, 1),
       case when y = 2017 then 100 when y = 2018 then 150 when y = 2024 then 200 else 60 end, y > 2024
  from unnest(array[2017, 2018, 2024, 2025]) as y;

-- totales de control que no cuadran
insert into public.snapshot_control_totals (snapshot_id, series_id, period, declared_total, computed_total, reference)
select '00000000-0000-0000-0000-00000000000a', ser_a, date '2018-01-01', 99999, 346 * 150, 'SINTETICO' from _fx;
select pg_temp.raises($$ select public.publish_permit_snapshot('00000000-0000-0000-0000-00000000000a') $$,
                      'publish rechaza totales de control que no cuadran', '%no cuadran%');
delete from public.snapshot_control_totals;
insert into public.snapshot_control_totals (snapshot_id, series_id, period, declared_total, computed_total, reference)
select '00000000-0000-0000-0000-00000000000a', ser_a, date '2018-01-01', 346 * 150, 346 * 150, 'SINTETICO' from _fx;

-- la serie del otro origen no puede colarse; el período debe tener la forma de la granularidad
insert into public.permit_stage (snapshot_n, series_id, comuna_cut, period, value) select :n_a, ser_m, '01101', date '2018-01-01', 1 from _fx;
select pg_temp.raises($$ select public.publish_permit_snapshot('00000000-0000-0000-0000-00000000000a') $$, 'publish rechaza series de otra fuente', '%series de otra fuente%');
delete from public.permit_stage where series_id = (select ser_m from _fx);
insert into public.permit_stage (snapshot_n, series_id, comuna_cut, period, value) select :n_a, ser_a, '01101', date '2018-03-01', 1 from _fx;
select pg_temp.raises($$ select public.publish_permit_snapshot('00000000-0000-0000-0000-00000000000a') $$, 'publish rechaza un período anual que no es 1-ene', '%fuera de forma o de rango%');
delete from public.permit_stage where period = date '2018-03-01';

-- publica
select pg_temp.assert((public.publish_permit_snapshot('00000000-0000-0000-0000-00000000000a') ->> 'inserted')::int = 1384, 'publish A: 1384 valores nuevos (346 comunas x 4 años)');
select pg_temp.assert((public.publish_permit_snapshot('00000000-0000-0000-0000-00000000000a') ->> 'already_loaded')::boolean, 'publish es idempotente');
select pg_temp.assert((select count(*) from public.permit_stage) = 0, 'la zona de paso queda vacía');
select pg_temp.assert((select count(*) = 1384 and bool_and(from_snapshot = :n_a and to_snapshot is null) from public.building_permit_statistics), '1384 filas vigentes, todas nacidas en el snapshot A');

-- inmutabilidad e integridad
select pg_temp.raises($$ update public.building_permit_statistics set value = value + 1 where comuna_cut = '13101' and period = date '2018-01-01' $$,
                      'un valor publicado no se puede editar', '%inmutable%');
select pg_temp.raises($$ insert into public.building_permit_statistics (series_id, comuna_cut, period, value, from_snapshot)
                         select series_id, comuna_cut, period, value, from_snapshot from public.building_permit_statistics limit 1 $$,
                      'índice parcial: no puede haber dos valores vigentes para la misma clave', '%bps_one_current_idx%');
select pg_temp.raises($$ insert into public.building_permit_statistics (series_id, comuna_cut, period, value, from_snapshot)
                         select series_id, '99999', period, value, from_snapshot from public.building_permit_statistics limit 1 $$,
                      'CUT que no está en comunas rechazado por FK', '%foreign key%');
select pg_temp.raises($$ insert into public.building_permit_statistics (series_id, comuna_cut, period, value, from_snapshot)
                         select series_id, comuna_cut, date '2030-01-01', -1, from_snapshot from public.building_permit_statistics limit 1 $$,
                      'valor negativo rechazado', '%check constraint%');

-- ============================ 3. COROPLETA ============================
select pg_temp.assert((select count(*) from public.get_permit_choropleth('minvu_cedoc_permisos_anual', 'year', 2018)) = 346, 'coropleta devuelve las 346 comunas (con y sin dato)');
select pg_temp.assert((select value = 150 and prev_value = 100 and yoy_pct = 50.00 from public.get_permit_choropleth('minvu_cedoc_permisos_anual', 'year', 2018) where comuna_cut = '13101'), 'valor 2018 = 150, variación interanual +50 %');
select pg_temp.assert((select yoy_pct is null and value = 150 and prev_value = 0 from public.get_permit_choropleth('minvu_cedoc_permisos_anual', 'year', 2018) where comuna_cut = '01101'), 'denominador 0 → variación NULL (no infinito ni 0)');
select pg_temp.assert((select bool_and(yoy_pct is null) from public.get_permit_choropleth('minvu_cedoc_permisos_anual', 'year', 2024)), '2024 sin 2023 → sin variación (el hueco no se rellena con 0)');
select pg_temp.assert((select bool_and(is_provisional) and bool_and(value = 60) from public.get_permit_choropleth('minvu_cedoc_permisos_anual', 'year', 2025)), '2025 se informa como provisional');
select pg_temp.assert((select bool_and(value is null and not coverage_ok) from public.get_permit_choropleth('minvu_cedoc_permisos_anual', 'year', 2026)), 'año sin datos (2026 no viene anual) → NULL, no 0');
select pg_temp.assert((select value is null and not coverage_ok from public.get_permit_choropleth('minvu_cedoc_permisos_anual', 'year', 2023) where comuna_cut = '12202'), 'sin dato ≠ 0');
select pg_temp.raises($$ select * from public.get_permit_choropleth('fuente_inexistente', 'year', 2025) $$, 'fuente inexistente → error explícito', '%no existe%');
select pg_temp.raises($$ select * from public.get_permit_choropleth('minvu_cedoc_permisos_anual', 'month', 2025) $$, 'mes obligatorio para month/ytd', '%p_month%');

-- ============================ 4. SNAPSHOT MENSUAL (345 comunas: Antártica declarada ausente) ============================
select pg_temp.mk('00000000-0000-0000-0000-00000000000b', 'minvu_cedoc_permisos_mensual', 'b', date '2002-01-01', date '2026-07-31', date '2025-01-01', 'month',
  p_report => jsonb_build_object('comunas_absent_declared', jsonb_build_array('12202'))) as n_m \gset
insert into public.permit_stage (snapshot_n, series_id, comuna_cut, period, value, is_provisional)
select :n_m, (select ser_m from _fx), c.cut, m::date, case when m < date '2026-01-01' then 10 else 20 end, true
  from public.comunas c, generate_series(date '2025-01-01', date '2026-07-01', interval '1 month') m where c.cut <> '12202';
select public.publish_permit_snapshot('00000000-0000-0000-0000-00000000000b');
select pg_temp.assert((select value = 140 and prev_value = 70 and yoy_pct = 100.00 and coverage_ok from public.get_permit_choropleth('minvu_cedoc_permisos_mensual', 'ytd', 2026, 7) where comuna_cut = '13101'),
                      'acumulado ene–jul 2026 vs 2025: 140 vs 70, +100 %');
select pg_temp.assert((select bool_and(value is null and not coverage_ok) from public.get_permit_choropleth('minvu_cedoc_permisos_mensual', 'ytd', 2026, 8)), 'acumulado a agosto (mes no publicado) → sin dato, no se inventa');
select pg_temp.assert((select value = 20 from public.get_permit_choropleth('minvu_cedoc_permisos_mensual', 'month', 2026, 3) where comuna_cut = '13101'), 'valor mensual 2026-03');
select pg_temp.assert((select value is null and not coverage_ok from public.get_permit_choropleth('minvu_cedoc_permisos_mensual', 'month', 2026, 3) where comuna_cut = '12202'), 'Antártica declarada ausente → sin dato');

-- ============================ 5. SNAPSHOT A2: cambia lo provisional de 10 comunas ============================
select pg_temp.mk('00000000-0000-0000-0000-0000000000a2', 'minvu_cedoc_permisos_anual', 'c', date '2002-01-01', date '2026-07-31', date '2017-01-01', 'year') as n_a2 \gset
insert into public.permit_stage (snapshot_n, series_id, comuna_cut, period, value, is_provisional)
select :n_a2, s.series_id, s.comuna_cut, s.period,
       case when s.period = date '2025-01-01' and s.comuna_cut in (select cut from public.comunas order by cut limit 10) then 70 else s.value end, s.is_provisional
  from public.building_permit_statistics s where s.to_snapshot is null and s.series_id = (select ser_a from _fx);
select pg_temp.assert((public.publish_permit_snapshot('00000000-0000-0000-0000-0000000000a2') - 'snapshot_id' - 'snapshot_n')
                      = '{"rows_in_file": 1384, "inserted": 10, "changed": 10, "retired": 0, "unchanged": 1374}'::jsonb,
                      'A2: 10 valores cambiados (1 versión nueva c/u), 1374 sin tocar ni duplicar');
select pg_temp.assert((select count(*) from public.building_permit_statistics where series_id = (select ser_a from _fx)) = 1394, 'serie anual: 1384 + 10 versiones nuevas = 1394 filas');
select pg_temp.assert((select count(*) from public.building_permit_statistics where series_id = (select ser_a from _fx) and from_snapshot <= :n_a and (to_snapshot is null or to_snapshot > :n_a)) = 1384,
                      'cero pérdida: el contenido COMPLETO del snapshot A se reconstruye (1384 filas)');
select pg_temp.assert((select count(*) from public.building_permit_statistics where series_id = (select ser_a from _fx) and from_snapshot <= :n_a2 and (to_snapshot is null or to_snapshot > :n_a2)) = 1384,
                      'y el del snapshot A2 también (1384 filas)');
select pg_temp.assert((select value = 70 from public.get_permit_choropleth('minvu_cedoc_permisos_anual', 'year', 2025) where comuna_cut = (select min(cut) from public.comunas)), 'el mapa muestra la versión vigente (70)');

-- ============================ 6. SNAPSHOT A3: la fuente retira un valor; guardas ============================
select pg_temp.mk('00000000-0000-0000-0000-0000000000a3', 'minvu_cedoc_permisos_anual', 'd', date '2002-01-01', date '2026-08-31', date '2017-01-01', 'year') as n_a3 \gset
insert into public.permit_stage (snapshot_n, series_id, comuna_cut, period, value, is_provisional)
select :n_a3, s.series_id, s.comuna_cut, s.period, s.value, s.is_provisional
  from public.building_permit_statistics s
 where s.to_snapshot is null and s.series_id = (select ser_a from _fx) and not (s.comuna_cut = '13101' and s.period = date '2017-01-01');
select pg_temp.assert((public.publish_permit_snapshot('00000000-0000-0000-0000-0000000000a3') ->> 'retired')::int = 1, 'foto completa: lo que la fuente ya no trae se retira (1)');
select pg_temp.assert((select value is null from public.get_permit_choropleth('minvu_cedoc_permisos_anual', 'year', 2017) where comuna_cut = '13101'), 'el valor retirado deja de mostrarse');
select pg_temp.assert((select count(*) from public.building_permit_statistics where series_id = (select ser_a from _fx) and comuna_cut = '13101' and period = date '2017-01-01' and to_snapshot = :n_a3) = 1, 'pero su versión sigue guardada (historia)');

select pg_temp.mk('00000000-0000-0000-0000-0000000000ae', 'minvu_cedoc_permisos_anual', 'e', date '2002-01-01', date '2026-06-30', date '2017-01-01', 'year') as n_old \gset
insert into public.permit_stage (snapshot_n, series_id, comuna_cut, period, value) select :n_old, ser_a, '01101', date '2017-01-01', 1 from _fx;
select pg_temp.raises($$ select public.publish_permit_snapshot('00000000-0000-0000-0000-0000000000ae') $$, 'no se publica un archivo más viejo que el vigente', '%ya hay uno publicado%');
delete from public.permit_stage; delete from public.source_snapshots where n = :n_old;

-- umbral de rechazo configurable
select pg_temp.mk('00000000-0000-0000-0000-0000000000af', 'minvu_cedoc_permisos_anual', 'f', date '2002-01-01', date '2026-08-31', date '2017-01-01', 'year', p_raw => 100, p_rej => 5) as n_r \gset
insert into public.permit_stage (snapshot_n, series_id, comuna_cut, period, value, is_provisional)
select :n_r, s.series_id, s.comuna_cut, s.period, s.value, s.is_provisional from public.building_permit_statistics s where s.to_snapshot is null and s.series_id = (select ser_a from _fx);
select pg_temp.raises($$ select public.publish_permit_snapshot('00000000-0000-0000-0000-0000000000af') $$, 'con el umbral inicial (0,5 %) 5 rechazadas de 100 no se publica', '%rechazadas%');
update public.pipeline_settings set value = 0.10 where key = 'publish.max_reject_ratio';
select pg_temp.assert((public.publish_permit_snapshot('00000000-0000-0000-0000-0000000000af') ->> 'inserted')::int = 0, 'con el umbral en 10 % publica, y como todo es igual NO escribe ninguna fila nueva');
update public.pipeline_settings set value = 0.005 where key = 'publish.max_reject_ratio';

-- ============================ 7. PURGA (retención configurable = 2) ============================
-- snapshots anuales cargados: A, A2, A3, AR. Se conservan reconstruibles los 2 últimos (A3, AR):
-- sobran las versiones cerradas en o antes de A3: 10 (A2) + 1 (retiro de A3) = 11.
select pg_temp.assert(public.pipeline_setting('retention.keep_snapshots') = 2, 'retención por defecto = 2 (configurable)');
select pg_temp.assert((public.purge_superseded_permit_rows((select src_a from _fx)) - 'source_id') = '{"keep": 2, "rows_deleted": 11, "snapshots_marked": 2}'::jsonb,
                      'purga: borra 11 versiones que ya no sirven y marca 2 snapshots como no reconstruibles');
select pg_temp.assert((select count(*) from public.building_permit_statistics where series_id = (select ser_a from _fx) and to_snapshot is null) = 1383, 'la purga NO tocó ningún valor vigente (1383)');
select pg_temp.assert((select status = 'superseded' and sha256 = repeat('a', 64) and storage_path = 'test/a.xlsx' from public.source_snapshots where n = :n_a),
                      'el snapshot A conserva su registro, su hash y la ruta de su archivo original');
select pg_temp.assert((public.purge_superseded_permit_rows((select src_a from _fx)) ->> 'rows_deleted')::int = 0, 'la purga es idempotente');

-- ============================ 8. FICHA: procedencia por valor ============================
select pg_temp.assert((select cell_ref = 'número_total!R27' from public.get_permit_series('01101', 'minvu_cedoc_permisos_anual', 'units', 'housing_total', 'year') where period = date '2017-01-01'),
                      'celda de origen de una comuna normal: número_total!R27');
select pg_temp.assert((select cell_ref = 'número_total!R396' from public.get_permit_series('16101', 'minvu_cedoc_permisos_anual', 'units', 'housing_total', 'year') where period = date '2017-01-01'),
                      'Ñuble antes de 2018: la celda es la de la fila "ex-Biobío" (396)');
select pg_temp.assert((select cell_ref = 'número_total!S120' from public.get_permit_series('16101', 'minvu_cedoc_permisos_anual', 'units', 'housing_total', 'year') where period = date '2018-01-01'),
                      'Ñuble desde 2018: la celda es la de la fila "Ñuble" (120)');
select pg_temp.assert((select bool_and(first_origin_url like 'https://%' and landing_url like 'https://%' and first_snapshot_id is not null and verification_status = 'comprobado')
                         from public.get_permit_series('13101', 'minvu_cedoc_permisos_anual', 'units', 'housing_total', 'year')),
                      'cada valor trae URL de origen, página oficial, snapshot y estado de verificación');
select pg_temp.assert((select quality_note like 'Las cifras del año 2025 difieren%' from public.get_permit_series('13101', 'minvu_cedoc_permisos_anual', 'units', 'housing_total', 'year') where period = date '2025-01-01'),
                      'un valor provisional trae la nota de calidad del propio archivo');
select pg_temp.assert((select quality_note is null from public.get_permit_series('13101', 'minvu_cedoc_permisos_anual', 'units', 'housing_total', 'year') where period = date '2024-01-01'),
                      'un valor definitivo no trae nota');
select pg_temp.assert((select first_snapshot_id = '00000000-0000-0000-0000-00000000000a' from public.get_permit_series('13101', 'minvu_cedoc_permisos_anual', 'units', 'housing_total', 'year') where period = date '2024-01-01'),
                      'tras la purga, un valor que los snapshots posteriores repiten sigue apuntando al snapshot donde NACIÓ (A)');

-- ============================ 9. FRESCURA Y ALERTAS ============================
select pg_temp.assert((select last_period_end = date '2026-08-31' from public.source_freshness_v where source_key = 'minvu_cedoc_permisos_anual'), 'último período de la fuente anual = 2026-08-31');
select pg_temp.assert((select overdue_since = date '2026-08-31' + 120 from public.source_freshness_v where source_key = 'minvu_cedoc_permisos_anual'), 'atraso esperado = fin de período + cadencia + rezago + holgura');
select pg_temp.assert((select freshness_status = 'never_loaded' from public.source_freshness_v where source_key = 'ine_permisos_superficie'), 'INE sin snapshot → never_loaded (no se muestra como vigente)');
select public.raise_freshness_alerts();
select pg_temp.assert((select count(*) from public.source_alerts where kind = 'never_loaded' and closed_at is null) = 3, 'alertas never_loaded abiertas (INE, SEIA EIA y DIA)');
select public.raise_freshness_alerts();
select pg_temp.assert((select count(*) from (select source_id, kind from public.source_alerts where closed_at is null group by 1, 2 having count(*) > 1) d) = 0, 'una sola alerta abierta por fuente y tipo');
insert into public.source_checks (source_id, method, outcome, latest_period_seen, checked_by)
select src_a, 'manual', 'ok_no_new_period', date '2026-08-31', 'test' from _fx;
select pg_temp.assert((select last_checked_at is not null from public.source_freshness_v where source_key = 'minvu_cedoc_permisos_anual'), 'una revisión sin novedades queda registrada');
select pg_temp.assert((select count(*) = 3 from public.get_layer_provenance('building_permits')), 'proveniencia: 3 fuentes de permisos (MINVU anual, MINVU mensual, INE)');
select pg_temp.assert((select verification_status = 'comprobado' from public.get_layer_provenance('building_permits') where source_key = 'minvu_cedoc_permisos_anual'), 'MINVU figura comprobado');
select pg_temp.assert((select verification_status = 'documentado' from public.get_layer_provenance('building_permits') where source_key = 'ine_permisos_superficie'), 'INE figura documentado (no verificado)');

-- ============================ 10. RLS ============================
set local role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000bb', true);   -- usuario NO admin
select pg_temp.assert((select count(*) from public.building_permit_statistics) > 0, 'autenticado lee estadísticas');
select pg_temp.assert((select count(*) from public.comunas) = 346, 'autenticado lee comunas');
select pg_temp.raises($$ insert into public.data_sources (source_key, dataset, name, publisher, landing_url, attribution, access_mode, cadence_days, publication_lag_days)
  values ('x_test', 'x_test', 'x', 'x', 'https://x', 'x', 'manual', 1, 0) $$, 'no-admin no puede crear fuentes', '%row-level security%');
do $$ declare n int; begin
  update public.building_permit_statistics set to_snapshot = 1;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLA: la API pudo modificar % estadísticas', n; end if;
  update public.comunas set name = 'x';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALLA: la API pudo modificar % comunas', n; end if;
  raise notice 'ok   la API no puede modificar estadísticas ni comunas (0 filas afectadas, sin política de escritura)';
end $$;
select pg_temp.assert((select count(*) from public.source_alerts) = 0, 'no-admin no ve alertas (RLS filtra)');
select pg_temp.raises($$ select public.publish_permit_snapshot('00000000-0000-0000-0000-00000000000a') $$, 'authenticated no puede publicar snapshots', '%permission denied%');
select pg_temp.raises($$ select public.set_comuna_geometry('01101', null) $$, 'authenticated no puede cambiar geometrías de comunas', '%permission denied%');
select pg_temp.raises($$ select * from public.permit_stage $$, 'authenticated no ve la zona de paso', '%permission denied%');
select set_config('test.uid', '00000000-0000-0000-0000-0000000000aa', true);   -- admin
select pg_temp.assert((select count(*) from public.source_alerts) > 0, 'admin ve las alertas');
reset role;
set local role anon;
select pg_temp.raises($$ select * from public.building_permit_statistics $$, 'anon no lee estadísticas', '%permission denied%');
select pg_temp.raises($$ select * from public.comunas $$, 'anon no lee comunas', '%permission denied%');
reset role;

rollback;
