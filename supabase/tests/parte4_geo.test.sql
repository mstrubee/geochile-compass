-- =============================================================================
-- PRUEBA de la Parte 4 (migraciones 20261021120000/120100/120200). Patrón de supabase/tests/*.sql: termina en ROLLBACK.
-- Requiere: partes 1 y 2 y las tres migraciones de la Parte 4 aplicadas, y `comunas` sembrada con las 346 comunas REALES
-- vía set_comuna_geometry() (etl/permisos/seed.py).
--
-- DATOS: las filas de INE PE (40), de CRF (6 polígonos) y de SEIA (6 DIA + 4 EIA) son REALES: recortes del sondeo del
-- 2026-10-17 contra los servicios del INE y del SEA. Lo SINTÉTICO está rotulado donde aparece (polígonos duplicados con
-- otro src_oid para alcanzar volumen, un polígono en corbata para forzar una reparación, y desplazamientos de coordenadas
-- para forzar near_border/outside_declared). Todo existe solo dentro de esta transacción.
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
    if sqlerrm like p_like then raise notice 'ok   % (%)', p_msg, left(sqlerrm, 90); return; end if;
    raise exception 'FALLA: % — error inesperado: %', p_msg, sqlerrm;
  end;
  raise exception 'FALLA: % — no lanzó error', p_msg;
end $$;

-- snapshot 'validated' de una fuente; devuelve su n
create or replace function pg_temp.mk(p_source text, p_tag text, p_start date, p_end date, p_raw int, p_rej int default 0,
                                      p_report jsonb default null) returns integer language plpgsql as $$
declare v integer;
begin
  insert into public.source_snapshots (source_id, captured_by, capture_method, origin_url, storage_path, sha256,
                                       period_start, period_end, granularity, row_count_raw, rejected_count, status, validation_report)
  select d.id, 'test', 'api', 'https://example.test/' || p_tag, 'test/' || p_tag, encode(sha256(p_tag::bytea), 'hex'),
         p_start, p_end, 'year', p_raw, p_rej, 'validated',
         coalesce(p_report, jsonb_build_object('server_count_before', p_raw, 'server_count_after', p_raw))
    from public.data_sources d where d.source_key = p_source
  returning n into v;
  return v;
end $$;

-- ============================ 0. PRECONDICIONES ============================
select pg_temp.assert((select count(*) from public.comunas) = 346, '346 comunas en la referencia');
select pg_temp.assert((select count(*) from public.data_sources where source_key in ('ine_pe_nacional', 'ine_crf_nacional', 'seia_proyectos_eia', 'seia_proyectos_dia')) = 4,
  'las 4 fuentes de la Parte 4 están sembradas');
select pg_temp.assert((select license_label is null from public.data_sources where source_key = 'ine_pe_nacional'), 'INE PE: licencia por confirmar (null), no inventada');
select pg_temp.assert((select license_label is null from public.data_sources where source_key = 'ine_crf_nacional'), 'INE CRF: licencia por confirmar (null), no inventada');
select pg_temp.assert((select count(*) from public.pipeline_settings where key in ('retention.keep_point_snapshots', 'ine_points.near_border_m',
  'ine_points.max_outside_ratio', 'crf.geom_repair_max_area_diff_pct', 'crf.max_invalid_ratio', 'projects.near_border_m', 'publish.max_reject_ratio')) = 7,
  'los 7 umbrales existen y son configurables (pipeline_settings)');
select pg_temp.assert((select format_type(atttypid, atttypmod) = 'character(5)' from pg_attribute where attrelid = 'public.ine_pe_points'::regclass and attname = 'comuna_cut'), 'ine_pe_points.comuna_cut es char(5)');
select pg_temp.assert((select format_type(atttypid, atttypmod) = 'bigint' from pg_attribute where attrelid = 'public.building_projects'::regclass and attname = 'expediente_id'), 'building_projects.expediente_id es bigint (ID llega a 2.147.998.999)');
select pg_temp.assert((select relkind = 'p' from pg_class where oid = 'public.ine_pe_points'::regclass), 'ine_pe_points está particionada');
select pg_temp.assert((select count(*) from pg_attribute a where a.attrelid in ('public.ine_pe_points'::regclass, 'public.ine_crf_polygons'::regclass, 'public.building_projects'::regclass)
  and a.attnum > 0 and not a.attisdropped and format_type(a.atttypid, a.atttypmod) = 'jsonb') = 0, 'ninguna de las tablas de hechos tiene JSONB por fila');

-- ============================ 1. INE PE: datos reales ============================
create temp table _pe_real (oid_ int, cod int, yr int, units int, floors int, glosa text, uso int, area double precision, prec int, lon double precision, lat double precision) on commit drop;
insert into _pe_real values
  (624570, 8107, 2019, 1, 2, 'Casa aislada', 1, 76.0, 3, -72.9919220003383, -36.724641000072),
  (624571, 8107, 2019, 1, 1, 'Casa pareada', 1, 85.0, 3, -72.9813459997511, -36.7284559998647),
  (624572, 8107, 2019, 1, 2, 'Casa pareada', 1, 90.0, 3, -72.9864979996022, -36.7232280003178),
  (624573, 8107, 2019, 1, 2, 'Casa pareada', 1, 93.0, 3, -72.9730920004428, -36.7106020002105),
  (624574, 8107, 2019, 1, 1, 'Casa pareada', 1, 113.0, 3, -72.9773170000062, -36.7214749998184),
  (624575, 8107, 2019, 1, 2, 'Casa continua', 1, 121.0, 3, -72.97597600034, -36.7101409997094),
  (624576, 8107, 2019, 1, 2, 'Casa continua', 1, 136.0, 2, -73.0133010003952, -36.7684010000991),
  (624577, 8107, 2019, 1, 2, 'Casa continua', 1, 130.0, 3, -72.9942079998357, -36.7466870002154),
  (624578, 8107, 2019, 1, 1, 'Comercio', 3, 35.0, 3, -73.0020040002828, -36.737940000014),
  (624579, 8107, 2019, 1, 1, 'Locales comerciales', 3, 61.0, 3, -72.9936939999997, -36.7369939996674),
  (624580, 8107, 2019, 1, 1, 'Esparcimiento y diversión', 3, 85.0, 3, -72.9848849999494, -36.7384309998331),
  (624581, 8107, 2019, 1, 1, 'Esparcimiento y diversión', 3, 106.0, 3, -72.9992319996403, -36.7489190002239),
  (624582, 8107, 2019, 1, 1, 'Cultura', 3, 75.0, 3, -72.9761010000135, -36.7254330003097),
  (624583, 8107, 2019, 1, 1, 'Otros', 3, 43.0, 2, -72.9971489996342, -36.7469570003304),
  (624584, 8108, 2019, 1, 1, 'Casa aislada', 1, 36.0, 3, -73.1324519999684, -36.8241249999635),
  (624585, 8108, 2019, 1, 1, 'Casa aislada', 1, 112.0, 3, -73.113477000308, -36.833126999673),
  (624586, 8108, 2019, 1, 2, 'Casa aislada', 1, 139.0, 3, -73.143073999688, -36.844370999677),
  (624587, 8108, 2019, 1, 2, 'Casa aislada', 1, 238.0, 3, -73.0911950002528, -36.8516739998614),
  (624588, 8108, 2019, 1, 2, 'Casa aislada', 1, 192.0, 3, -73.0991980003891, -36.8337600000046),
  (624589, 8108, 2019, 1, 2, 'Casa aislada', 1, 44.0, 3, -73.1261650003153, -36.8276890001897),
  (583904, 4201, 2025, 1, 1, 'CASA AISLADA', 1, 54.0, 1, -71.1372019901343, -31.6267039067857),
  (583929, 5401, 2025, 1, 2, 'CASA AISLADA', 1, 128.0, 1, -71.2240630001075, -32.4236230001692),
  (583932, 5401, 2025, 1, 1, 'CASA AISLADA', 1, 25.0, 1, -71.4916519999109, -32.2238810002735),
  (584015, 6204, 2025, 1, 1, 'CASA AISLADA', 1, 79.0, 1, -71.8041134696152, -34.3023637347261),
  (584021, 6201, 2025, 1, 1, 'CASA AISLADA', 1, 57.0, 1, -71.9084040122441, -34.5261969298645),
  (595994, 2101, 2023, 1, 1, 'Comercio', 3, 165.0, 0, -70.3844366486577, -23.6103884230254),
  (596643, 8103, 2023, 1, 1, 'Casa aislada', 1, 289.0, 0, -73.0163612937685, -36.9452648841761),
  (596661, 8107, 2023, 1, 2, 'Casa continua', 1, 139.0, 0, -72.9902242823676, -36.7236924129734),
  (596676, 8108, 2023, 1, 2, 'Locales comerciales', 3, 214.0, 0, -73.0807762192133, -36.8409902599124),
  (596774, 8301, 2023, 1, 1, 'Casa aislada', 1, 119.0, 0, -72.4028361957528, -37.4652857101352),
  (588293, 1101, 2024, 3, 4, 'Edificio o bloque único; Locales comerciales', 2, 499.0, 3, -70.1293599806128, -20.231144604149),
  (588294, 1101, 2024, 4, 4, 'Edificio o bloque único; Locales comerciales', 2, 239.0, 3, -70.1503788478689, -20.221628775099),
  (588295, 1101, 2024, 1, 7, 'Oficinas sin destino específico', 3, 802.0, 3, -70.1532309997943, -20.2138950006965),
  (588296, 1101, 2024, 2, 3, 'Casa continua; Locales comerciales', 2, 461.0, 3, -70.14432100036, -20.2171879999392),
  (588297, 1101, 2024, 1, 2, 'Casa aislada', 1, 337.0, 3, -70.1423350004383, -20.2380519998372),
  (588298, 1101, 2024, 1, 2, 'Hoteles, moteles, residenciales, cabañas', 3, 232.0, 3, -70.1473299999306, -20.2198890009356),
  (588299, 1101, 2024, 80, 5, 'Dos edificios o bloques', 1, 5651.0, 3, -70.1659189998016, -20.365669000703),
  (588300, 1101, 2024, 33, 5, 'Edificio o bloque único; Locales comerciales', 2, 2152.0, 3, -70.1412125186599, -20.2195508256068),
  (588301, 1101, 2024, 140, 2, 'Casa pareada', 1, 8383.0, 3, -70.1675530002692, -20.3659229999846),
  (588302, 1101, 2024, 1, 2, 'Casa continua', 1, 125.0, 3, -70.1398520003991, -20.2217840009015);;
select pg_temp.assert((select count(*) from _pe_real) = 40, '40 registros REALES del INE PE (sondeo 2026-10-17)');
select pg_temp.assert((select count(distinct prec) from _pe_real) = 4, 'incluyen las 4 precisiones: ALTA, MODERADA, BAJA y nula');

create or replace function pg_temp.stage_pe(p_n integer, p_shift_last double precision default 0, p_year_override int default null) returns void language plpgsql as $$
begin
  insert into public.ine_pe_stage (snapshot_n, src_oid, comuna_cut, year, units, floors, uso, geo_precision, glosa, area_m2, lon, lat)
  select p_n, oid_, lpad(cod::text, 5, '0'), coalesce(p_year_override, yr), units, floors, uso, prec, glosa, area, lon, lat from _pe_real;
  if p_shift_last <> 0 then   -- SINTÉTICO: una fila desplazada para forzar near_border / outside_declared
    insert into public.ine_pe_stage (snapshot_n, src_oid, comuna_cut, year, units, floors, uso, geo_precision, glosa, area_m2, lon, lat)
    select p_n, 999999, lpad(cod::text, 5, '0'), yr, units, floors, uso, prec, glosa, area, lon + p_shift_last, lat from _pe_real order by oid_ limit 1;
  end if;
end $$;

-- 1a. camino feliz
select pg_temp.mk('ine_pe_nacional', 'pe-A', date '2019-01-01', date '2025-12-31', 40) as na \gset
select pg_temp.stage_pe(:na);
select public.publish_ine_pe_snapshot((select id from public.source_snapshots where n = :na)) as repA \gset
select pg_temp.assert((select count(*) from public.ine_pe_points where snapshot_n = :na) = 40, 'publicó los 40 registros');
select pg_temp.assert((select to_regclass('public.ine_pe_points_p' || :na) is not null), 'creó la partición del snapshot');
select pg_temp.assert((select count(*) from public.ine_pe_stage) = 0, 'la zona de paso quedó vacía');
select pg_temp.assert((select status from public.source_snapshots where n = :na) = 'loaded', 'snapshot en estado loaded');
select pg_temp.assert((select count(*) from public.ine_pe_points where snapshot_n = :na and geo_status = 0) = 40, 'los 40 puntos reales caen DENTRO de su comuna (geo_status 0)');
select pg_temp.assert((select count(*) from public.ine_pe_glosas) = (select count(distinct glosa) from _pe_real), 'la dimensión de glosas guarda cada texto una vez');
select pg_temp.assert((select count(*) filter (where geo_precision = 0) from public.ine_pe_points where snapshot_n = :na) = (select count(*) from _pe_real where prec = 0), 'la precisión nula queda como 0, no se inventa');
select pg_temp.assert((select (validation_report -> 'publish' ->> 'inserted')::int = 40 from public.source_snapshots where n = :na), 'el reporte de publicación queda en el snapshot');
select pg_temp.assert((select sum(units) from public.ine_pe_points where snapshot_n = :na) = (select sum(units) from _pe_real), 'la suma de unidades se conserva');

-- consistencia independiente: geo_status coincide con un cálculo aparte con ST_Covers
select pg_temp.assert((select count(*) = 0 from public.ine_pe_points p join public.comunas c on c.cut = p.comuna_cut
  where (p.geo_status = 0) <> ST_Covers(c.geom, p.geom)), 'geo_status 0 <=> ST_Covers (cálculo independiente)');

-- un snapshot validated que quedará MÁS VIEJO que los que se publiquen después
select pg_temp.mk('ine_pe_nacional', 'pe-L', date '2019-01-01', date '2025-12-31', 40) as nl \gset

-- 1b. la base rechaza lo que el ETL no debería enviar
select pg_temp.mk('ine_pe_nacional', 'pe-B', date '2019-01-01', date '2025-12-31', 40, 0, '{"server_count_before":40,"server_count_after":41}') as nb \gset
select pg_temp.stage_pe(:nb);
select pg_temp.raises(format($$ select public.publish_ine_pe_snapshot((select id from public.source_snapshots where n = %s)) $$, :nb),
  'conteo del servidor cambió durante la descarga', '%conteo del servidor cambió%');
select pg_temp.mk('ine_pe_nacional', 'pe-C', date '2019-01-01', date '2025-12-31', 41) as nc \gset
select pg_temp.stage_pe(:nc);
select pg_temp.raises(format($$ select public.publish_ine_pe_snapshot((select id from public.source_snapshots where n = %s)) $$, :nc),
  'staged + rechazadas <> conteo del servidor', '%cuadre de conteos%');
select pg_temp.mk('ine_pe_nacional', 'pe-D', date '2019-01-01', date '2025-12-31', 41, 1) as nd \gset
select pg_temp.stage_pe(:nd);
select pg_temp.raises(format($$ select public.publish_ine_pe_snapshot((select id from public.source_snapshots where n = %s)) $$, :nd),
  'rechazos sobre el máximo configurado (1 de 41 > 0,5 %)', '%superan el máximo configurado%');
select pg_temp.mk('ine_pe_nacional', 'pe-E', date '2019-01-01', date '2025-12-31', 40) as ne \gset
select pg_temp.stage_pe(:ne);
update public.ine_pe_stage set comuna_cut = '99999' where snapshot_n = :ne and src_oid = (select min(oid_) from _pe_real);
select pg_temp.raises(format($$ select public.publish_ine_pe_snapshot((select id from public.source_snapshots where n = %s)) $$, :ne),
  'CUT inexistente en comunas', '%CUT que no existen%');
select pg_temp.mk('ine_pe_nacional', 'pe-F', date '2019-01-01', date '2024-12-31', 40) as nf \gset
select pg_temp.stage_pe(:nf);
select pg_temp.raises(format($$ select public.publish_ine_pe_snapshot((select id from public.source_snapshots where n = %s)) $$, :nf),
  'años fuera del período declarado (2025 > 2024)', '%años fuera del período%');
select pg_temp.mk('ine_pe_nacional', 'pe-G', date '2019-01-01', date '2025-12-31', 40) as ng \gset
select pg_temp.stage_pe(:ng);
update public.ine_pe_stage set lon = lon + 5 where snapshot_n = :ng;      -- SINTÉTICO: todos 5° al este => fuera de su comuna
select pg_temp.raises(format($$ select public.publish_ine_pe_snapshot((select id from public.source_snapshots where n = %s)) $$, :ng),
  'puntos fuera de su comuna sobre el máximo configurado', '%puntos fuera de su comuna%');
select pg_temp.mk('ine_crf_nacional', 'pe-H', date '2019-01-01', date '2025-12-31', 40) as nh \gset
select pg_temp.raises(format($$ select public.publish_ine_pe_snapshot((select id from public.source_snapshots where n = %s)) $$, :nh),
  'snapshot de otra fuente', '%no de ine_pe_nacional%');
update public.source_snapshots set status = 'received' where n = :nb;
select pg_temp.raises(format($$ select public.publish_ine_pe_snapshot((select id from public.source_snapshots where n = %s)) $$, :nb),
  'solo publica snapshots validated', '%debe ser validated%');
select pg_temp.assert((select count(*) from public.ine_pe_points where snapshot_n in (:nb, :nc, :nd, :ne, :nf, :ng)) = 0, 'ningún intento fallido dejó filas (todo o nada)');
select pg_temp.assert((select count(*) from pg_class where relname in (format('ine_pe_points_p%s', :nb), format('ine_pe_points_p%s', :ng))) = 0, 'ni particiones huérfanas');
truncate public.ine_pe_stage;
update public.source_snapshots set status = 'rejected' where n in (:nb, :nc, :nd, :ne, :nf, :ng, :nh);

-- 1c. near_border vs outside_declared con el umbral CONFIGURABLE y retención configurable
update public.pipeline_settings set value = 1000000 where key = 'ine_points.near_border_m';
select pg_temp.mk('ine_pe_nacional', 'pe-I', date '2019-01-01', date '2025-12-31', 41) as ni \gset
select pg_temp.stage_pe(:ni, 3.0);                                         -- SINTÉTICO: 1 fila 3° al este
select public.publish_ine_pe_snapshot((select id from public.source_snapshots where n = :ni)) is not null as ok \gset
select pg_temp.assert((select geo_status = 1 from public.ine_pe_points where snapshot_n = :ni and src_oid = 999999), 'umbral enorme: la fila desplazada es near_border (1)');
select pg_temp.assert((select count(*) = 40 from public.ine_pe_points where snapshot_n = :ni and geo_status = 0), 'las 40 reales siguen dentro');
select pg_temp.assert((select to_regclass('public.ine_pe_points_p' || :na) is null), 'con keep=1 la partición del snapshot anterior se soltó (libera el disco)');
select pg_temp.assert((select status = 'superseded' from public.source_snapshots where n = :na), 'el snapshot anterior queda superseded (su registro se conserva)');

update public.pipeline_settings set value = 0 where key = 'ine_points.near_border_m';
update public.pipeline_settings set value = 2 where key = 'retention.keep_point_snapshots';
select pg_temp.mk('ine_pe_nacional', 'pe-J', date '2019-01-01', date '2025-12-31', 41) as nj \gset
select pg_temp.stage_pe(:nj, 3.0);
select public.publish_ine_pe_snapshot((select id from public.source_snapshots where n = :nj)) is not null as ok \gset
select pg_temp.assert((select geo_status = 2 from public.ine_pe_points where snapshot_n = :nj and src_oid = 999999), 'umbral 0: la fila desplazada es outside_declared (2), no se mueve ni se corrige');
select pg_temp.assert((select abs(ST_X(geom) - ((select lon from _pe_real order by oid_ limit 1) + 3.0)) < 1e-9 from public.ine_pe_points where snapshot_n = :nj and src_oid = 999999), 'el punto conserva EXACTAMENTE las coordenadas que llegaron (no se movió ni se corrigió)');
select pg_temp.assert((select to_regclass('public.ine_pe_points_p' || :ni) is not null), 'con keep=2 se conserva la partición anterior');
select pg_temp.raises(format($$ select public.publish_ine_pe_snapshot((select id from public.source_snapshots where n = %s)) $$, :ni),
  'no se republica un snapshot ya cargado', '%debe ser validated%');
update public.pipeline_settings set value = 1 where key = 'retention.keep_point_snapshots';
update public.pipeline_settings set value = 500 where key = 'ine_points.near_border_m';
select pg_temp.mk('ine_pe_nacional', 'pe-K', date '2019-01-01', date '2025-12-31', 40) as nk \gset
select pg_temp.stage_pe(:nk);
select public.publish_ine_pe_snapshot((select id from public.source_snapshots where n = :nk)) is not null as ok \gset
select pg_temp.assert((select count(*) = 1 from pg_class where relname like 'ine_pe_points_p%' and relkind = 'r' and relname !~ '_(idx|key|pkey|gix)$'), 'con keep=1 vuelve a quedar UNA sola partición');
select pg_temp.raises(format($$ select public.publish_ine_pe_snapshot((select id from public.source_snapshots where n = %s)) $$, :nl),
  'no se publica un snapshot más viejo que el vigente', '%más nuevo publicado%');

-- ============================ 2. INE PE: lectura ============================
select pg_temp.assert((select bool_and(kind = 'cluster') from public.get_ine_permit_points(-76, -56, -66, -17, 4, p_min_precision => 0::smallint)), 'zoom bajo: solo clusters');
select pg_temp.assert((select sum(n_points) from public.get_ine_permit_points(-76, -56, -66, -17, 4, p_min_precision => 0::smallint)) = 40, 'los clusters suman los 40 registros (precisión 0 incluida)');
select pg_temp.assert((select sum(units) from public.get_ine_permit_points(-76, -56, -66, -17, 4, p_min_precision => 0::smallint)) = (select sum(units) from _pe_real), 'los clusters suman las unidades reales');
select pg_temp.assert((select sum(n_points) from public.get_ine_permit_points(-76, -56, -66, -17, 4)) = (select count(*) from _pe_real where prec >= 2),
  'por defecto EXCLUYE precisión BAJA y sin dato');
select pg_temp.assert((select sum(n_points) from public.get_ine_permit_points(-76, -56, -66, -17, 4, p_years => array[2019]::smallint[], p_min_precision => 0::smallint)) = (select count(*) from _pe_real where yr = 2019), 'filtro por año');
select pg_temp.assert((select sum(n_points) from public.get_ine_permit_points(-76, -56, -66, -17, 4, p_uso => array[1]::smallint[], p_min_precision => 0::smallint)) = (select count(*) from _pe_real where uso = 1), 'filtro por destino (uso)');
select (select ST_X(geom) from public.ine_pe_points where snapshot_n = :nk order by src_oid limit 1) as x0, (select ST_Y(geom) from public.ine_pe_points where snapshot_n = :nk order by src_oid limit 1) as y0 \gset
select pg_temp.assert((select count(*) >= 1 and bool_and(kind = 'point') and bool_and(glosa is not null) from public.get_ine_permit_points(:x0 - 0.01, :y0 - 0.01, :x0 + 0.01, :y0 + 0.01, 15, p_min_precision => 0::smallint)), 'zoom alto y pocos: devuelve puntos con su glosa');
select pg_temp.assert((select bool_and(kind = 'cluster') from public.get_ine_permit_points(:x0 - 0.01, :y0 - 0.01, :x0 + 0.01, :y0 + 0.01, 15, p_min_precision => 0::smallint, p_limit => 0)), 'con límite 0 aun a zoom alto agrupa (nunca devuelve miles de puntos)');
select pg_temp.assert((select count(*) from public.get_ine_pe_coverage()) = (select count(distinct yr) from _pe_real), 'cobertura por año calculada desde los datos');
select pg_temp.assert((select bool_and(comunas <= comunas_total and comunas_total = 346) from public.get_ine_pe_coverage()), 'la cobertura informa comunas cubiertas de 346 (no hardcodeado)');
select pg_temp.assert((select count(*) > 0 from public.get_ine_pe_vs_minvu_by_year()), 'el cuadre externo con MINVU responde (diagnóstico, no error)');
select pg_temp.assert((select count(*) > 0 from public.get_ine_pe_comuna_series((select lpad(cod::text, 5, '0') from _pe_real limit 1))), 'serie por comuna para la ficha');

-- ============================ 3. CRF ============================
create temp table _crf_real (oid_ int, cut text, yr int, viv int, gj text) on commit drop;
insert into _crf_real values
  (48, '01101', 2015, 127, '{"type": "Polygon", "coordinates": [[[-70.1437246456738, -20.2270398994657], [-70.1437431851046, -20.2274252810923], [-70.1437436360589, -20.2274542073713], [-70.1437549260854, -20.2274854305848], [-70.1437691868405, -20.2274982546737], [-70.1437945813153, -20.2275046296296], [-70.1438529933683, -20.2274988784298], [-70.1440858950805, -20.2274859877507], [-70.1440882962772, -20.227017151686], [-70.1437246456738, -20.2270398994657]]]}'),
  (49, '01101', 2015, 221, '{"type": "Polygon", "coordinates": [[[-70.1391782298, -20.2459222851829], [-70.1394989301531, -20.2454767723569], [-70.1391725263963, -20.2452760446022], [-70.1388530836846, -20.2457470110096], [-70.1391782298, -20.2459222851829]]]}'),
  (53, '01107', 2015, 61, '{"type": "Polygon", "coordinates": [[[-70.0903215043403, -20.2713518975046], [-70.0910047171314, -20.2716093481968], [-70.0922918690845, -20.2720820843831], [-70.0923465360611, -20.2719416202126], [-70.0921730300573, -20.2718814222066], [-70.0922027391404, -20.2717922395891], [-70.0912769767311, -20.2714511132658], [-70.0913625421602, -20.2712526799945], [-70.0904783726468, -20.2709211404757], [-70.0903215043403, -20.2713518975046]]]}'),
  (54, '01107', 2015, 140, '{"type": "Polygon", "coordinates": [[[-70.1088131627672, -20.2994696176185], [-70.1087858764405, -20.2994025022337], [-70.108678328338, -20.2991379817343], [-70.1084658426373, -20.2990476992937], [-70.107905393613, -20.2992357533194], [-70.1082596307706, -20.3001779780375], [-70.1089238657529, -20.29995221227], [-70.1089968206321, -20.2999274152127], [-70.1089723972361, -20.2998616573272], [-70.1088131627672, -20.2994696176185]]]}'),
  (55, '01107', 2015, 102, '{"type": "Polygon", "coordinates": [[[-70.1006883798244, -20.2597782076658], [-70.101229500697, -20.2590391680279], [-70.1000510448932, -20.2582665414173], [-70.099491425014, -20.2590076924331], [-70.1006883798244, -20.2597782076658]]]}'),
  (56, '01401', 2015, 70, '{"type": "Polygon", "coordinates": [[[-69.7845819293794, -20.2525102140053], [-69.7842081727291, -20.2524875567601], [-69.7842081727291, -20.2525232484092], [-69.7835114672425, -20.2524818460955], [-69.7835128937671, -20.2524390152613], [-69.783243063212, -20.2524261662616], [-69.7826141724445, -20.2523847647647], [-69.7822499433261, -20.2523640113385], [-69.7822214658332, -20.2530455970735], [-69.7823223439447, -20.2531251760908], [-69.7834130550065, -20.2531971414447], [-69.783466599089, -20.2532042266478], [-69.784520698413, -20.2532770406384], [-69.7845454712536, -20.2529257931774], [-69.7845485982891, -20.2528899010401], [-69.7845751542856, -20.2525864457845], [-69.7845819293794, -20.2525102140053]]]}');;
select pg_temp.assert((select count(*) from _crf_real) = 6, '6 polígonos REALES del INE CRF_NACIONAL (sondeo 2026-10-17)');
select pg_temp.assert((select count(*) from _crf_real r join public.comunas c on c.cut = r.cut) = 6, 'sus CUT (normalizados a 5 dígitos) existen en comunas');

-- volumen SINTÉTICO: los 6 polígonos reales duplicados 10 veces con otro src_oid (60) + 1 polígono en corbata (inválido)
create or replace function pg_temp.stage_crf(p_n integer, p_invalid int default 1, p_bad_cut boolean default false, p_point boolean default false) returns void language plpgsql as $$
begin
  insert into public.ine_crf_stage (snapshot_n, src_oid, comuna_cut, year, dwellings, geojson)
  select p_n, oid_ + 1000 * k, cut, yr, viv, gj from _crf_real, generate_series(0, 9) k;
  for i in 1..p_invalid loop       -- SINTÉTICO: polígono en corbata cerca de la primera comuna real
    insert into public.ine_crf_stage (snapshot_n, src_oid, comuna_cut, year, dwellings, geojson)
    select p_n, 900000 + i, cut, yr, viv,
           ST_AsGeoJSON(ST_SetSRID(ST_GeomFromText('POLYGON((' || (x) || ' ' || (y) || ', ' || (x + 0.001) || ' ' || (y + 0.001) || ', ' || (x + 0.001) || ' ' || (y) || ', '
                                                    || (x) || ' ' || (y + 0.001) || ', ' || (x) || ' ' || (y) || '))'), 4326))
      from (select cut, yr, viv, (gj::json -> 'coordinates' -> 0 -> 0 ->> 0)::float8 x, (gj::json -> 'coordinates' -> 0 -> 0 ->> 1)::float8 y from _crf_real limit 1) q;
  end loop;
  if p_bad_cut then update public.ine_crf_stage set comuna_cut = '1401' where snapshot_n = p_n and src_oid = (select min(src_oid) from public.ine_crf_stage where snapshot_n = p_n);   -- sin el cero inicial: char(5) lo rellena con espacio
  end if;
  if p_point then update public.ine_crf_stage set geojson = '{"type":"Point","coordinates":[-70,-33]}' where snapshot_n = p_n and src_oid = (select max(src_oid) from public.ine_crf_stage where snapshot_n = p_n and src_oid < 900000);
  end if;
end $$;

select pg_temp.mk('ine_crf_nacional', 'crf-A', date '2015-01-01', date '2025-12-31', 61) as ca \gset
select pg_temp.stage_crf(:ca);
select public.publish_ine_crf_snapshot((select id from public.source_snapshots where n = :ca)) is not null as ok \gset
select pg_temp.assert((select count(*) = 61 from public.ine_crf_polygons where snapshot_n = :ca), 'publicó los 61 polígonos');
select pg_temp.assert((select count(*) = 1 from public.ine_crf_polygons where snapshot_n = :ca and geom_status > 0), 'el polígono en corbata se REPARÓ (no se rechazó)');
select pg_temp.assert((select count(*) = 1 from public.ine_crf_polygons where snapshot_n = :ca and geom_original is not null and geom_status > 0), 'se conservó el polígono ORIGINAL aparte');
select pg_temp.assert((select count(*) = 1 from public.ine_crf_geom_repairs where snapshot_n = :ca), 'la reparación quedó registrada');
select pg_temp.assert((select bool_and(ST_IsValid(geom)) from public.ine_crf_polygons where snapshot_n = :ca), 'toda geometría publicada es válida');
select pg_temp.assert((select count(*) = 60 from public.ine_crf_polygons where snapshot_n = :ca and geom_status = 0 and geom_original is null), 'las válidas se guardan tal cual, sin original duplicado');
select pg_temp.assert((select sum(dwellings) from public.ine_crf_polygons where snapshot_n = :ca and src_oid < 900000) = (select 10 * sum(viv) from _crf_real), 'N_VIVIENDA se conserva');

select pg_temp.mk('ine_crf_nacional', 'crf-B', date '2015-01-01', date '2025-12-31', 90) as cb \gset
select pg_temp.stage_crf(:cb, 30);   -- SINTÉTICO: 30 inválidos de 90
select pg_temp.raises(format($$ select public.publish_ine_crf_snapshot((select id from public.source_snapshots where n = %s)) $$, :cb),
  'demasiados polígonos inválidos (33 % > 2 %)', '%polígonos inválidos%');
truncate public.ine_crf_stage;
select pg_temp.mk('ine_crf_nacional', 'crf-C', date '2015-01-01', date '2025-12-31', 61) as cc \gset
select pg_temp.stage_crf(:cc, 1, true);
select pg_temp.raises(format($$ select public.publish_ine_crf_snapshot((select id from public.source_snapshots where n = %s)) $$, :cc),
  'CUT sin el cero inicial (1401) se rechaza, no se adivina', '%CUT que no existen%');
truncate public.ine_crf_stage;
select pg_temp.mk('ine_crf_nacional', 'crf-D', date '2015-01-01', date '2025-12-31', 61) as cd \gset
select pg_temp.stage_crf(:cd, 1, false, true);
select pg_temp.raises(format($$ select public.publish_ine_crf_snapshot((select id from public.source_snapshots where n = %s)) $$, :cd),
  'una geometría que no es polígono se rechaza', '%no son polígonos%');
truncate public.ine_crf_stage;
select pg_temp.assert((select count(*) from public.ine_crf_polygons where snapshot_n in (:cb, :cc, :cd)) = 0, 'los intentos fallidos de CRF no dejaron filas');
select pg_temp.assert((select count(*) from public.get_ine_crf_polygons(-76, -56, -66, -17)) = 61, 'RPC de polígonos devuelve los 61 de la caja');
select pg_temp.assert((select count(*) from public.get_ine_crf_polygons(-76, -56, -66, -17, array[2015]::smallint[], 10)) = 11, 'límite 10 devuelve 11 filas (el cliente detecta el truncamiento)');
select pg_temp.assert((select count(*) > 0 and sum(dwellings) > 0 from public.get_ine_crf_by_comuna()), 'agregado por comuna para zoom bajo');
select pg_temp.assert((select count(*) = 1 from public.get_ine_crf_coverage()), 'cobertura por año de los CRF');
select pg_temp.assert((select count(*) from public.ine_pe_points) = (select count(*) from public.ine_pe_points where snapshot_n = :nk), 'CRF no se mezcla con los permisos: tablas separadas');

-- ============================ 4. SEIA ============================
create temp table _seia_real (layer int, exp bigint, oid_ bigint, name text, form text, letter text, tname text, comuna text, status text,
                              presented date, qualified date, invest double precision, x double precision, y double precision, lon double precision, lat double precision) on commit drop;
insert into _seia_real values
  (2, 2147600353, 1, 'Praderas La Dehesa', 'DIA', 'h.1', 'h.1) Proyectos inmobiliarios', 'Lo Barnechea', 'Aprobado', date '2020-08-10', date '2021-03-08', 59217796.0, -71, -33, -70.72022699999997, -33.80201299999993),
  (2, 2147645448, 2, 'Modificación Barrio Los Pinares', 'DIA', 'h.1', 'h.1) Proyectos inmobiliarios', 'Rancagua', 'No Admitido a Tramitación', date '2020-08-14', date '2020-08-14', 30527800.0, -71, -34, -70.70800399999996, -34.14541799999995),
  (2, 2147929752, 6, 'Vicuña Mackenna 3451', 'DIA', 'h.1', 'h.1) Proyectos inmobiliarios', 'San Joaquín', 'Aprobado', date '2020-08-18', date '2021-03-11', 61500000.0, -71, -33, -70.62186114199994, -33.48505410699994),
  (2, 74, 74, 'Edificio El Quisco', 'DIA', 'h.1', 'h.1) Proyectos inmobiliarios', 'El Quisco', 'Aprobado', date '1997-10-06', date '1998-01-19', 20000.0, -71.011943, -32.628538, -71.69919162299993, -33.398674857999936),
  (2, 2147966630, 70, 'Ampliación Centro Comercial Altos del Parque', 'DIA', 'h.1', 'h.1) Proyectos inmobiliarios', 'Peñalolén', 'Aprobado', date '2020-08-21', date '2021-02-22', 525558.0, -71, -33, -70.55512344799996, -33.49898279599995),
  (2, 2147998999, 124, 'Proyecto Inmobiliario La Araucaria Norte', 'DIA', 'h.1', 'h.1) Proyectos inmobiliarios', 'Colina', 'Desistido', date '2020-08-21', date '2020-08-28', 50000000.0, -71, -33, -71.00098699999995, -33.00017999999994),
  (1, 40, 40, 'Ampliación Fábrica ARMAT S.A.', 'EIA', 'h.1', 'h.1) Proyectos inmobiliarios', 'Quilpué', 'Aprobado', date '1997-03-04', date '1997-11-06', 2900000.0, -71, -33, -71.42705411399999, -33.04102211199995),
  (1, 2730, 2730, 'Proyecto Inmobiliario Costa Quilén Lote 1', 'EIA', 'h.1', 'h.1) Proyectos inmobiliarios', 'Puchuncaví', 'Aprobado', date '2000-03-10', date '2000-07-03', 21000000.0, -71, -32, -71.47061399999996, -32.72445499999998),
  (1, 3180, 3180, 'Huertos Familiares 2000', 'EIA', 'h.1', 'h.1) Proyectos inmobiliarios', 'Tiltil', 'Aprobado', date '2000-09-08', date '2001-09-04', 65000000.0, -70, -33, -70.78950263099995, -33.17397397399998),
  (1, 3930, 3930, 'Hacienda Santa Martina Nature Club & Golf', 'EIA', 'h.1', 'h.1) Proyectos inmobiliarios', 'Lo Barnechea', 'Aprobado', date '2001-05-24', date '2001-10-31', 25000000.0, -70, -33, -70.54031199999997, -33.28095199999996);
select pg_temp.assert((select count(*) = 10 from _seia_real), '10 proyectos REALES del SEIA (6 DIA + 4 EIA, sondeo 2026-10-17)');
select pg_temp.assert((select count(*) = 1 from _seia_real where exp = 2147600353 and comuna = 'Lo Barnechea'), 'incluye Praderas La Dehesa (expediente 2147600353, Lo Barnechea)');
select pg_temp.assert((select max(exp) > 2147483647 from _seia_real), 'hay ID_EXPEDIENTE mayor que 2^31-1 (por eso bigint)');

create or replace function pg_temp.stage_seia(p_n integer, p_layer int, p_letter text default null, p_dup boolean default false) returns void language plpgsql as $$
begin
  insert into public.seia_stage (snapshot_n, service_layer, expediente_id, src_oid, name, form, typology_letter, typology_name, region_declared, comunas_declared,
                                 comuna_cuts, status_declared, submitted_at, qualified_at, investment_usd, x_raw, y_raw, modificado, lon, lat)
  select p_n, layer, exp, oid_, name, form, coalesce(p_letter, letter), tname, null, comuna,
         coalesce((select array_agg(c.cut) from public.comunas c where c.name_norm = lower(translate(r.comuna, 'áéíóúñÁÉÍÓÚÑ', 'aeiounaeioun'))), '{}'),
         status, presented, qualified, invest, x, y, 1, lon, lat
    from _seia_real r where layer = p_layer;
  if p_dup then
    insert into public.seia_stage (snapshot_n, service_layer, expediente_id, src_oid, name, form, typology_letter, typology_name, status_declared, lon, lat)
    select p_n, layer, exp, oid_ + 1, name, form, letter, tname, status, lon, lat from _seia_real where layer = p_layer limit 1;
  end if;
end $$;

select pg_temp.mk('seia_proyectos_dia', 'seia-A', date '2026-10-17', date '2026-10-17', 26, 0,
                  '{"server_count_before":26,"server_count_after":26,"typology_excluded_count":20}') as sa \gset
select pg_temp.stage_seia(:sa, 2);
select public.publish_seia_snapshot((select id from public.source_snapshots where n = :sa)) is not null as ok \gset
select pg_temp.assert((select count(*) = 6 from public.building_projects where snapshot_n = :sa and service_layer = 2), 'publicó los 6 DIA reales (el resto son excluidos por tipología: 20)');
select pg_temp.assert((select geo_status = 2 and geo_distance_m > 1000 from public.building_projects where expediente_id = 2147600353),
  'Praderas La Dehesa queda outside_declared con su distancia (> 1 km): el caso reportado, con datos reales');
select pg_temp.assert((select ST_Y(geom) between -33.8021 and -33.8020 from public.building_projects where expediente_id = 2147600353), 'y su punto original NO se movió (-33,802013)');
select pg_temp.assert((select count(*) = 0 from public.building_projects p join public.comunas c on c.cut = p.comuna_cuts[1]
  where p.geo_status = 0 and not ST_Covers(c.geom, p.geom)), 'geo_status 0 <=> ST_Covers (cálculo independiente)');
select pg_temp.assert((select bool_and(geo_status in (0, 1, 2)) from public.building_projects where snapshot_n = :sa), 'todas las comunas se cruzaron a CUT por nombre');
select pg_temp.assert((select status_declared = 'No Admitido a Tramitación' from public.building_projects where expediente_id = 2147645448), 'el estado de evaluación se conserva tal cual (No Admitido a Tramitación)');
select pg_temp.assert((select submitted_at = date '2020-08-10' from public.building_projects where expediente_id = 2147600353), 'FECHA_PRESENTACION de Praderas = 2020-08-10 (medianoche UTC, sin correr un día)');

select pg_temp.mk('seia_proyectos_dia', 'seia-B', date '2026-10-17', date '2026-10-17', 26, 0, '{"server_count_before":26,"server_count_after":26}') as sb \gset
select pg_temp.stage_seia(:sb, 2);
select pg_temp.raises(format($$ select public.publish_seia_snapshot((select id from public.source_snapshots where n = %s)) $$, :sb),
  'falta typology_excluded_count', '%falta typology_excluded_count%');
truncate public.seia_stage;
select pg_temp.mk('seia_proyectos_dia', 'seia-C', date '2026-10-17', date '2026-10-17', 26, 0,
                  '{"server_count_before":26,"server_count_after":26,"typology_excluded_count":19}') as sc \gset
select pg_temp.stage_seia(:sc, 2);
select pg_temp.raises(format($$ select public.publish_seia_snapshot((select id from public.source_snapshots where n = %s)) $$, :sc),
  'cuadre: cargados + excluidos + rechazados <> servidor', '%cuadre de conteos%');
truncate public.seia_stage;
select pg_temp.mk('seia_proyectos_dia', 'seia-D', date '2026-10-17', date '2026-10-17', 26, 0,
                  '{"server_count_before":26,"server_count_after":26,"typology_excluded_count":20}') as sd \gset
select pg_temp.stage_seia(:sd, 2, 'i.1');
select pg_temp.raises(format($$ select public.publish_seia_snapshot((select id from public.source_snapshots where n = %s)) $$, :sd),
  'una tipología excluida (minería i.1) no puede entrar', '%tipologías no incluidas%');
truncate public.seia_stage;
select pg_temp.mk('seia_proyectos_dia', 'seia-E', date '2026-10-17', date '2026-10-17', 27, 0,
                  '{"server_count_before":27,"server_count_after":27,"typology_excluded_count":20}') as se \gset
select pg_temp.stage_seia(:se, 2, null, true);
select pg_temp.raises(format($$ select public.publish_seia_snapshot((select id from public.source_snapshots where n = %s)) $$, :se),
  'ID_EXPEDIENTE duplicado', '%duplicado%');
truncate public.seia_stage;
select pg_temp.mk('seia_proyectos_eia', 'seia-F', date '2026-10-17', date '2026-10-17', 4, 0,
                  '{"server_count_before":4,"server_count_after":4,"typology_excluded_count":0}') as sf \gset
select pg_temp.stage_seia(:sf, 2);       -- filas de la capa 2 en un snapshot EIA
select pg_temp.raises(format($$ select public.publish_seia_snapshot((select id from public.source_snapshots where n = %s)) $$, :sf),
  'filas de otra capa en un snapshot', '%otra capa%');
truncate public.seia_stage;
select pg_temp.stage_seia(:sf, 1);
select public.publish_seia_snapshot((select id from public.source_snapshots where n = :sf)) is not null as ok \gset
select pg_temp.assert((select count(*) = 4 from public.building_projects where snapshot_n = :sf and service_layer = 1), 'publicó los 4 EIA reales');
select pg_temp.assert((select count(*) = 2 from public._seia_current_snapshots()), 'EIA y DIA tienen cada uno su captura vigente');
select pg_temp.assert((select count(*) = 10 from public.get_seia_projects()), 'get_seia_projects devuelve las dos capas');
select pg_temp.assert((select count(*) = 4 from public.get_seia_projects(-180, -90, 180, 90, p_forms => array['EIA'])), 'filtro por forma de presentación (EIA)');
select pg_temp.assert((select count(*) > 0 from public.get_seia_projects(-180, -90, 180, 90, p_states => array['Aprobado'])), 'filtro por estado de evaluación');
select pg_temp.assert((select count(*) > 0 from public.get_seia_summary()), 'resumen por estado y calidad de ubicación');

-- revisiones humanas: append-only, por proyecto, el original no se toca
insert into public.building_project_geo_reviews (service_layer, expediente_id, decision, proposed_lon, proposed_lat, note)
values (2, 2147600353, 'propose_correction', -70.5, -33.35, 'Prueba: corrección PROPUESTA (sintética) para Praderas La Dehesa');
select pg_temp.assert((select review_decision = 'propose_correction' and proposed_lat = -33.35 from public.get_seia_projects() where expediente_id = 2147600353), 'la corrección propuesta se muestra aparte');
select pg_temp.assert((select lat between -33.8021 and -33.8020 from public.get_seia_projects() where expediente_id = 2147600353), 'y el punto original sigue intacto');
select pg_temp.raises($$ update public.building_project_geo_reviews set note = 'x' $$, 'las revisiones no se modifican', '%solo de agregado%');
select pg_temp.raises($$ delete from public.building_project_geo_reviews $$, 'las revisiones no se borran', '%solo de agregado%');
select pg_temp.raises($$ insert into public.building_project_geo_reviews (service_layer, expediente_id, decision, note) values (2, 1, 'propose_correction', 'sin coordenadas') $$,
  'una corrección exige coordenadas', '%geo_reviews_correction_has_coords%');

-- ============================ 5. PERMISOS (RLS y roles) ============================
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000aa') on conflict do nothing;   -- el admin del esquema de prueba
set local role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000bb', true);        -- usuario normal
select pg_temp.assert((select count(*) > 0 from public.get_ine_permit_points(-76, -56, -66, -17, 4)), 'authenticated lee puntos por la RPC');
select pg_temp.assert((select count(*) > 0 from public.ine_pe_points), 'authenticated lee ine_pe_points por el padre (RLS permite lectura)');
select pg_temp.raises(format($$ select * from public.ine_pe_points_p%s $$, :nk), 'authenticated NO accede a la partición directa', '%permission denied%');
select pg_temp.raises($$ select public.publish_ine_pe_snapshot('00000000-0000-0000-0000-00000000000a') $$, 'authenticated no publica INE PE', '%permission denied%');
select pg_temp.raises($$ select public.publish_ine_crf_snapshot('00000000-0000-0000-0000-00000000000a') $$, 'authenticated no publica CRF', '%permission denied%');
select pg_temp.raises($$ select public.publish_seia_snapshot('00000000-0000-0000-0000-00000000000a') $$, 'authenticated no publica SEIA', '%permission denied%');
select pg_temp.raises($$ select * from public.ine_pe_stage $$, 'authenticated no ve la zona de paso', '%permission denied%');
select pg_temp.raises($$ insert into public.ine_pe_glosas (glosa) values ('x') $$, 'authenticated no escribe glosas', '%permission denied%');
select pg_temp.raises($$ insert into public.building_project_geo_reviews (service_layer, expediente_id, decision, note, reviewed_by) values (2, 1, 'confirm_original', 'x', null) $$,
  'un usuario normal no crea revisiones', '%row-level security%');
select pg_temp.assert((select count(*) = 0 from public.geo_rejected_rows), 'no-admin no ve filas rechazadas (RLS filtra)');
select set_config('test.uid', '00000000-0000-0000-0000-0000000000aa', true);        -- admin
insert into public.building_project_geo_reviews (service_layer, expediente_id, decision, note, reviewed_by)
values (2, 2147600353, 'confirm_original', 'Prueba admin', '00000000-0000-0000-0000-0000000000aa');
select pg_temp.assert((select count(*) = 2 from public.building_project_geo_reviews), 'un admin sí crea revisiones (con su propio uuid)');
reset role;
set local role anon;
select pg_temp.raises($$ select * from public.ine_pe_points $$, 'anon no lee puntos', '%permission denied%');
select pg_temp.raises($$ select * from public.building_projects $$, 'anon no lee proyectos', '%permission denied%');
select pg_temp.raises($$ select * from public.ine_crf_polygons $$, 'anon no lee polígonos', '%permission denied%');
reset role;

rollback;
