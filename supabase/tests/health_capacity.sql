-- =============================================================================
-- Pruebas de 20261108000000_health_capacity.sql. NO es una migración. Receta (una transacción que termina en error):
--   <20261108000000_health_capacity.sql> (dos veces: idempotencia) + <este archivo> + do $$ begin raise exception 'DRYRUN_OK %', (select count(*) from _tr); end $$;
-- Requiere `comunas` sembrada, 1a (health_establishments) y los roles de la plataforma (anon/authenticated/service_role).
-- DATOS: TODOS los valores son SINTÉTICOS (rotulados «FIXTURE»). Las cifras reales (Tisné, Buin…) se verifican con los archivos reales en el runbook y en el informe del PR, no aquí.
-- =============================================================================
create temp table _tr (seq serial primary key, name text not null);
grant all on _tr to public;
grant all on sequence _tr_seq_seq to public;
create or replace function pg_temp.assert_that(p_name text, p_cond boolean, p_detail text default null) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL [%]: %', p_name, coalesce(p_detail, 'condición falsa'); end if;
  insert into _tr (name) values (p_name);
end $$;
create or replace function pg_temp.jnull(x jsonb) returns boolean language sql immutable as $$ select x is null or x = 'null'::jsonb $$;
create or replace function pg_temp.as_role(p_role text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('role', p_role)::text, true); execute format('set local role %I', p_role); end $$;
create or replace function pg_temp.reset_role() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create or replace function pg_temp.try_sql(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'OK'; exception when others then return sqlstate || ':' || sqlerrm; end $$;
create or replace function pg_temp.raises_like(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return sqlerrm like p_like; end $$;

delete from public.source_checks where source_id in (select id from public.data_sources where source_key in ('deis_rem20_hospitalizacion', 'deis_dotacion_camas'));
delete from public.source_snapshots where source_id in (select id from public.data_sources where source_key in ('deis_rem20_hospitalizacion', 'deis_dotacion_camas'));
delete from public.health_rem20_month_stage;
delete from public.health_beds_dotacion_stage;

-- ------------------------------ FIXTURE de establecimientos: una captura vigente con 5 códigos ------------------------------
insert into public.source_snapshots (source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, granularity, row_count_raw, status, loaded_at)
  select d.id, 'test', 'manual_download', 'https://example.test/est', 'test/est', encode(sha256('est'::bytea), 'hex'), current_date, current_date, 'snapshot', 5, 'loaded', now()
    from public.data_sources d where d.source_key = 'deis_establecimientos';
insert into public.health_establishments (snapshot_n, code, name, region_cut, comuna_cut, tipo_glosa, tipo_norm, dependencia_norm, snss, complejidad, tipo_atencion, clase_servicio, clase_fuente,
                                          alta_hospital, alta_ampliada, estado, geo_status)
  select s.n, v.code, v.name, '13', '13101', 'Hospital', 'hospital', v.dep, v.snss, 'alta', 'hospitalaria', 'hospitalario', 'oficial', false, false, 'vigente', 4
    from public.source_snapshots s,
         (values ('112101', 'FIXTURE Hospital Tisné', 'servicio_salud', true), ('113150', 'FIXTURE Hospital Buin', 'servicio_salud', true),
                 ('124210', 'FIXTURE Clínica privada', 'privado', false), ('104102', 'FIXTURE Hospital sin total', 'servicio_salud', true),
                 ('900001', 'FIXTURE Clínica privada sin ningún dato', 'privado', false)) v(code, name, dep, snss)
   where s.storage_path = 'test/est';

-- ------------------------------ helpers de cargas ------------------------------
create or replace function pg_temp.mk(p_source text, p_tag text, p_start date, p_end date, p_gran text) returns integer language plpgsql as $$
declare v integer;
begin
  insert into public.source_snapshots (source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, declared_date, declared_date_note, granularity, row_count_raw, status)
  select d.id, 'test', 'automatic_download', 'https://example.test/' || p_tag, 'test/' || p_tag, encode(sha256(p_tag::bytea), 'hex'), p_start, p_end, date '2025-10-20', 'cabecera HTTP Last-Modified', p_gran, 0, 'validated'
    from public.data_sources d where d.source_key = p_source returning n into v;
  return v;
end $$;

-- REM 20: Tisné (112101) áreas 402 y 330 todos los meses [p_from, p_to]; Buin (113150) área 403 solo jul-dic 2025 (6 meses; julio es una clave duplicada ya sumada, filas = 2).
-- Valores: Tisné 402 = 100 ocupados / 120 disponibles; 330 = 10 / 40; en el ÚLTIMO mes 402 = 90 / 100 y 330 = 5 / 0 (disponibles 0).
create or replace function pg_temp.rem_stage(p_n int, p_from date, p_to date) returns void language plpgsql as $$
begin
  insert into public.health_rem20_month_stage (snapshot_n, code, period, area, dias_cama_ocupados, dias_cama_disponibles, dias_estada, egresos, egresos_fallecidos, traslados, filas)
  select p_n, '112101', m::date, a.area,
         case when m::date = date_trunc('month', p_to)::date then a.o_last else a.o end, case when m::date = date_trunc('month', p_to)::date then a.d_last else a.d end, 1, 1, 0, 0, 1
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 month') m,
         (values (402, 100, 120, 90, 100), (330, 10, 40, 5, 0)) a(area, o, d, o_last, d_last);
  if p_from <= date '2025-07-01' and p_to >= date '2025-12-01' then
    insert into public.health_rem20_month_stage (snapshot_n, code, period, area, dias_cama_ocupados, dias_cama_disponibles, dias_estada, egresos, egresos_fallecidos, traslados, filas)
    select p_n, '113150', m::date, 403, 50, 100, 1, 1, 0, 0, case when m::date = date '2025-07-01' then 2 else 1 end
      from generate_series(timestamp '2025-07-01', timestamp '2025-12-01', interval '1 month') m;
  end if;
end $$;
create or replace function pg_temp.rem_rep(p_n int) returns void language plpgsql as $$
begin
  update public.source_snapshots set row_count_raw = (select sum(filas) from public.health_rem20_month_stage where snapshot_n = p_n),
    validation_report = jsonb_build_object(
      'rows_raw', (select sum(filas) from public.health_rem20_month_stage where snapshot_n = p_n),
      'rows_stage', (select count(*) from public.health_rem20_month_stage where snapshot_n = p_n),
      'establecimientos', (select count(distinct code) from public.health_rem20_month_stage where snapshot_n = p_n),
      'totales', (select jsonb_build_object('dias_cama_ocupados', sum(dias_cama_ocupados), 'dias_cama_disponibles', sum(dias_cama_disponibles), 'dias_estada', sum(dias_estada), 'egresos', sum(egresos))
                    from public.health_rem20_month_stage where snapshot_n = p_n))
   where n = p_n;
end $$;
create or replace function pg_temp.rem_pub(p_tag text) returns jsonb language sql as $$
  select public.publish_health_rem20_snapshot((select id from public.source_snapshots where storage_path = 'test/' || p_tag))
$$;

-- Dotación 2024-2025: Tisné 296 (2024) y 280 (2025, áreas 402 = 200 y 330 = 80); Buin 100; clínica privada 12 solo en 2024; «sin total»: 2025 con un área y SIN fila de total.
create or replace function pg_temp.dot_stage(p_n int) returns void language plpgsql as $$
begin
  insert into public.health_beds_dotacion_stage (snapshot_n, code, year, area, beds) values
    (p_n, '112101', 2024, 100, 296), (p_n, '112101', 2024, 402, 216), (p_n, '112101', 2024, 330, 80),
    (p_n, '112101', 2025, 100, 280), (p_n, '112101', 2025, 402, 200), (p_n, '112101', 2025, 330, 80),
    (p_n, '113150', 2024, 100, 100), (p_n, '113150', 2025, 100, 100), (p_n, '113150', 2025, 403, 100),
    (p_n, '124210', 2024, 100, 12), (p_n, '124210', 2024, 403, 12),
    (p_n, '104102', 2025, 403, 5);
end $$;
create or replace function pg_temp.dot_rep(p_n int) returns void language plpgsql as $$
begin
  update public.source_snapshots set row_count_raw = (select count(*) from public.health_beds_dotacion_stage where snapshot_n = p_n),
    validation_report = jsonb_build_object(
      'rows_stage', (select count(*) from public.health_beds_dotacion_stage where snapshot_n = p_n),
      'establecimientos', (select count(distinct code) from public.health_beds_dotacion_stage where snapshot_n = p_n),
      'total_pais', (select jsonb_object_agg(year::text, t) from (select year, sum(beds) t from public.health_beds_dotacion_stage where snapshot_n = p_n and area = 100 group by year) a))
   where n = p_n;
end $$;
create or replace function pg_temp.dot_pub(p_tag text) returns jsonb language sql as $$
  select public.publish_health_dotacion_snapshot((select id from public.source_snapshots where storage_path = 'test/' || p_tag))
$$;

-- =============================== 0. Estructura, procedencia y permisos ===============================
select pg_temp.assert_that('REM 20: fuente sembrada con CC0, comprobada, con el hash del archivo leído y la nota de la URL que cambia',
  (select license_label like '%CC0%' and license_url like '%cc-zero%' and verification_status = 'comprobado' and dataset = 'health_rem20'
          and verification_note like '%5085664576302b361f9207ce13b96acacd4a29da16477ebf2cccbce487571559%' and verification_note like '%cambia con cada publicación%'
          and scope_note like '%NO incluye clínicas privadas%' and data_url like 'https://datos.gob.cl/%'
     from public.data_sources where source_key = 'deis_rem20_hospitalizacion'));
select pg_temp.assert_that('dotación: fuente sembrada con la licencia [NO COMPROBADO] (sin URL de licencia), el hash del archivo 2010-2025 y la distinción dotación ≠ camas disponibles',
  (select license_label like '%[NO COMPROBADO]%' and license_url is null and dataset = 'health_camas'
          and verification_note like '%ef5ca45f30c1e3937621e489826766cb9844c5bca0253a375be4851f28ba078f%' and verification_note like '%LICENCIA [NO COMPROBADO]%'
          and scope_note like '%NO es «camas disponibles»%' and data_url like '%2010-2025%'
     from public.data_sources where source_key = 'deis_dotacion_camas'));
select pg_temp.assert_that('umbral de retención sembrado (2 capturas)', public.pipeline_setting('retention.keep_capacidad_snapshots') = 2);
select pg_temp.assert_that('client_ready por campo: dotación y ocupación nacen en FALSE, con su nota',
  (select count(*) = 2 and bool_and(client_ready is false) and bool_and(client_ready_note is not null) from public.health_capacity_fields)
  and (select client_ready_note like '%[NO COMPROBADO]%' from public.health_capacity_fields where field_key = 'dotacion'));
select pg_temp.assert_that('las 29 áreas funcionales + el total (100) están sembradas; NO existe health_theatres_month (pabellones van en otro PR)',
  (select count(*) = 30 from public.health_areas_funcionales) and (select nombre like '%Pensionado' from public.health_areas_funcionales where area = 330)
  and to_regclass('public.health_theatres_month') is null);
select pg_temp.assert_that('sin captura vigente get_health_capacity devuelve todo NULL (jamás un 0): el front dice «sin dato»',
  (select r -> 'dotacion' = 'null'::jsonb or pg_temp.jnull(r -> 'dotacion') from (select public.get_health_capacity('112101') r) x)
  and (select pg_temp.jnull(r -> 'ocupacion_anual') or r -> 'ocupacion_anual' = 'null'::jsonb from (select public.get_health_capacity('112101') r) x)
  and (select (r -> 'fuentes' ->> 'rem20') is null from (select public.get_health_capacity('112101') r) x));
select pg_temp.assert_that('las tablas publicadas rechazan valores fuera de dominio (área 100 en REM 20, área inexistente, negativos, mes que no es día 1)',
  pg_temp.try_sql($$insert into public.health_rem20_month values (1, '112101', date '2025-01-01', 100, 1, 1, 1, 1, 0, 0, 1)$$) like '23514%'
  and pg_temp.try_sql($$insert into public.health_rem20_month values (1, '112101', date '2025-01-01', 999, 1, 1, 1, 1, 0, 0, 1)$$) like '23503%'
  and pg_temp.try_sql($$insert into public.health_rem20_month values (1, '112101', date '2025-01-15', 402, 1, 1, 1, 1, 0, 0, 1)$$) like '23514%'
  and pg_temp.try_sql($$insert into public.health_beds_dotacion values (1, '112101', 2025, 402, -1)$$) like '23514%');

-- =============================== 1. Dotación ===============================
select pg_temp.mk('deis_dotacion_camas', 'd1', date '2024-01-01', date '2025-12-31', 'year');
select pg_temp.dot_stage((select n from public.source_snapshots where storage_path = 'test/d1'));
select pg_temp.dot_rep((select n from public.source_snapshots where storage_path = 'test/d1'));
create temp table _d1 as select pg_temp.dot_pub('d1') as r;
select pg_temp.assert_that('publicó las 12 filas; el snapshot quedó loaded con su URL, hash y fecha declarada; la zona de paso quedó vacía',
  (select (r ->> 'filas')::int = 12 and (r ->> 'establecimientos')::int = 4 from _d1)
  and (select status from public.source_snapshots where storage_path = 'test/d1') = 'loaded'
  and (select count(*) from public.health_beds_dotacion_stage) = 0
  and (select origin_url = 'https://example.test/d1' and declared_date = date '2025-10-20' and sha256 = encode(sha256('d1'::bytea), 'hex') from public._health_capacity_current_snapshot('deis_dotacion_camas')));
select pg_temp.assert_that('get_health_capacity: dotación 2025 de Tisné = total publicado 280 con sus áreas tal cual (200 + 80), SIN recalcular',
  (select (r -> 'dotacion' ->> 'year')::int = 2025 and (r -> 'dotacion' ->> 'total')::int = 280 and jsonb_array_length(r -> 'dotacion' -> 'areas') = 2
          and (r -> 'dotacion' -> 'areas' -> 0 ->> 'camas')::int = 80 and (r -> 'dotacion' -> 'areas' -> 0 ->> 'area')::int = 330
          and (r -> 'dotacion' -> 'areas' -> 0 ->> 'nombre') like '%Pensionado' and (r -> 'dotacion' -> 'areas' -> 1 ->> 'camas')::int = 200
     from (select public.get_health_capacity('112101') r) x));
select pg_temp.assert_that('un establecimiento con dotación solo en un año anterior (clínica privada, 2024) queda «sin dato» en el último año: NO se arrastra el valor viejo',
  (select pg_temp.jnull(r -> 'dotacion') or r -> 'dotacion' = 'null'::jsonb from (select public.get_health_capacity('124210') r) x));
select pg_temp.assert_that('sin fila de total en el último año: el total es NULL («sin dato»), las áreas publicadas se muestran; no se suma el total',
  (select (r -> 'dotacion' -> 'total') = 'null'::jsonb and jsonb_array_length(r -> 'dotacion' -> 'areas') = 1 from (select public.get_health_capacity('104102') r) x));
select pg_temp.assert_that('la fuente de dotación viaja con la licencia [NO COMPROBADO] y client_ready = false para el campo',
  (select (r -> 'fuentes' -> 'dotacion' ->> 'license_label') like '%[NO COMPROBADO]%' and (r -> 'fuentes' -> 'dotacion' ->> 'sha256') = encode(sha256('d1'::bytea), 'hex')
          and (r -> 'fuentes' -> 'dotacion' ->> 'origin_url') = 'https://example.test/d1' and (r -> 'fuentes' -> 'dotacion' ->> 'declared_date') = '2025-10-20'
          and (r -> 'client_ready' -> 'dotacion' ->> 'client_ready') = 'false'
     from (select public.get_health_capacity('112101') r) x));

-- Todo o nada de la dotación
select pg_temp.mk('deis_dotacion_camas', 'd_n', date '2024-01-01', date '2026-12-31', 'year');
select pg_temp.dot_stage((select n from public.source_snapshots where storage_path = 'test/d_n'));
update public.health_beds_dotacion_stage set year = 2026 where snapshot_n = (select n from public.source_snapshots where storage_path = 'test/d_n') and year = 2025;
select pg_temp.dot_rep((select n from public.source_snapshots where storage_path = 'test/d_n'));
update public.source_snapshots set validation_report = jsonb_set(validation_report, '{total_pais,2024}', to_jsonb((validation_report -> 'total_pais' ->> '2024')::bigint + 1)) where storage_path = 'test/d_n';
select pg_temp.assert_that('«Total País» del archivo que no cuadra con Σ de los totales detiene la publicación', pg_temp.raises_like($$select pg_temp.dot_pub('d_n')$$, '%cuadre con «Total País»%2024%'));
select pg_temp.dot_rep((select n from public.source_snapshots where storage_path = 'test/d_n'));
update public.health_beds_dotacion_stage set code = '999999' where code = '124210';
select pg_temp.dot_rep((select n from public.source_snapshots where storage_path = 'test/d_n'));
select pg_temp.assert_that('un código que no existe en la captura vigente de establecimientos detiene la publicación (lista el código)', pg_temp.raises_like($$select pg_temp.dot_pub('d_n')$$, '%999999%'));
update public.health_beds_dotacion_stage set code = '124210' where code = '999999';
update public.health_beds_dotacion_stage set area = 777 where code = '124210' and area = 403;
select pg_temp.dot_rep((select n from public.source_snapshots where storage_path = 'test/d_n'));
select pg_temp.assert_that('un área funcional desconocida detiene la publicación', pg_temp.raises_like($$select pg_temp.dot_pub('d_n')$$, '%áreas funcionales no registradas%777%'));
update public.health_beds_dotacion_stage set area = 403 where area = 777;
insert into public.health_beds_dotacion_stage select * from public.health_beds_dotacion_stage where code = '113150' and area = 403 limit 1;
select pg_temp.dot_rep((select n from public.source_snapshots where storage_path = 'test/d_n'));
select pg_temp.assert_that('una clave (código, año, área) repetida detiene la publicación', pg_temp.raises_like($$select pg_temp.dot_pub('d_n')$$, '%repetida%'));
delete from public.health_beds_dotacion_stage where ctid in (select ctid from public.health_beds_dotacion_stage where code = '113150' and area = 403 limit 1);
select pg_temp.dot_rep((select n from public.source_snapshots where storage_path = 'test/d_n'));
update public.health_beds_dotacion_stage set beds = -1 where code = '113150' and area = 403;
select pg_temp.assert_that('camas negativas detienen la publicación', pg_temp.raises_like($$select pg_temp.dot_pub('d_n')$$, '%fuera de dominio%'));
update public.health_beds_dotacion_stage set beds = 100 where code = '113150' and area = 403;
select pg_temp.dot_rep((select n from public.source_snapshots where storage_path = 'test/d_n'));
update public.source_snapshots set validation_report = validation_report - 'total_pais' where storage_path = 'test/d_n';
select pg_temp.assert_that('sin «Total País» en el reporte NO se publica (el cuadre es obligatorio)', pg_temp.raises_like($$select pg_temp.dot_pub('d_n')$$, '%falta total_pais%'));
select pg_temp.assert_that('un snapshot de REM 20 no se publica como dotación', pg_temp.raises_like($$select pg_temp.dot_pub('est')$$, '%no de la dotación%'));
select pg_temp.assert_that('tras los intentos fallidos sigue vigente la captura anterior, intacta (todo o nada)',
  (select snapshot_id from public._health_capacity_current_snapshot('deis_dotacion_camas')) = (select id from public.source_snapshots where storage_path = 'test/d1')
  and (select count(*) from public.health_beds_dotacion b join public.source_snapshots s on s.n = b.snapshot_n where s.storage_path = 'test/d_n') = 0);
delete from public.health_beds_dotacion_stage;

-- =============================== 2. REM 20: ocupación ===============================
select pg_temp.mk('deis_rem20_hospitalizacion', 'r1', date '2025-01-01', date '2026-08-31', 'month');
select pg_temp.rem_stage((select n from public.source_snapshots where storage_path = 'test/r1'), date '2025-01-01', date '2026-08-01');
select pg_temp.rem_rep((select n from public.source_snapshots where storage_path = 'test/r1'));
create temp table _r1 as select pg_temp.rem_pub('r1') as r;
select pg_temp.assert_that('publicó las filas (20 meses × 2 áreas de Tisné + 6 de Buin = 46) y sumó la clave duplicada (filas = 2)',
  (select (r ->> 'filas')::int = 46 and (r ->> 'establecimientos')::int = 2 and (r ->> 'claves_duplicadas_sumadas')::int = 1 from _r1)
  and (select filas from public.health_rem20_month m join public.source_snapshots s on s.n = m.snapshot_n where s.storage_path = 'test/r1' and code = '113150' and period = date '2025-07-01') = 2);
select pg_temp.assert_that('ÍNDICE DEL HOSPITAL 2025 de Tisné = Σ ocupados / Σ disponibles = 1.320 / 1.920 = 68,75 % (NO el promedio de los índices por área, que daría 54,17 %)',
  (select (r -> 'ocupacion_anual' ->> 'year')::int = 2025 and (r -> 'ocupacion_anual' ->> 'months')::int = 12 and (r -> 'ocupacion_anual' ->> 'ocupados')::int = 1320
          and (r -> 'ocupacion_anual' ->> 'disponibles')::int = 1920 and (r -> 'ocupacion_anual' ->> 'indice')::numeric = 68.75
     from (select public.get_health_capacity('112101') r) x));
select pg_temp.assert_that('desglose por área del año: 402 = 1.200 / 1.440 = 83,33 y 330 = 120 / 480 = 25,00',
  (select (r -> 'ocupacion_anual' -> 'areas' -> 1 ->> 'indice')::numeric = 83.33 and (r -> 'ocupacion_anual' -> 'areas' -> 0 ->> 'indice')::numeric = 25.00
          and (r -> 'ocupacion_anual' -> 'areas' -> 0 ->> 'area')::int = 330 and (r -> 'ocupacion_anual' -> 'areas' -> 0 ->> 'nombre') like '%Pensionado'
     from (select public.get_health_capacity('112101') r) x));
select pg_temp.assert_that('ÚLTIMO MES 2026-08 de Tisné: 95 / 100 = 95,00 %; el área 330 tiene 0 días-cama disponibles ⇒ su índice es NULL («sin dato»), no 0 %',
  (select r -> 'ocupacion_mes' ->> 'period' = '2026-08' and (r -> 'ocupacion_mes' ->> 'ocupados')::int = 95 and (r -> 'ocupacion_mes' ->> 'disponibles')::int = 100
          and (r -> 'ocupacion_mes' ->> 'indice')::numeric = 95.00
          and (r -> 'ocupacion_mes' -> 'areas' -> 0 ->> 'area')::int = 330 and (r -> 'ocupacion_mes' -> 'areas' -> 0 -> 'indice') = 'null'::jsonb
     from (select public.get_health_capacity('112101') r) x));
select pg_temp.assert_that('Buin: año con SOLO 6 meses informados ⇒ months = 6 de 12 (se muestra incompleto, no se completa) y 300 / 600 = 50,00 %; sin fila en 2026-08 ⇒ último mes «sin dato»',
  (select (r -> 'ocupacion_anual' ->> 'months')::int = 6 and (r -> 'ocupacion_anual' ->> 'expected_months')::int = 12 and (r -> 'ocupacion_anual' ->> 'indice')::numeric = 50.00
          and pg_temp.jnull(r -> 'ocupacion_mes')
     from (select public.get_health_capacity('113150') r) x));
select pg_temp.assert_that('privado SIN ningún dato (900001) y privado con dotación vieja (124210): todo NULL y snss = false para que el front explique «sin dato»',
  (select (r ->> 'snss') = 'false' and r ->> 'dependencia_norm' = 'privado' and pg_temp.jnull(r -> 'dotacion') and pg_temp.jnull(r -> 'ocupacion_anual') and pg_temp.jnull(r -> 'ocupacion_mes')
     from (select public.get_health_capacity('900001') r) x)
  and (select (r ->> 'snss') = 'false' and pg_temp.jnull(r -> 'ocupacion_anual') from (select public.get_health_capacity('124210') r) x));
select pg_temp.assert_that('la fuente REM 20 viaja con la URL EFECTIVA registrada, el hash, la fecha declarada, el período y CC0; client_ready de ocupación = false',
  (select (r -> 'fuentes' -> 'rem20' ->> 'origin_url') = 'https://example.test/r1' and (r -> 'fuentes' -> 'rem20' ->> 'sha256') = encode(sha256('r1'::bytea), 'hex')
          and (r -> 'fuentes' -> 'rem20' ->> 'declared_date') = '2025-10-20' and (r -> 'fuentes' -> 'rem20' ->> 'period_start') = '2025-01-01' and (r -> 'fuentes' -> 'rem20' ->> 'period_end') = '2026-08-31'
          and (r -> 'fuentes' -> 'rem20' ->> 'license_label') like '%CC0%' and (r -> 'client_ready' -> 'ocupacion' ->> 'client_ready') = 'false'
     from (select public.get_health_capacity('112101') r) x));
select pg_temp.assert_that('un código que no existe en establecimientos devuelve snss NULL y nada más; un código mal formado se rechaza (22023)',
  (select pg_temp.jnull(r -> 'snss') from (select public.get_health_capacity('777777') r) x)
  and pg_temp.raises_like($$select public.get_health_capacity('1121')$$, '%código DEIS de 6 dígitos%') and pg_temp.raises_like($$select public.get_health_capacity(null)$$, '%código DEIS%'));

-- Todo o nada de REM 20
select pg_temp.mk('deis_rem20_hospitalizacion', 'r_n', date '2025-01-01', date '2027-02-28', 'month');
select pg_temp.rem_stage((select n from public.source_snapshots where storage_path = 'test/r_n'), date '2025-01-01', date '2027-02-01');
select pg_temp.rem_rep((select n from public.source_snapshots where storage_path = 'test/r_n'));
update public.source_snapshots set validation_report = jsonb_set(validation_report, '{totales,dias_cama_ocupados}', to_jsonb((validation_report -> 'totales' ->> 'dias_cama_ocupados')::bigint + 1)) where storage_path = 'test/r_n';
select pg_temp.assert_that('un total de ocupados del archivo que no cuadra con Σ de la zona de paso detiene la publicación', pg_temp.raises_like($$select pg_temp.rem_pub('r_n')$$, '%cuadre con los totales%'));
select pg_temp.rem_rep((select n from public.source_snapshots where storage_path = 'test/r_n'));
update public.source_snapshots set row_count_raw = row_count_raw + 1 where storage_path = 'test/r_n';
select pg_temp.assert_that('row_count_raw distinto de las filas crudas del reporte detiene la publicación', pg_temp.raises_like($$select pg_temp.rem_pub('r_n')$$, '%row_count_raw%'));
select pg_temp.rem_rep((select n from public.source_snapshots where storage_path = 'test/r_n'));
update public.health_rem20_month_stage set code = '999999' where code = '113150' and period = date '2025-08-01';
select pg_temp.rem_rep((select n from public.source_snapshots where storage_path = 'test/r_n'));
select pg_temp.assert_that('un código sin empalme con la captura vigente de establecimientos detiene la publicación (lista el código)', pg_temp.raises_like($$select pg_temp.rem_pub('r_n')$$, '%999999%'));
update public.health_rem20_month_stage set code = '113150' where code = '999999';
update public.health_rem20_month_stage set area = 100 where code = '113150' and period = date '2025-08-01';
select pg_temp.rem_rep((select n from public.source_snapshots where storage_path = 'test/r_n'));
select pg_temp.assert_that('el área 100 (total de dotación) no es válida en REM 20', pg_temp.raises_like($$select pg_temp.rem_pub('r_n')$$, '%fuera de dominio%'));
update public.health_rem20_month_stage set area = 403 where code = '113150' and area = 100;
update public.health_rem20_month_stage set area = 888 where code = '113150' and period = date '2025-08-01';
select pg_temp.rem_rep((select n from public.source_snapshots where storage_path = 'test/r_n'));
select pg_temp.assert_that('un área desconocida detiene la publicación', pg_temp.raises_like($$select pg_temp.rem_pub('r_n')$$, '%áreas funcionales no registradas%888%'));
update public.health_rem20_month_stage set area = 403 where area = 888;
insert into public.health_rem20_month_stage select * from public.health_rem20_month_stage where code = '113150' and period = date '2025-08-01' limit 1;
select pg_temp.rem_rep((select n from public.source_snapshots where storage_path = 'test/r_n'));
select pg_temp.assert_that('una clave (código, mes, área) repetida detiene la publicación: las duplicadas del archivo deben llegar sumadas', pg_temp.raises_like($$select pg_temp.rem_pub('r_n')$$, '%repetida%'));
delete from public.health_rem20_month_stage where ctid in (select ctid from public.health_rem20_month_stage where code = '113150' and period = date '2025-08-01' limit 1);
select pg_temp.rem_rep((select n from public.source_snapshots where storage_path = 'test/r_n'));
update public.source_snapshots set period_end = date '2027-03-31' where storage_path = 'test/r_n';
select pg_temp.assert_that('el período de los datos debe coincidir con el del snapshot', pg_temp.raises_like($$select pg_temp.rem_pub('r_n')$$, '%period_start / period_end%'));
update public.source_snapshots set period_end = date '2027-02-28' where storage_path = 'test/r_n';
update public.source_snapshots set validation_report = validation_report - 'totales' where storage_path = 'test/r_n';
select pg_temp.assert_that('sin los totales del archivo en el reporte NO se publica (el cuadre es obligatorio)', pg_temp.raises_like($$select pg_temp.rem_pub('r_n')$$, '%falta totales%'));
select pg_temp.assert_that('el snapshot de otra fuente no se publica como REM 20 y un snapshot ya loaded no se publica de nuevo',
  pg_temp.raises_like($$select pg_temp.rem_pub('d1')$$, '%no de REM 20%') and pg_temp.raises_like($$select pg_temp.rem_pub('r1')$$, '%debe ser validated%'));
select pg_temp.assert_that('tras los intentos fallidos sigue vigente la captura anterior, intacta (todo o nada)',
  (select snapshot_id from public._health_capacity_current_snapshot('deis_rem20_hospitalizacion')) = (select id from public.source_snapshots where storage_path = 'test/r1')
  and (select count(*) from public.health_rem20_month m join public.source_snapshots s on s.n = m.snapshot_n where s.storage_path = 'test/r_n') = 0);
delete from public.health_rem20_month_stage;

-- =============================== 3. Períodos y retención ===============================
select pg_temp.mk('deis_rem20_hospitalizacion', 'r_old', date '2024-01-01', date '2024-12-31', 'month');
select pg_temp.rem_stage((select n from public.source_snapshots where storage_path = 'test/r_old'), date '2024-01-01', date '2024-12-01');
select pg_temp.rem_rep((select n from public.source_snapshots where storage_path = 'test/r_old'));
select pg_temp.assert_that('no se publica un período más viejo que uno ya cargado', pg_temp.raises_like($$select pg_temp.rem_pub('r_old')$$, '%período más nuevo%'));
delete from public.health_rem20_month_stage;
-- una captura más nueva que TERMINA EN DICIEMBRE: el último año completo pasa a ser ese año y el último mes es diciembre
select pg_temp.mk('deis_rem20_hospitalizacion', 'r2', date '2025-01-01', date '2026-12-31', 'month');
select pg_temp.rem_stage((select n from public.source_snapshots where storage_path = 'test/r2'), date '2025-01-01', date '2026-12-01');
select pg_temp.rem_rep((select n from public.source_snapshots where storage_path = 'test/r2'));
create temp table _r2 as select pg_temp.rem_pub('r2') as r;
select pg_temp.assert_that('una captura más nueva pasa a ser la vigente; la anterior queda superseded y se CONSERVA (retención 2); si el archivo termina en diciembre el último año completo es ese año',
  (select snapshot_id from public._health_capacity_current_snapshot('deis_rem20_hospitalizacion')) = (select id from public.source_snapshots where storage_path = 'test/r2')
  and (select status from public.source_snapshots where storage_path = 'test/r1') = 'superseded'
  and (select count(*) from public.health_rem20_month m join public.source_snapshots s on s.n = m.snapshot_n where s.storage_path = 'test/r1') = 46
  and (select (r -> 'ocupacion_anual' ->> 'year')::int = 2026 and r -> 'ocupacion_mes' ->> 'period' = '2026-12' from (select public.get_health_capacity('112101') r) x));
select pg_temp.mk('deis_rem20_hospitalizacion', 'r3', date '2025-01-01', date '2027-12-31', 'month');
select pg_temp.rem_stage((select n from public.source_snapshots where storage_path = 'test/r3'), date '2025-01-01', date '2027-12-01');
select pg_temp.rem_rep((select n from public.source_snapshots where storage_path = 'test/r3'));
create temp table _r3 as select pg_temp.rem_pub('r3') as r;
select pg_temp.assert_that('una tercera captura retira el contenido de la más vieja (retención 2): sin filas de r1',
  (select (r ->> 'old_snapshots_cleared')::int from _r3) = 1
  and (select count(*) from public.health_rem20_month m join public.source_snapshots s on s.n = m.snapshot_n where s.storage_path = 'test/r1') = 0
  and (select count(*) from public.health_rem20_month_stage) = 0);
select pg_temp.mk('deis_dotacion_camas', 'd2', date '2024-01-01', date '2025-12-31', 'year');
update public.source_snapshots set sha256 = encode(sha256('d2b'::bytea), 'hex') where storage_path = 'test/d2';
select pg_temp.dot_stage((select n from public.source_snapshots where storage_path = 'test/d2'));
select pg_temp.dot_rep((select n from public.source_snapshots where storage_path = 'test/d2'));
create temp table _d2 as select pg_temp.dot_pub('d2') as r;
select pg_temp.assert_that('dotación: una captura del MISMO período se publica y pasa a ser la vigente (la otra queda superseded); las retenciones de REM 20 y dotación son independientes',
  (select (r ->> 'filas')::int = 12 from _d2)
  and (select status from public.source_snapshots where storage_path = 'test/d1') = 'superseded'
  and (select count(*) from public.health_rem20_month m join public.source_snapshots s on s.n = m.snapshot_n where s.storage_path = 'test/r2') = 54);

-- =============================== 4. Permisos ===============================
select pg_temp.as_role('anon');
select pg_temp.assert_that('anon no lee las tablas ni ejecuta la RPC de capacidad',
  pg_temp.try_sql('select count(*) from public.health_rem20_month') like '42501%' and pg_temp.try_sql('select count(*) from public.health_beds_dotacion') like '42501%'
  and pg_temp.try_sql('select count(*) from public.health_capacity_fields') like '42501%' and pg_temp.try_sql($$select public.get_health_capacity('112101')$$) like '42501%');
select pg_temp.reset_role();
select pg_temp.as_role('authenticated');
select pg_temp.assert_that('authenticated SOLO lee: consulta la RPC y las tablas, pero no publica, no escribe, no borra, no cambia client_ready y no ve la zona de paso',
  pg_temp.try_sql($$select public.get_health_capacity('112101')$$) = 'OK' and pg_temp.try_sql('select count(*) from public.health_rem20_month') = 'OK'
  and pg_temp.try_sql($$select public.publish_health_rem20_snapshot('00000000-0000-0000-0000-000000000000')$$) like '42501%'
  and pg_temp.try_sql($$select public.publish_health_dotacion_snapshot('00000000-0000-0000-0000-000000000000')$$) like '42501%'
  and pg_temp.try_sql($$insert into public.health_beds_dotacion values (1, '112101', 2025, 402, 1)$$) like '42501%'
  and pg_temp.try_sql('delete from public.health_rem20_month') like '42501%'
  and pg_temp.try_sql(E'update public.health_capacity_fields set client_ready = true') like '42501%'
  and pg_temp.try_sql('select count(*) from public.health_rem20_month_stage') like '42501%' and pg_temp.try_sql('select count(*) from public.health_beds_dotacion_stage') like '42501%');
select pg_temp.reset_role();
select pg_temp.assert_that('service_role publica y authenticated no; las funciones de publicación son SECURITY DEFINER con search_path fijo',
  has_function_privilege('service_role', 'public.publish_health_rem20_snapshot(uuid)', 'execute') and has_function_privilege('service_role', 'public.publish_health_dotacion_snapshot(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.publish_health_rem20_snapshot(uuid)', 'execute') and not has_function_privilege('anon', 'public.publish_health_dotacion_snapshot(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.get_health_capacity(text)', 'execute') and has_function_privilege('authenticated', 'public.get_health_capacity(text)', 'execute')
  and (select bool_and(prosecdef and exists (select 1 from unnest(proconfig) c where c like 'search_path=%')) from pg_proc
        where oid in ('public.publish_health_rem20_snapshot(uuid)'::regprocedure, 'public.publish_health_dotacion_snapshot(uuid)'::regprocedure)));
