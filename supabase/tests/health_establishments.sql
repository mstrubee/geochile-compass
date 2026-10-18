-- =============================================================================
-- Pruebas de 20261102000000_health_establishments.sql (y de 20261102000100_health_layer_nodes.sql). NO es una migración.
-- Se corre DESPUÉS de las migraciones, en la MISMA transacción y terminando en error (nada queda aplicado):
--   <partes 1–4 de permisos/proyectos: 2026102*.sql>   (ya aplicadas en la base de pruebas geochile_sql_test)
--   <20261102000000_health_establishments.sql>         (dos veces: idempotencia)
--   <20261102000100_health_layer_nodes.sql>            (dos veces: idempotencia)
--   <este archivo>
--   do $$ begin raise exception 'DRYRUN_OK %', (select count(*) from _tr); end $$;
-- Requiere `comunas` sembrada con las 346 comunas REALES (polígonos del repo) y los roles de la plataforma (anon/authenticated/service_role).
--
-- DATOS: TODAS las filas de establecimientos de esta prueba son SINTÉTICAS (códigos 9xxxxx, nombres «FIXTURE …»); los polígonos de comunas son los reales.
-- Los puntos se construyen respecto de esos polígonos (vértice más oriental de 05201 Isla de Pascua + desplazamientos en metros). Existen solo en esta transacción.
-- =============================================================================
create temp table _tr (seq serial primary key, name text not null);
grant all on _tr to public;
grant all on sequence _tr_seq_seq to public;

create or replace function pg_temp.assert_that(p_name text, p_cond boolean, p_detail text default null)
returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FAIL [%]: %', p_name, coalesce(p_detail, 'condición falsa'); end if;
  insert into _tr (name) values (p_name);
end $$;

create or replace function pg_temp.as_role(p_role text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', p_role)::text, true);
  execute format('set local role %I', p_role);
end $$;

create or replace function pg_temp.reset_role()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.try_sql(p_sql text)
returns text language plpgsql as $$
begin execute p_sql; return 'OK'; exception when others then return sqlstate || ':' || sqlerrm; end $$;

create or replace function pg_temp.raises_like(p_sql text, p_like text)
returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return sqlerrm like p_like; end $$;

-- snapshot 'validated' de la fuente; devuelve su n
create or replace function pg_temp.mk(p_tag text, p_raw int, p_rej int default 0) returns integer language plpgsql as $$
declare v integer;
begin
  insert into public.source_snapshots (source_id, captured_by, capture_method, origin_url, storage_path, sha256,
                                       period_start, period_end, granularity, row_count_raw, rejected_count, status)
  select d.id, 'test', 'manual_download', 'https://example.test/' || p_tag, 'test/' || p_tag, encode(sha256(p_tag::bytea), 'hex'),
         current_date, current_date, 'snapshot', p_raw, p_rej, 'validated'
    from public.data_sources d where d.source_key = 'deis_establecimientos'
  returning n into v;
  return v;
end $$;

-- fila SINTÉTICA de la zona de paso
create or replace function pg_temp.st(p_n int, p_code text, p_cut text, p_tipo text, p_comp text, p_ta text, p_dep text, p_estado text,
                                      p_lon double precision, p_lat double precision, p_present boolean default true)
returns void language plpgsql as $$
begin
  insert into public.health_establishments_stage
    (snapshot_n, code, name, region_cut, comuna_cut, comuna_glosa, tipo_glosa, dependencia_raw, dependencia_norm, complejidad, tipo_atencion, estado,
     coords_present, lon_raw, lat_raw)
  values (p_n, p_code, 'FIXTURE ' || p_code, left(p_cut, 2), p_cut, 'FIXTURE', p_tipo, p_dep, p_dep, p_comp, p_ta, p_estado, p_present, p_lon, p_lat);
end $$;

create or replace function pg_temp.pub(p_tag text) returns jsonb language sql as $$
  select public.publish_health_establishments((select id from public.source_snapshots where storage_path = 'test/' || p_tag))
$$;

-- La base de pruebas puede traer cargas previas de las pruebas de pytest: se parte de cero DENTRO de esta transacción (se revierte al terminar).
delete from public.source_checks where source_id in (select id from public.data_sources where source_key = 'deis_establecimientos');
delete from public.health_establishments;
delete from public.health_establishments_stage;
delete from public.source_snapshots where source_id in (select id from public.data_sources where source_key = 'deis_establecimientos');

-- =============================== 0. Estructura ===============================
select pg_temp.assert_that('346 comunas en la referencia', (select count(*) from public.comunas) = 346);
select pg_temp.assert_that('la fuente deis_establecimientos está sembrada, CC0, verificada, con fecha',
  (select license_label like 'CC0%' and verification_status = 'comprobado' and verified_at is not null and scope_note like '%NO mide capacidad%'
     from public.data_sources where source_key = 'deis_establecimientos'));
select pg_temp.assert_that('umbrales geográficos configurables en pipeline_settings',
  (select count(*) from public.pipeline_settings where key in ('health.near_border_m', 'health.coast_buffer_m')) = 2
  and public.pipeline_setting('health.near_border_m') = 500 and public.pipeline_setting('health.coast_buffer_m') = 2000);
select pg_temp.assert_that('la tabla de clasificación tiene los 29 tipos del registro real', (select count(*) from public.health_tipo_clasificacion) = 29);
select pg_temp.assert_that('D1: solo Hospital es alta_hospital; Hospital, Clínica y Centro de Especialidades son alta_ampliada',
  (select array_agg(tipo_norm order by tipo_norm) from public.health_tipo_clasificacion where alta_hospital) = array['hospital']
  and (select array_agg(tipo_norm order by tipo_norm) from public.health_tipo_clasificacion where alta_ampliada)
      = array['centro de especialidades', 'clínica', 'hospital']);
select pg_temp.assert_that('Clínica es mixta (no se imputa) y Otro/Atención Remota/Crisis sanitaria quedan sin clasificar',
  (select clase from public.health_tipo_clasificacion where tipo_norm = 'clínica') = 'mixto'
  and (select count(*) from public.health_tipo_clasificacion where clase = 'sin_clasificar') = 3);
select pg_temp.assert_that('comuna_cut es char(5) con FK a comunas',
  (select format_type(atttypid, atttypmod) = 'character(5)' from pg_attribute where attrelid = 'public.health_establishments'::regclass and attname = 'comuna_cut')
  and exists (select 1 from pg_constraint where conrelid = 'public.health_establishments'::regclass and contype = 'f' and confrelid = 'public.comunas'::regclass));
select pg_temp.assert_that('ninguna columna JSONB por fila',
  (select count(*) from pg_attribute where attrelid = 'public.health_establishments'::regclass and attnum > 0 and not attisdropped
      and format_type(atttypid, atttypmod) = 'jsonb') = 0);

-- ====================== 1. Puntos de prueba sobre polígonos reales ======================
-- Vértice más oriental de Isla de Pascua (05201) y desplazamientos hacia el este (mar abierto): 300 m, 1.200 m, 5.000 m.
create temp table _pt as
  with v as (select (ST_DumpPoints(geom)).geom as g from public.comunas where cut = '05201'),
       e as (select g from v order by ST_X(g) desc limit 1)
  select 'pascua_dentro'::text as k, ST_X(ST_PointOnSurface(c.geom)) as lon, ST_Y(ST_PointOnSurface(c.geom)) as lat from public.comunas c where c.cut = '05201'
  union all select 'pascua_300m',  ST_X(ST_Project(e.g::geography, 300, radians(90))::geometry),  ST_Y(ST_Project(e.g::geography, 300, radians(90))::geometry)  from e
  union all select 'pascua_1200m', ST_X(ST_Project(e.g::geography, 1200, radians(90))::geometry), ST_Y(ST_Project(e.g::geography, 1200, radians(90))::geometry) from e
  union all select 'pascua_5000m', ST_X(ST_Project(e.g::geography, 5000, radians(90))::geometry), ST_Y(ST_Project(e.g::geography, 5000, radians(90))::geometry) from e
  union all select 'stgo_dentro', ST_X(ST_PointOnSurface(c.geom)), ST_Y(ST_PointOnSurface(c.geom)) from public.comunas c where c.cut = '13101'
  union all select 'indep_dentro', ST_X(ST_PointOnSurface(c.geom)), ST_Y(ST_PointOnSurface(c.geom)) from public.comunas c where c.cut = '13108'
  union all select 'jf_dentro',   ST_X(ST_PointOnSurface(c.geom)), ST_Y(ST_PointOnSurface(c.geom)) from public.comunas c where c.cut = '05104'
  union all select 'cdh_dentro',  ST_X(ST_PointOnSurface(c.geom)), ST_Y(ST_PointOnSurface(c.geom)) from public.comunas c where c.cut = '12201';
select pg_temp.assert_that('los 8 puntos de prueba se construyeron', (select count(*) from _pt) = 8);
select pg_temp.assert_that('casos de borde: el punto de 300 m y el de 1.200 m caen fuera de Isla de Pascua, y a esas distancias',
  (select not ST_Covers(c.geom, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326)) and ST_Distance(c.geom::geography, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326)::geography) between 250 and 300.5
     from _pt p, public.comunas c where p.k = 'pascua_300m' and c.cut = '05201')
  and (select ST_Distance(c.geom::geography, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326)::geography) between 1150 and 1200.5
     from _pt p, public.comunas c where p.k = 'pascua_1200m' and c.cut = '05201'));
select pg_temp.assert_that('Independencia (13108) declarada como Santiago queda entre 500 y 2.000 m de Santiago (precondición del caso «en otra comuna»)',
  (select ST_Distance(c.geom::geography, ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326)::geography) between 500 and 2000
     from _pt p, public.comunas c where p.k = 'indep_dentro' and c.cut = '13101'));
select pg_temp.assert_that('12202 Antártica no tiene polígono (caso especial)', (select geom is null from public.comunas where cut = '12202'));

-- ========================= 2. Publicación feliz: 20 filas sintéticas =========================
select pg_temp.mk('h1', 20);
select pg_temp.st(n, c, cut, tipo, comp, ta, dep, est, lon, lat, pres) from (
  select (select n from public.source_snapshots where storage_path = 'test/h1') as n, x.* from (values
    ('900001', '13101', 'Hospital',                'Alta Complejidad',  'hospitalaria', 'servicio_salud', 'vigente', (select lon from _pt where k='stgo_dentro'), (select lat from _pt where k='stgo_dentro'), true),
    ('900002', '13101', 'Clínica',                 'Alta Complejidad',  'hospitalaria', 'privado',        'vigente', (select lon from _pt where k='stgo_dentro'), (select lat from _pt where k='stgo_dentro'), true),
    ('900003', '13101', 'Centro de Especialidades','Alta Complejidad',  'ambulatoria',  'servicio_salud', 'vigente', (select lon from _pt where k='stgo_dentro'), (select lat from _pt where k='stgo_dentro'), true),
    ('900004', '13101', 'Otro',                    'Alta Complejidad',  'sin_dato',     'servicio_salud', 'vigente', (select lon from _pt where k='stgo_dentro'), (select lat from _pt where k='stgo_dentro'), true),
    ('900005', '13101', 'Hospital',                'Baja Complejidad',  'hospitalaria', 'municipal',      'vigente', (select lon from _pt where k='stgo_dentro'), (select lat from _pt where k='stgo_dentro'), true),
    ('900006', '13101', 'Hospital',                'Alta Complejidad',  'hospitalaria', 'privado',        'cerrado', (select lon from _pt where k='stgo_dentro'), (select lat from _pt where k='stgo_dentro'), true),
    ('900007', '13101', 'Laboratorio Clínico',     'No Aplica',         'no_aplica',    'privado',        'vigente', (select lon from _pt where k='stgo_dentro'), (select lat from _pt where k='stgo_dentro'), true),
    ('900008', '13101', 'Clínica',                 'Mediana Complejidad','sin_dato',    'privado',        'vigente', (select lon from _pt where k='stgo_dentro'), (select lat from _pt where k='stgo_dentro'), true),
    ('900009', '13101', 'Centro de Salud Privado', 'Baja Complejidad',  'sin_dato',     'privado',        'vigente', (select lon from _pt where k='stgo_dentro'), (select lat from _pt where k='stgo_dentro'), true),
    ('900010', '13101', 'Centro de Salud Privado', 'Baja Complejidad',  'hospitalaria', 'privado',        'vigente', (select lon from _pt where k='stgo_dentro'), (select lat from _pt where k='stgo_dentro'), true),
    ('900011', '05201', 'Posta de Salud Rural (PSR)', 'Baja Complejidad','ambulatoria', 'servicio_salud', 'vigente', (select lon from _pt where k='pascua_dentro'), (select lat from _pt where k='pascua_dentro'), true),
    ('900012', '05201', 'Posta de Salud Rural (PSR)', 'Baja Complejidad','ambulatoria', 'servicio_salud', 'vigente', (select lon from _pt where k='pascua_300m'),  (select lat from _pt where k='pascua_300m'),  true),
    ('900013', '05201', 'Posta de Salud Rural (PSR)', 'Baja Complejidad','ambulatoria', 'servicio_salud', 'vigente', (select lon from _pt where k='pascua_1200m'), (select lat from _pt where k='pascua_1200m'), true),
    ('900014', '05201', 'Posta de Salud Rural (PSR)', 'Baja Complejidad','ambulatoria', 'servicio_salud', 'vigente', (select lon from _pt where k='pascua_5000m'), (select lat from _pt where k='pascua_5000m'), true),
    ('900015', '05104', 'Posta de Salud Rural (PSR)', 'Baja Complejidad','ambulatoria', 'servicio_salud', 'vigente', (select lon from _pt where k='jf_dentro'), (select lat from _pt where k='jf_dentro'), true),
    ('900016', '12202', 'Posta de Salud Rural (PSR)', 'Baja Complejidad','ambulatoria', 'ejercito',       'vigente', -58.9, -62.2, true),
    ('900017', '13101', 'Posta de Salud Rural (PSR)', 'Baja Complejidad','ambulatoria', 'municipal',      'vigente', (select lon from _pt where k='indep_dentro'), (select lat from _pt where k='indep_dentro'), true),
    ('900018', '01101', 'Posta de Salud Rural (PSR)', 'Baja Complejidad','ambulatoria', 'municipal',      'vigente', (select lon from _pt where k='stgo_dentro'), (select lat from _pt where k='stgo_dentro'), true),
    ('900019', '13101', 'Posta de Salud Rural (PSR)', 'Baja Complejidad','ambulatoria', 'municipal',      'vigente', 0, 0, true),
    ('900020', '13101', 'Posta de Salud Rural (PSR)', 'Baja Complejidad','ambulatoria', 'municipal',      'vigente', null, null, false)
  ) as x(c, cut, tipo, comp, ta, dep, est, lon, lat, pres)
) q;
-- el «complejidad» de la zona de paso viene normalizado por el ETL: la fixture usa el texto crudo, se normaliza aquí
update public.health_establishments_stage set
  complejidad = case complejidad when 'Alta Complejidad' then 'alta' when 'Mediana Complejidad' then 'mediana' when 'Baja Complejidad' then 'baja'
                                 when 'No Aplica' then 'no_aplica' else complejidad end;
select pg_temp.assert_that('20 filas en la zona de paso', (select count(*) from public.health_establishments_stage) = 20);
select pg_temp.assert_that('publica con el snapshot validated (fixture h1)', (pg_temp.pub('h1') ->> 'inserted')::int = 20);
select pg_temp.assert_that('el snapshot quedó loaded y la zona de paso vacía',
  (select status from public.source_snapshots where storage_path = 'test/h1') = 'loaded'
  and (select count(*) from public.health_establishments_stage) = 0);

-- geo_status: dentro 0, borde 1, costero 2, fuera_declarada 3, sin_coordenadas 4, comuna_sin_poligono 5, coordenada_invalida 6
create temp table _e as select * from public.health_establishments e where snapshot_n = (select n from public.source_snapshots where storage_path = 'test/h1');
select pg_temp.assert_that('dentro de su comuna → 0 (Santiago, Pascua, Juan Fernández)',
  (select geo_status from _e where code = '900001') = 0 and (select geo_status from _e where code = '900011') = 0 and (select geo_status from _e where code = '900015') = 0);
select pg_temp.assert_that('a ~300 m de Isla de Pascua → borde (1) con su distancia; el punto NO se movió',
  (select geo_status = 1 and geo_distance_m between 250 and 300.5 from _e where code = '900012')
  and (select abs(ST_X(geom) - (select lon from _pt where k = 'pascua_300m')) < 1e-9 from _e where code = '900012'));
select pg_temp.assert_that('a ~1.200 m en el mar → costero (2): fuera de toda comuna y dentro del buffer',
  (select geo_status = 2 and geo_distance_m between 1150 and 1200.5 from _e where code = '900013'));
select pg_temp.assert_that('a ~5.000 m (más allá del buffer) → fuera_declarada (3)', (select geo_status = 3 from _e where code = '900014'));
select pg_temp.assert_that('punto de Independencia declarado Santiago (500–2.000 m, dentro de OTRA comuna) → fuera_declarada (3), no costero',
  (select geo_status = 3 from _e where code = '900017'));
select pg_temp.assert_that('punto de Santiago declarado Iquique → fuera_declarada (3) con distancia de cientos de km',
  (select geo_status = 3 and geo_distance_m > 1000000 from _e where code = '900018'));
select pg_temp.assert_that('Antártica (12202, sin polígono) → comuna_sin_poligono (5), conserva su punto',
  (select geo_status = 5 and geom is not null from _e where code = '900016'));
select pg_temp.assert_that('(0,0) → coordenada_invalida (6), sin geometría pero con el valor crudo',
  (select geo_status = 6 and geom is null and lon_raw = 0 and lat_raw = 0 from _e where code = '900019'));
select pg_temp.assert_that('sin latitud/longitud → sin_coordenadas (4), sin geometría',
  (select geo_status = 4 and geom is null from _e where code = '900020'));
select pg_temp.assert_that('el reporte de publicación cuenta cada estado', (
  select (r -> 'geo_status' ->> '0')::int = 12 and (r -> 'geo_status' ->> '1')::int = 1 and (r -> 'geo_status' ->> '2')::int = 1
     and (r -> 'geo_status' ->> '3')::int = 3 and (r -> 'geo_status' ->> '4')::int = 1 and (r -> 'geo_status' ->> '5')::int = 1
     and (r -> 'geo_status' ->> '6')::int = 1 and r ->> 'coast_buffer_m' = '2000'
  from (select (validation_report -> 'publish') r from public.source_snapshots where storage_path = 'test/h1') x));

-- clases y banderas de alta complejidad
select pg_temp.assert_that('D1 hospitales: Hospital + alta = alta_hospital y alta_ampliada; en 900006 (cerrado) también (se cuenta en «todos», no en «vigentes»)',
  (select alta_hospital and alta_ampliada from _e where code = '900001') and (select alta_hospital and alta_ampliada from _e where code = '900006'));
select pg_temp.assert_that('D1 ampliada: Clínica y Centro de Especialidades con alta = solo alta_ampliada',
  (select not alta_hospital and alta_ampliada from _e where code = '900002') and (select not alta_hospital and alta_ampliada from _e where code = '900003'));
select pg_temp.assert_that('alta complejidad de tipo Otro cae fuera de ambas definiciones y se informa aparte',
  (select not alta_hospital and not alta_ampliada and complejidad = 'alta' from _e where code = '900004')
  and (select (validation_report -> 'publish' ->> 'alta_fuera_de_ambas')::int from public.source_snapshots where storage_path = 'test/h1') = 1);
select pg_temp.assert_that('Hospital de baja complejidad NO es alta en ninguna definición', (select not alta_hospital and not alta_ampliada from _e where code = '900005'));
select pg_temp.assert_that('conteos de alta: hospitales todos 2 / vigentes 1; ampliada todos 4 / vigentes 3', (
  select (r ->> 'alta_hospital_todos')::int = 2 and (r ->> 'alta_hospital_vigentes')::int = 1
     and (r ->> 'alta_ampliada_todos')::int = 4 and (r ->> 'alta_ampliada_vigentes')::int = 3
  from (select validation_report -> 'publish' r from public.source_snapshots where storage_path = 'test/h1') x));
select pg_temp.assert_that('clase oficial manda: Centro de Salud Privado con TipoAtencion hospitalaria queda hospitalario/oficial (aunque la tabla diga ambulatorio)',
  (select clase_servicio = 'hospitalario' and clase_fuente = 'oficial' from _e where code = '900010'));
select pg_temp.assert_that('sin dato oficial, la tabla completa: Centro de Salud Privado → ambulatorio/tabla',
  (select clase_servicio = 'ambulatorio' and clase_fuente = 'tabla' from _e where code = '900009'));
select pg_temp.assert_that('No Aplica oficial + Laboratorio → ambulatorio/tabla (queda contado como imputado)',
  (select clase_servicio = 'ambulatorio' and clase_fuente = 'tabla' from _e where code = '900007'));
select pg_temp.assert_that('Clínica sin dato oficial NO se imputa (mixta): sin_clasificar',
  (select clase_servicio = 'sin_clasificar' and clase_fuente = 'sin_clasificar' from _e where code = '900008'));
select pg_temp.assert_that('Otro sin dato oficial NO se imputa: sin_clasificar', (select clase_servicio = 'sin_clasificar' and clase_fuente = 'sin_clasificar' from _e where code = '900004'));

-- ============================ 3. Lectura (RPC) ============================
select pg_temp.assert_that('get_health_comuna_counts devuelve las 346 comunas (con ceros verdaderos)',
  (select count(*) from public.get_health_comuna_counts()) = 346
  and (select establishments from public.get_health_comuna_counts() where cut = '01107') = 0);
select pg_temp.assert_that('por defecto oculta los cerrados: Santiago tiene 12 vigentes de 13 filas',
  (select establishments from public.get_health_comuna_counts() where cut = '13101') = 12
  and (select establishments from public.get_health_comuna_counts(true) where cut = '13101') = 13);
select pg_temp.assert_that('el conteo por comuna usa el CUT DECLARADO, no la posición: el punto de Independencia declarado Santiago cuenta en Santiago',
  (select establishments from public.get_health_comuna_counts() where cut = '13108') = 0);
select pg_temp.assert_that('filtro alta complejidad (hospital) por comuna: Santiago 1 vigente; ampliada 3',
  (select establishments from public.get_health_comuna_counts(false, null, null, null, 'hospital') where cut = '13101') = 1
  and (select establishments from public.get_health_comuna_counts(false, null, null, null, 'ampliada') where cut = '13101') = 3);
select pg_temp.assert_that('filtro privado + ambulatorio cuenta la clase imputada y la declara (imputed)',
  (select establishments = 2 and imputed = 2 from public.get_health_comuna_counts(false, array['privado'], null, array['ambulatorio']) where cut = '13101'),
  (select establishments || '/' || imputed from public.get_health_comuna_counts(false, array['privado'], null, array['ambulatorio']) where cut = '13101'));
select pg_temp.assert_that('ranking: 1 = la comuna con más establecimientos; empates comparten puesto; el total cuadra',
  (select rank from public.get_health_comuna_counts() where cut = '13101') = 1
  and (select count(distinct rank) from public.get_health_comuna_counts() where establishments = 0) = 1
  and (select sum(establishments) from public.get_health_comuna_counts()) = 19);
select pg_temp.assert_that('not_drawable y marked_geo se informan por comuna (Santiago: 2 sin dibujar; Pascua: 3 marcados)',
  (select not_drawable = 2 from public.get_health_comuna_counts() where cut = '13101')
  and (select marked_geo = 3 from public.get_health_comuna_counts() where cut = '05201'));
select pg_temp.assert_that('p_alta inválido se rechaza', pg_temp.raises_like($$select * from public.get_health_comuna_counts(false, null, null, null, 'x')$$, '%p_alta%')
  and pg_temp.raises_like($$select * from public.get_health_establishments(-180, -90, 180, 90, false, null, null, null, 'x')$$, '%p_alta%'));
select pg_temp.assert_that('get_health_establishments: respeta el bbox, oculta cerrados y no dibuja los sin geometría',
  (select count(*) from public.get_health_establishments(-110, -28, -105, -26)) = 4
  and (select count(*) from public.get_health_establishments(-180, -90, 180, 90)) = 17
  and (select count(*) from public.get_health_establishments(-180, -90, 180, 90, true)) = 18
  and (select max(total_matching) from public.get_health_establishments(-180, -90, 180, 90, false, null, null, null, null, 3)) = 17
  and (select count(*) from public.get_health_establishments(-180, -90, 180, 90, false, null, null, null, null, 3)) = 3);
select pg_temp.assert_that('get_health_summary: total, estados y los conteos de alta de la captura vigente',
  (select n from public.get_health_summary() where dimension = 'total') = 20
  and (select n from public.get_health_summary() where dimension = 'estado' and value = 'cerrado') = 1
  and (select n from public.get_health_summary() where dimension = 'alta_hospital_vigentes') = 1
  and (select n from public.get_health_summary() where dimension = 'alta_ampliada_vigentes') = 3
  and (select n from public.get_health_summary() where dimension = 'alta_fuera_de_ambas_vigentes') = 1);
select pg_temp.assert_that('get_health_tipo_clasificacion muestra la tabla con su evidencia', (select count(*) from public.get_health_tipo_clasificacion() where evidence <> '') = 29);

-- ============================ 4. Todo o nada: la base RE-VALIDA ============================
select pg_temp.mk('h_cut', 2);
select pg_temp.st((select n from public.source_snapshots where storage_path = 'test/h_cut'), '910001', '99999', 'Hospital', 'alta', 'hospitalaria', 'privado', 'vigente', null, null, false);
select pg_temp.st((select n from public.source_snapshots where storage_path = 'test/h_cut'), '910002', '13101', 'Hospital', 'alta', 'hospitalaria', 'privado', 'vigente', null, null, false);
select pg_temp.assert_that('un CUT que no existe detiene la publicación y no deja nada', pg_temp.raises_like($$select pg_temp.pub('h_cut')$$, '%CUT que no existen%')
  and (select count(*) from public.health_establishments where code in ('910001', '910002')) = 0);
delete from public.health_establishments_stage;

select pg_temp.mk('h_dup', 2);
select pg_temp.st((select n from public.source_snapshots where storage_path = 'test/h_dup'), '910003', '13101', 'Hospital', 'alta', 'hospitalaria', 'privado', 'vigente', null, null, false);
select pg_temp.st((select n from public.source_snapshots where storage_path = 'test/h_dup'), '910003', '13101', 'Hospital', 'alta', 'hospitalaria', 'privado', 'vigente', null, null, false);
select pg_temp.assert_that('un código duplicado detiene la publicación', pg_temp.raises_like($$select pg_temp.pub('h_dup')$$, '%duplicado%'));
delete from public.health_establishments_stage;

select pg_temp.mk('h_tipo', 1);
select pg_temp.st((select n from public.source_snapshots where storage_path = 'test/h_tipo'), '910004', '13101', 'Tipo Nuevo Que No Existe', 'alta', 'hospitalaria', 'privado', 'vigente', null, null, false);
select pg_temp.assert_that('un tipo no clasificado detiene la publicación (nada se adivina)', pg_temp.raises_like($$select pg_temp.pub('h_tipo')$$, '%sin clasificar%Tipo Nuevo%'));
delete from public.health_establishments_stage;

select pg_temp.mk('h_cuadre', 5);
select pg_temp.st((select n from public.source_snapshots where storage_path = 'test/h_cuadre'), '910005', '13101', 'Hospital', 'alta', 'hospitalaria', 'privado', 'vigente', null, null, false);
select pg_temp.assert_that('el cuadre de filas (cargadas + rechazadas = archivo) es obligatorio', pg_temp.raises_like($$select pg_temp.pub('h_cuadre')$$, '%cuadre de conteos%'));
delete from public.health_establishments_stage;

select pg_temp.mk('h_rej', 100, 5);
select pg_temp.st((select n from public.source_snapshots where storage_path = 'test/h_rej'), (910100 + g)::text, '13101', 'Hospital', 'alta', 'hospitalaria', 'privado', 'vigente', null, null, false)
  from generate_series(1, 95) g;
select pg_temp.assert_that('rechazos (5 de 100) sobre publish.max_reject_ratio (0,5 %) detienen la publicación aunque las filas cuadren',
  pg_temp.raises_like($$select pg_temp.pub('h_rej')$$, '%superan el máximo%'));
delete from public.health_establishments_stage;

select pg_temp.mk('h_dom', 1);
select pg_temp.st((select n from public.source_snapshots where storage_path = 'test/h_dom'), '910006', '13101', 'Hospital', 'alta', 'hospitalaria', 'marciana', 'vigente', null, null, false);
select pg_temp.assert_that('un dominio inválido (dependencia) no entra: la zona de paso lo acepta, la publicación lo rechaza por CHECK',
  pg_temp.raises_like($$select pg_temp.pub('h_dom')$$, '%health_establishments_dependencia_norm_check%'));
delete from public.health_establishments_stage;

select pg_temp.assert_that('un snapshot que no está validated no se publica', pg_temp.raises_like($$select pg_temp.pub('h1')$$, '%debe ser validated%'));
insert into public.source_snapshots (source_id, captured_by, capture_method, origin_url, storage_path, sha256, period_start, period_end, granularity, row_count_raw, status)
  select d.id, 'test', 'api', 'https://example.test/otra', 'test/otra', encode(sha256('otra'::bytea), 'hex'), current_date, current_date, 'snapshot', 0, 'validated'
    from public.data_sources d where d.source_key = 'seia_proyectos_eia';
select pg_temp.assert_that('el snapshot de otra fuente no se publica como establecimientos',
  pg_temp.raises_like($$select public.publish_health_establishments((select id from public.source_snapshots where storage_path = 'test/otra'))$$, '%no de deis_establecimientos%'));
select pg_temp.mk('h_old', 1);       -- n MENOR que el del snapshot h2 (se crea después)

-- ============================ 5. Retención y reemplazo ============================
update public.pipeline_settings set value = 1 where key = 'retention.keep_point_snapshots';
select pg_temp.mk('h2', 1);
select pg_temp.st((select n from public.source_snapshots where storage_path = 'test/h2'), '900001', '13101', 'Hospital', 'alta', 'hospitalaria', 'servicio_salud', 'vigente', null, null, false);
update public.health_establishments_stage set complejidad = 'alta';
create temp table _pub2 as select pg_temp.pub('h2') as r;      -- aparte: una función volátil no ve sus efectos desde subconsultas de la misma sentencia
select pg_temp.assert_that('segundo snapshot: publica y el primero queda superseded con sus filas retiradas (retención 1)',
  (select (r ->> 'old_snapshots_cleared')::int from _pub2) = 1
  and (select status from public.source_snapshots where storage_path = 'test/h1') = 'superseded'
  and (select count(*) from public.health_establishments e join public.source_snapshots s on s.n = e.snapshot_n where s.storage_path = 'test/h1') = 0
  and (select count(*) from public.health_establishments) = 1);
select pg_temp.assert_that('la lectura usa SOLO la última captura publicada', (select sum(establishments) from public.get_health_comuna_counts()) = 1);
select pg_temp.assert_that('no se publica un snapshot más viejo que uno ya cargado',
  pg_temp.raises_like($$select pg_temp.pub('h_old')$$, '%más nuevo%'));

-- ============================ 6. Permisos ============================
select pg_temp.as_role('anon');
select pg_temp.assert_that('anon no lee las tablas ni ejecuta las RPC',
  pg_temp.try_sql('select count(*) from public.health_establishments') like '42501%'
  and pg_temp.try_sql('select * from public.get_health_comuna_counts()') like '42501%'
  and pg_temp.try_sql('select * from public.get_health_summary()') like '42501%');
select pg_temp.reset_role();
select pg_temp.as_role('authenticated');
select pg_temp.assert_that('authenticated lee las RPC pero NO publica, NO escribe y NO ve la zona de paso',
  pg_temp.try_sql('select count(*) from public.get_health_comuna_counts()') = 'OK'
  and pg_temp.try_sql($$select public.publish_health_establishments('00000000-0000-0000-0000-000000000000')$$) like '42501%'
  and pg_temp.try_sql($$delete from public.health_establishments$$) like '42501%'
  and pg_temp.try_sql('select count(*) from public.health_establishments_stage') like '42501%');
select pg_temp.reset_role();
select pg_temp.assert_that('la clasificación solo la edita un admin: authenticated sin rol no puede (RLS)',
  (select count(*) from pg_policies where tablename = 'health_tipo_clasificacion' and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE') and qual like '%has_role%') >= 1
  and not has_table_privilege('anon', 'public.health_tipo_clasificacion', 'select'));
select pg_temp.assert_that('service_role puede publicar (grant)', has_function_privilege('service_role', 'public.publish_health_establishments(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.publish_health_establishments(uuid)', 'execute'));

-- ============================ 7. Capas del árbol y client_ready (migración 20261102000100) ============================
select pg_temp.assert_that('thematic_layers tiene client_ready y client_ready_note',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'thematic_layers' and column_name in ('client_ready', 'client_ready_note')) = 2);
select pg_temp.assert_that('las dos capas de salud existen con renderers PROPIOS (no choropleth_comuna) y nacen client_ready = false con nota',
  (select count(*) from public.thematic_layers where renderer in ('points_health', 'choropleth_health')) = 2
  and (select count(*) from public.thematic_layers where renderer in ('points_health', 'choropleth_health') and client_ready is false and client_ready_note like 'Pendiente%') = 2
  and (select count(*) from public.thematic_layers where renderer = 'choropleth_comuna' and dataset = 'health_establishments') = 0);
select pg_temp.assert_that('las capas que ya existían NO cambian de comportamiento: client_ready sigue en NULL',
  (select count(*) from public.thematic_layers where renderer not in ('points_health', 'choropleth_health') and client_ready is not null) = 0);
select pg_temp.assert_that('las dos hojas cuelgan de la carpeta raíz «Salud» (slug salud)',
  (select count(*) from public.layer_nodes n where n.kind = 'layer' and n.id in (select layer_id from public.thematic_layers where dataset = 'health_establishments')
      and n.parent_id = (select id from public.layer_nodes where kind = 'folder' and parent_id is null and style ->> 'slug' = 'salud')) = 2);
select pg_temp.assert_that('el CHECK de renderer admite los seis y rechaza uno desconocido',
  (select count(*) from pg_constraint where conrelid = 'public.thematic_layers'::regclass and conname = 'thematic_layers_renderer_check'
      and pg_get_constraintdef(oid) like '%points_health%' and pg_get_constraintdef(oid) like '%polygons_crf%' and pg_get_constraintdef(oid) like '%choropleth_comuna%') = 1
  and pg_temp.try_sql($$update public.thematic_layers set renderer = 'otro' where renderer = 'points_health'$$) like '23514%');
select pg_temp.assert_that('territorial_features no cambió (las capas de salud no tienen filas ahí)',
  (select count(*) from public.territorial_features f join public.thematic_layers t on t.layer_id = f.layer_id where t.dataset = 'health_establishments') = 0);
