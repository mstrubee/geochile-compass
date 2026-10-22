-- =============================================================================
-- PROPUESTA (NO APLICADA) — Parte 4, 1/4: permisos de edificación georreferenciados del INE (puntos)
-- =============================================================================
-- Fuente: INE, servicio ArcGIS CRF_PE_v2, capa 1 (PE_NACIONAL). Sondeo real del 2026-10-17:
-- 163.487 registros, años 2010-2025, SIN fecha, SIN número de permiso, SIN dirección (ver
-- docs/proyectos-parte4/HALLAZGOS_SONDEO.md). Cobertura PARCIAL de comunas (117-123 de 346 por año).
--
-- Qué crea:
--   data_sources (1 fila)       ine_pe_nacional (licencia: "por confirmar"; el servicio no declara ninguna)
--   geo_rejected_rows           filas rechazadas de las tres fuentes puntuales/poligonales de la Parte 4
--   ine_pe_glosas               dimensión: los 858 textos de GLOSA_DESTINO (tal cual), 1 vez cada uno
--   ine_pe_points               hechos, PARTICIONADOS POR SNAPSHOT: soltar una partición libera el disco al instante
--   ine_pe_stage                zona de paso (UNLOGGED), se vacía al publicar
--   publish_ine_pe_snapshot()   único camino para publicar: re-valida en la base, calcula la validación geográfica
--   get_ine_permit_points()     puntos o clusters por bbox/zoom con filtros de año, destino y precisión
--   get_ine_pe_coverage(), get_ine_pe_comuna_series(), get_ine_pe_vs_minvu_by_year()
--
-- Semántica que la interfaz NO puede perder:
--   * un registro NO es un permiso: agrupa CANTIDAD_UNIDAD unidades; el número de registros no es
--     comparable entre <=2019 y >=2020 (las unidades sí siguen al total nacional de MINVU);
--   * solo hay AÑO (sin mes ni fecha), sin número de permiso ni dirección;
--   * cobertura parcial de comunas, que además cambia de un año a otro;
--   * PRECISION_ (ALTA/MODERADA/BAJA/nulo): BAJA y nulo se excluyen por defecto de los análisis por punto.
--
-- Requiere las partes 1 y 2 aplicadas. Es SOLO ADITIVA. Reglas: SQL_MIGRATION_GUARDRAILS.md.
-- Rollback: supabase/rollbacks/20261021120000_ine_permit_points_down.sql
-- =============================================================================

select pg_advisory_xact_lock(hashtext('permits_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('ine_permit_points_v1', 'start');

do $$
begin
  if to_regclass('public.data_sources') is null or to_regclass('public.source_snapshots') is null
     or to_regclass('public.comunas') is null or to_regclass('public.pipeline_settings') is null then
    raise exception 'Guardrail: falta la parte 1 (permits_provenance_v1); aplicarla primero';
  end if;
end $$;

create temp table _p4_counts_before on commit drop as
  select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
  union all select 'territorial_layers', count(*) from public.territorial_layers
  union all select 'territorial_features', count(*) from public.territorial_features
  union all select 'comunas', count(*) from public.comunas
  union all select 'source_snapshots', count(*) from public.source_snapshots
  union all select 'data_sources_other', count(*) from public.data_sources where source_key <> 'ine_pe_nacional';

-- -----------------------------------------------------------------------------
-- 0. Umbrales configurables (VALORES INICIALES, nada hardcodeado en las funciones)
-- -----------------------------------------------------------------------------
insert into public.pipeline_settings (key, value, description) values
  ('retention.keep_point_snapshots', 1,    'Snapshots de las fuentes puntuales/poligonales de la Parte 4 que conservan sus filas. Los originales (GeoJSON normalizado) van a Storage con su hash. Con 2, el INE PE ocupa el doble.'),
  ('ine_points.near_border_m',       500,  'Metros al borde de la comuna declarada para marcar un punto INE como near_border en vez de outside_declared. VALOR INICIAL.'),
  ('ine_points.max_outside_ratio',   0.05, 'Fracción máxima de puntos INE fuera de su comuna (entre los que tienen polígono) para poder publicar; sobre esto casi seguro hay un error de CUT. VALOR INICIAL (en una muestra real fue 0 de 695).')
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- 1. Fuente
-- -----------------------------------------------------------------------------
insert into public.data_sources
  (source_key, dataset, name, publisher, landing_url, data_url, license_label, attribution, access_mode,
   cadence_days, publication_lag_days, grace_days, check_every_days,
   verification_status, verified_at, verification_note, scope_note)
values
  ('ine_pe_nacional', 'ine_permit_points',
   'INE — Permisos de edificación georreferenciados (PE_NACIONAL)',
   'Instituto Nacional de Estadísticas (INE)',
   'https://www.ine.gob.cl/estadisticas/economia/edificacion-y-construccion/permisos-de-edificacion',
   'https://services5.arcgis.com/hUyD8u3TeZLKPe4T/arcgis/rest/services/CRF_PE_v2/FeatureServer/1',
   null,
   'Fuente: Instituto Nacional de Estadísticas (INE), permisos de edificación georreferenciados',
   'automatic', 365, 210, 30, 30,
   'comprobado', date '2026-10-17',
   'Estructura y conteos COMPROBADOS por sondeo real el 2026-10-17: 163.487 registros, años 2010-2025, campos OBJECTID, COD_REGION, GLOSA_REGION, COD_COMUNA, GLOSA_COMUNA, AÑO, CANTIDAD_UNIDAD, NUM_PISOS, GLOSA_DESTINO, USO_DESTINO, SUPERFICIE, PRECISION_; editingInfo.lastEditDate 2026-07-30. LICENCIA NO DECLARADA en el servicio ni en su ítem de ArcGIS Online (licenseInfo nulo): por confirmar en los términos de uso de datos abiertos del INE. Cadencia/rezago son HIPÓTESIS (la capa se editó el 2026-07-30 con datos hasta 2025).',
   'Solo año (sin mes ni fecha), sin número de permiso ni dirección. Cobertura PARCIAL de comunas (117-123 de 346 por año). Un registro agrupa CANTIDAD_UNIDAD unidades: su número no es comparable entre 2019 y 2020. Incluye no vivienda.')
on conflict (source_key) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Filas rechazadas (compartida por las tres fuentes de la Parte 4)
-- -----------------------------------------------------------------------------
create table if not exists public.geo_rejected_rows (
  id          bigint generated always as identity primary key,
  snapshot_id uuid not null references public.source_snapshots(id) on delete cascade,
  row_ref     jsonb not null default '{}'::jsonb,           -- {layer, objectid}
  reason_code text not null check (reason_code in (
    'cut_invalid', 'cut_unknown', 'year_invalid', 'value_invalid', 'uso_unmapped', 'geometry_missing',
    'geometry_invalid_unrepairable', 'coordinates_out_of_range', 'duplicate_key', 'other')),
  detail      text,
  raw         jsonb not null,
  created_at  timestamptz not null default now()
);
create index if not exists geo_rejected_rows_snapshot_idx on public.geo_rejected_rows (snapshot_id, reason_code);

-- -----------------------------------------------------------------------------
-- 3. Hechos: ine_pe_points (una partición por snapshot)
-- -----------------------------------------------------------------------------
-- Tipos (revisados por espacio): enteros chicos para todo lo categórico; CUT char(5); la geometría es un punto.
--   uso:        1 = HABITACIONAL, 2 = MIXTO, 3 = NO HABITACIONAL
--   geo_precision:  3 = ALTA, 2 = MODERADA, 1 = BAJA, 0 = sin dato (nulo en la fuente)   (orden: más alto = más preciso)
--   geo_status: 0 = dentro de su comuna, 1 = near_border, 2 = outside_declared, 3 = la comuna no tiene polígono
-- SIN JSONB por fila. Sin PK (no hay clave natural: el INE quitó el número de permiso); src_oid es el OBJECTID de la capa
-- en ESA captura y no es estable entre capturas.
create table if not exists public.ine_pe_glosas (
  id    smallint generated always as identity primary key,
  glosa text not null unique check (btrim(glosa) <> '')            -- GLOSA_DESTINO tal cual (con sus mayúsculas y combinaciones)
);

create table if not exists public.ine_pe_points (
  snapshot_n  integer  not null,
  src_oid     integer  not null,
  area_m2     double precision,                                      -- SUPERFICIE tal cual (la fuente no declara unidad: se asume m2, NO COMPROBADO)
  year        smallint not null check (year between 2000 and 2100),
  units       smallint not null check (units >= 0),                  -- CANTIDAD_UNIDAD
  floors      smallint check (floors is null or floors >= 0),        -- NUM_PISOS
  uso         smallint not null check (uso between 1 and 3),
  geo_precision   smallint not null check (geo_precision between 0 and 3),
  geo_status  smallint not null check (geo_status between 0 and 3),
  glosa_id    smallint not null references public.ine_pe_glosas(id),
  comuna_cut  char(5)  not null references public.comunas(cut),
  geom        geometry(Point, 4326) not null
) partition by list (snapshot_n);

-- Los índices se declaran en el padre y se crean en cada partición.
create index if not exists ine_pe_points_geom_gix  on public.ine_pe_points using gist (geom);
create index if not exists ine_pe_points_cut_year  on public.ine_pe_points (comuna_cut, year);
create index if not exists ine_pe_points_year_prec on public.ine_pe_points (year, geo_precision);

comment on table public.ine_pe_points is
  'INE PE_NACIONAL. Un registro NO es un permiso: agrupa `units` unidades. Solo año; sin número de permiso ni dirección. Cobertura parcial de comunas. Particionada por snapshot_n.';
comment on column public.ine_pe_points.units is 'CANTIDAD_UNIDAD. Sumar esto, no contar registros: los registros no son comparables entre <=2019 y >=2020.';
comment on column public.ine_pe_points.geo_precision is '3 ALTA, 2 MODERADA, 1 BAJA, 0 sin dato. BAJA y 0 se excluyen por defecto de los análisis por punto.';
comment on column public.ine_pe_points.geo_status is '0 dentro de la comuna declarada, 1 near_border (<= ine_points.near_border_m), 2 outside_declared, 3 comuna sin polígono. Nunca se mueve el punto original.';

create unlogged table if not exists public.ine_pe_stage (
  snapshot_n integer  not null,
  src_oid    integer  not null,
  comuna_cut char(5)  not null,
  year       smallint not null,
  units      smallint not null,
  floors     smallint,
  uso        smallint not null,
  geo_precision  smallint not null,
  glosa      text     not null,
  area_m2    double precision,
  lon        double precision not null,
  lat        double precision not null
);

-- Partición de un snapshot: sin acceso directo (las particiones saltarían el RLS del padre).
create or replace function public._ine_pe_make_partition(p_n integer)
returns text language plpgsql security definer set search_path = public as $$
declare v text := format('ine_pe_points_p%s', p_n);
begin
  if to_regclass('public.' || v) is not null then
    raise exception 'la partición % ya existe', v;
  end if;
  execute format('create table public.%I partition of public.ine_pe_points for values in (%s)', v, p_n);
  execute format('revoke all on public.%I from public, anon, authenticated', v);
  return v;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Publicación (única vía) — re-valida TODO en la base
-- -----------------------------------------------------------------------------
create or replace function public.publish_ine_pe_snapshot(p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_snap public.source_snapshots%rowtype;
  v_key text; v_n int;
  v_staged bigint; v_max_reject numeric; v_near numeric; v_max_out numeric; v_keep int;
  v_bad text; v_inserted bigint; v_with_poly bigint; v_outside bigint;
  v_old record; v_dropped int := 0; v_report jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('ine_pe_publish'));
  perform set_config('statement_timeout', '10min', true);

  select * into v_snap from public.source_snapshots where id = p_snapshot_id for update;
  if not found then raise exception 'snapshot % no existe', p_snapshot_id; end if;
  select source_key into v_key from public.data_sources where id = v_snap.source_id;
  if v_key <> 'ine_pe_nacional' then raise exception 'el snapshot es de %, no de ine_pe_nacional', v_key; end if;
  if v_snap.status <> 'validated' then raise exception 'el snapshot está en estado % (debe ser validated)', v_snap.status; end if;
  v_n := v_snap.n;
  if exists (select 1 from public.source_snapshots where source_id = v_snap.source_id and status = 'loaded' and n > v_n) then
    raise exception 'ya hay un snapshot más nuevo publicado; no se publica uno más viejo';
  end if;

  -- conteos: lo descargado + lo rechazado = lo que el servidor declaró, y el servidor no cambió durante la descarga
  select count(*) into v_staged from public.ine_pe_stage where snapshot_n = v_n;
  if (v_snap.validation_report ->> 'server_count_before') is distinct from (v_snap.validation_report ->> 'server_count_after')
     or (v_snap.validation_report ->> 'server_count_before')::bigint is distinct from v_snap.row_count_raw then
    raise exception 'el conteo del servidor cambió durante la descarga o no coincide con row_count_raw (antes %, después %, declarado %)',
      v_snap.validation_report ->> 'server_count_before', v_snap.validation_report ->> 'server_count_after', v_snap.row_count_raw;
  end if;
  if v_staged + v_snap.rejected_count <> v_snap.row_count_raw then
    raise exception 'cuadre de conteos: staged % + rechazadas % <> servidor %', v_staged, v_snap.rejected_count, v_snap.row_count_raw;
  end if;
  v_max_reject := public.pipeline_setting('publish.max_reject_ratio');
  if v_snap.row_count_raw = 0 or v_snap.rejected_count::numeric / v_snap.row_count_raw > v_max_reject then
    raise exception 'rechazos % de % superan el máximo configurado (%)', v_snap.rejected_count, v_snap.row_count_raw, v_max_reject;
  end if;

  -- dominios y período
  select string_agg(distinct c, ', ') into v_bad from (
    select s.comuna_cut::text as c from public.ine_pe_stage s left join public.comunas m on m.cut = s.comuna_cut
     where s.snapshot_n = v_n and m.cut is null limit 20) x;
  if v_bad is not null then raise exception 'CUT que no existen en comunas: %', v_bad; end if;
  if exists (select 1 from public.ine_pe_stage where snapshot_n = v_n and (uso not between 1 and 3 or geo_precision not between 0 and 3 or units < 0
             or lon not between -180 and 180 or lat not between -90 and 90)) then
    raise exception 'valores fuera de dominio en la zona de paso (uso, precisión, unidades o coordenadas)';
  end if;
  if exists (select 1 from public.ine_pe_stage where snapshot_n = v_n
             and year not between extract(year from v_snap.period_start) and extract(year from v_snap.period_end)) then
    raise exception 'hay años fuera del período declarado del snapshot (% a %)', v_snap.period_start, v_snap.period_end;
  end if;

  -- carga: dimensión de glosas + partición + hechos con validación geográfica
  insert into public.ine_pe_glosas (glosa)
    select distinct glosa from public.ine_pe_stage where snapshot_n = v_n on conflict (glosa) do nothing;
  perform public._ine_pe_make_partition(v_n);
  v_near := public.pipeline_setting('ine_points.near_border_m');

  insert into public.ine_pe_points (snapshot_n, src_oid, area_m2, year, units, floors, uso, geo_precision, geo_status, glosa_id, comuna_cut, geom)
  select s.snapshot_n, s.src_oid, s.area_m2, s.year, s.units, s.floors, s.uso, s.geo_precision,
         case when c.geom is null then 3
              when ST_Covers(c.geom, s.pt) then 0
              when ST_DWithin(c.geom::geography, s.pt::geography, v_near) then 1
              else 2 end::smallint,
         g.id, s.comuna_cut, s.pt
    from (select st.*, ST_SetSRID(ST_MakePoint(st.lon, st.lat), 4326) as pt
            from public.ine_pe_stage st where st.snapshot_n = v_n) s
    join public.comunas c on c.cut = s.comuna_cut
    join public.ine_pe_glosas g on g.glosa = s.glosa
   order by s.comuna_cut;                           -- agrupar por comuna acelera ST_Covers (geometría preparada)
  get diagnostics v_inserted = row_count;
  if v_inserted <> v_staged then raise exception 'se insertaron % filas y había % en la zona de paso', v_inserted, v_staged; end if;

  select count(*) filter (where geo_status <> 3), count(*) filter (where geo_status = 2) into v_with_poly, v_outside
    from public.ine_pe_points where snapshot_n = v_n;
  v_max_out := public.pipeline_setting('ine_points.max_outside_ratio');
  if v_with_poly > 0 and v_outside::numeric / v_with_poly > v_max_out then
    raise exception 'puntos fuera de su comuna: % de % (%) superan el máximo configurado (%)',
      v_outside, v_with_poly, round(v_outside::numeric / v_with_poly, 4), v_max_out;
  end if;

  update public.source_snapshots set status = 'superseded'
   where source_id = v_snap.source_id and status = 'loaded' and id <> p_snapshot_id;
  update public.source_snapshots set status = 'loaded', loaded_at = now() where id = p_snapshot_id;

  -- retención: se conservan las K particiones más nuevas; soltar una partición libera el disco al instante
  v_keep := greatest(public.pipeline_setting('retention.keep_point_snapshots')::int, 1);
  for v_old in
    select s.n from public.source_snapshots s
     where s.source_id = v_snap.source_id and s.status in ('loaded', 'superseded')
     order by s.n desc offset v_keep
  loop
    if to_regclass(format('public.ine_pe_points_p%s', v_old.n)) is not null then
      execute format('drop table public.ine_pe_points_p%s', v_old.n);
      v_dropped := v_dropped + 1;
    end if;
  end loop;

  truncate public.ine_pe_stage;

  v_report := jsonb_build_object(
    'inserted', v_inserted, 'rejected', v_snap.rejected_count, 'partitions_dropped', v_dropped,
    'geo_status', (select jsonb_object_agg(geo_status::text, n) from (
        select geo_status, count(*) n from public.ine_pe_points where snapshot_n = v_n group by 1) a),
    'geo_precision', (select jsonb_object_agg(geo_precision::text, n) from (
        select geo_precision, count(*) n from public.ine_pe_points where snapshot_n = v_n group by 1) a),
    'year_min', (select min(year) from public.ine_pe_points where snapshot_n = v_n),
    'year_max', (select max(year) from public.ine_pe_points where snapshot_n = v_n),
    'comunas', (select count(distinct comuna_cut) from public.ine_pe_points where snapshot_n = v_n),
    'outside_ratio', case when v_with_poly > 0 then round(v_outside::numeric / v_with_poly, 6) end);
  update public.source_snapshots set validation_report = validation_report || jsonb_build_object('publish', v_report)
   where id = p_snapshot_id;
  return v_report;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Lectura
-- -----------------------------------------------------------------------------
create or replace function public._ine_pe_current_snapshot()
returns integer language sql stable set search_path = public as $$
  select max(s.n) from public.source_snapshots s join public.data_sources d on d.id = s.source_id
   where d.source_key = 'ine_pe_nacional' and s.status = 'loaded'
$$;

-- Puntos (zoom alto y pocos) o clusters (zoom bajo o muchos). `units` es lo que se suma; n_points cuenta registros.
create or replace function public.get_ine_permit_points(
  p_west double precision, p_south double precision, p_east double precision, p_north double precision,
  p_zoom integer default 10,
  p_years smallint[] default null, p_uso smallint[] default null,
  p_min_precision smallint default 2, p_limit integer default 3000)
returns table (
  kind text, lon double precision, lat double precision, n_points integer, units bigint, area_m2 double precision,
  src_oid integer, comuna_cut char(5), year smallint, uso smallint, glosa text, floors smallint,
  geo_precision smallint, geo_status smallint)
language plpgsql stable security invoker set search_path = public as $$
declare v_n integer; v_env geometry; v_cnt bigint; v_cell double precision;
begin
  v_n := public._ine_pe_current_snapshot();
  if v_n is null then return; end if;
  v_env := ST_MakeEnvelope(p_west, p_south, p_east, p_north, 4326);
  select count(*) into v_cnt from public.ine_pe_points p
   where p.snapshot_n = v_n and p.geom && v_env and p.geo_precision >= p_min_precision
     and (p_years is null or p.year = any (p_years)) and (p_uso is null or p.uso = any (p_uso));
  if p_zoom >= 13 and v_cnt <= p_limit then
    return query
      select 'point'::text, ST_X(p.geom), ST_Y(p.geom), 1, p.units::bigint, p.area_m2, p.src_oid, p.comuna_cut, p.year, p.uso,
             g.glosa, p.floors, p.geo_precision, p.geo_status
        from public.ine_pe_points p join public.ine_pe_glosas g on g.id = p.glosa_id
       where p.snapshot_n = v_n and p.geom && v_env and p.geo_precision >= p_min_precision
         and (p_years is null or p.year = any (p_years)) and (p_uso is null or p.uso = any (p_uso));
  else
    v_cell := 360.0 / (power(2, greatest(p_zoom, 0)) * 8);        -- 8 celdas por teselas de Web Mercator
    return query
      select 'cluster'::text, avg(ST_X(p.geom)), avg(ST_Y(p.geom)), count(*)::integer, sum(p.units)::bigint, sum(p.area_m2),
             null::integer, null::char(5), null::smallint, null::smallint, null::text, null::smallint, null::smallint, null::smallint
        from public.ine_pe_points p
       where p.snapshot_n = v_n and p.geom && v_env and p.geo_precision >= p_min_precision
         and (p_years is null or p.year = any (p_years)) and (p_uso is null or p.uso = any (p_uso))
       group by ST_SnapToGrid(p.geom, v_cell);
  end if;
end $$;

-- Cobertura REAL por año (se muestra en la leyenda; nada hardcodeado).
create or replace function public.get_ine_pe_coverage()
returns table (year smallint, points bigint, units bigint, comunas integer, comunas_total integer,
               precision_high bigint, precision_moderate bigint, precision_low bigint, precision_none bigint,
               outside_declared bigint)
language sql stable security invoker set search_path = public as $$
  select p.year, count(*), sum(p.units)::bigint, count(distinct p.comuna_cut)::integer,
         (select count(*)::integer from public.comunas),
         count(*) filter (where p.geo_precision = 3), count(*) filter (where p.geo_precision = 2),
         count(*) filter (where p.geo_precision = 1), count(*) filter (where p.geo_precision = 0),
         count(*) filter (where p.geo_status = 2)
    from public.ine_pe_points p
   where p.snapshot_n = public._ine_pe_current_snapshot()
   group by p.year order by p.year
$$;

-- Serie de una comuna (para la ficha): unidades por año y uso, con su precisión.
create or replace function public.get_ine_pe_comuna_series(p_cut char(5))
returns table (year smallint, uso smallint, points bigint, units bigint, area_m2 double precision,
               precision_high bigint, precision_other bigint)
language sql stable security invoker set search_path = public as $$
  select p.year, p.uso, count(*), sum(p.units)::bigint, sum(p.area_m2),
         count(*) filter (where p.geo_precision = 3), count(*) filter (where p.geo_precision < 3)
    from public.ine_pe_points p
   where p.snapshot_n = public._ine_pe_current_snapshot() and p.comuna_cut = p_cut
   group by p.year, p.uso order by p.year, p.uso
$$;

-- DIAGNÓSTICO (no es un error): unidades de vivienda del INE (HABITACIONAL + MIXTO) frente a las de MINVU,
-- SOLO en las comunas que el INE cubre ese año. Diferencias esperables: el INE georreferencia solo parte de las
-- comunas, MIXTO mezcla vivienda con otros usos, el INE y MINVU no coinciden en 2025 (según la nota del archivo
-- de MINVU) y el método de agrupación cambió entre 2019 y 2020.
create or replace function public.get_ine_pe_vs_minvu_by_year()
returns table (year smallint, ine_housing_units bigint, ine_housing_only_units bigint, minvu_units_same_comunas bigint,
               ratio numeric, minvu_national_units bigint, ine_covered_comunas integer)
language sql stable security invoker set search_path = public as $$
  with ine as (
    select p.year, p.comuna_cut, sum(p.units) filter (where p.uso in (1, 2)) as hm, sum(p.units) filter (where p.uso = 1) as h
      from public.ine_pe_points p where p.snapshot_n = public._ine_pe_current_snapshot() group by 1, 2),
  minvu as (
    select extract(year from b.period)::smallint as year, b.comuna_cut, b.value
      from public.building_permit_statistics b
      join public.permit_series s on s.id = b.series_id
      join public.data_sources d on d.id = s.source_id
     where d.source_key = 'minvu_cedoc_permisos_anual' and s.metric = 'units' and s.destination_class = 'housing_total'
       and s.granularity = 'year' and b.to_snapshot is null)
  select i.year, sum(i.hm)::bigint, sum(i.h)::bigint,
         sum(m.value)::bigint,
         round(sum(i.hm)::numeric / nullif(sum(m.value), 0), 3),
         (select sum(m2.value)::bigint from minvu m2 where m2.year = i.year),
         count(*)::integer
    from ine i left join minvu m on m.comuna_cut = i.comuna_cut and m.year = i.year
   group by i.year order by i.year
$$;

-- -----------------------------------------------------------------------------
-- 6. RLS y permisos
-- -----------------------------------------------------------------------------
alter table public.geo_rejected_rows enable row level security;
alter table public.ine_pe_glosas     enable row level security;
alter table public.ine_pe_points     enable row level security;
alter table public.ine_pe_stage      enable row level security;

drop policy if exists geo_rejected_rows_read on public.geo_rejected_rows;
create policy geo_rejected_rows_read on public.geo_rejected_rows for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
drop policy if exists ine_pe_glosas_read on public.ine_pe_glosas;
create policy ine_pe_glosas_read on public.ine_pe_glosas for select to authenticated using (true);
drop policy if exists ine_pe_points_read on public.ine_pe_points;
create policy ine_pe_points_read on public.ine_pe_points for select to authenticated using (true);
-- ine_pe_stage no tiene política: solo el ETL (service_role) la ve.

revoke all on public.geo_rejected_rows, public.ine_pe_glosas, public.ine_pe_points, public.ine_pe_stage from anon;
revoke insert, update, delete, truncate on public.ine_pe_glosas, public.ine_pe_points, public.geo_rejected_rows from authenticated;
revoke all on public.ine_pe_stage from authenticated;
-- Data API: desde el 2026-10-30 Supabase ya no concede permisos automáticos sobre tablas nuevas de public; se declaran aquí (anon sigue sin acceso).
grant select on public.geo_rejected_rows, public.ine_pe_glosas, public.ine_pe_points to authenticated;
grant all on public.geo_rejected_rows, public.ine_pe_glosas, public.ine_pe_points, public.ine_pe_stage to service_role;

revoke all on function public.publish_ine_pe_snapshot(uuid), public._ine_pe_make_partition(integer) from public, anon, authenticated;
grant execute on function public.publish_ine_pe_snapshot(uuid) to service_role;
grant execute on function public._ine_pe_make_partition(integer) to service_role;

revoke all on function public._ine_pe_current_snapshot(),
  public.get_ine_permit_points(double precision, double precision, double precision, double precision, integer, smallint[], smallint[], smallint, integer),
  public.get_ine_pe_coverage(), public.get_ine_pe_comuna_series(char), public.get_ine_pe_vs_minvu_by_year() from public, anon;
grant execute on function public._ine_pe_current_snapshot(),
  public.get_ine_permit_points(double precision, double precision, double precision, double precision, integer, smallint[], smallint[], smallint, integer),
  public.get_ine_pe_coverage(), public.get_ine_pe_comuna_series(char), public.get_ine_pe_vs_minvu_by_year() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. Auditoría final: nada previo cambió (salvo +1 fuente sembrada)
-- -----------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(b.t || ': ' || b.n || ' -> ' || a.n, ', ') into v_bad
    from _p4_counts_before b
    join (
      select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
      union all select 'territorial_layers', count(*) from public.territorial_layers
      union all select 'territorial_features', count(*) from public.territorial_features
      union all select 'comunas', count(*) from public.comunas
      union all select 'source_snapshots', count(*) from public.source_snapshots
      union all select 'data_sources_other', count(*) from public.data_sources where source_key <> 'ine_pe_nacional'
    ) a using (t)
   where a.n <> b.n;
  if v_bad is not null then
    raise exception 'Guardrail: cambiaron conteos de tablas existentes (%)', v_bad;
  end if;
end $$;

insert into public._migration_log (sprint, notes) values ('ine_permit_points_v1', 'done');
