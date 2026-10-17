-- =============================================================================
-- PROPUESTA (NO APLICADA) — Parte 4, 2/4: certificados de recepción final (CRF) del INE (polígonos)
-- =============================================================================
-- Fuente: INE, servicio ArcGIS CRF_PE_v2, capa 2 (CRF_NACIONAL). Sondeo real del 2026-10-17: 18.272 polígonos,
-- AÑO_EMISION 2011-2025, campos REGION, NOM_REGION, CUT, NOM_COMUNA, N_VIVIENDA, AÑO_EMISION.
-- HALLAZGOS que condicionan el diseño (docs/proyectos-parte4/HALLAZGOS_SONDEO.md):
--   * CUT llega como texto SIN el cero inicial en las regiones 1-9 ('1401'): el ETL lo normaliza a char(5);
--   * son huellas pequeñas (5-58 vértices, mediana 8): NO se simplifican; se guarda siempre la geometría completa.
--
-- SEMÁNTICA: un CRF es una obra TERMINADA y recepcionada, NO un permiso. Sus viviendas (N_VIVIENDA) nunca se
-- suman ni se mezclan con las unidades de los permisos (INE PE ni MINVU). Capas y totales van separados.
--
-- Qué crea: ine_crf_nacional (fuente), ine_crf_polygons (particionada por snapshot), ine_crf_stage,
--   ine_crf_geom_repairs (cada reparación de geometría: original, áreas, diferencia), publish_ine_crf_snapshot(),
--   get_ine_crf_polygons() (zoom alto), get_ine_crf_by_comuna() (zoom bajo), get_ine_crf_coverage().
-- Geometrías: si ST_IsValid falla se repara con ST_MakeValid + ST_CollectionExtract(…,3); la ORIGINAL queda en
-- geom_original y la reparación en ine_crf_geom_repairs; si el área cambia más del umbral queda needs_review.
--
-- Requiere la migración 20261021120000_ine_permit_points (geo_rejected_rows y settings). SOLO ADITIVA.
-- Rollback: supabase/rollbacks/20261021120100_ine_crf_polygons_down.sql
-- =============================================================================

select pg_advisory_xact_lock(hashtext('permits_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('ine_crf_polygons_v1', 'start');

do $$
begin
  if to_regclass('public.geo_rejected_rows') is null or to_regclass('public.ine_pe_points') is null then
    raise exception 'Guardrail: falta 20261021120000_ine_permit_points; aplicarla primero';
  end if;
end $$;

create temp table _p4_counts_before on commit drop as
  select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
  union all select 'territorial_layers', count(*) from public.territorial_layers
  union all select 'territorial_features', count(*) from public.territorial_features
  union all select 'comunas', count(*) from public.comunas
  union all select 'source_snapshots', count(*) from public.source_snapshots
  union all select 'data_sources_other', count(*) from public.data_sources where source_key <> 'ine_crf_nacional';

insert into public.pipeline_settings (key, value, description) values
  ('crf.geom_repair_max_area_diff_pct', 1,    'Diferencia máxima de área (%) entre un polígono CRF reparado y el original; sobre esto queda needs_review. VALOR INICIAL.'),
  ('crf.max_invalid_ratio',             0.02, 'Fracción máxima de polígonos CRF inválidos para poder publicar (sobre esto hay un problema de la fuente, no de unos pocos casos). VALOR INICIAL.')
on conflict (key) do nothing;

insert into public.data_sources
  (source_key, dataset, name, publisher, landing_url, data_url, license_label, attribution, access_mode,
   cadence_days, publication_lag_days, grace_days, check_every_days,
   verification_status, verified_at, verification_note, scope_note)
values
  ('ine_crf_nacional', 'ine_crf',
   'INE — Certificados de recepción final (CRF_NACIONAL)',
   'Instituto Nacional de Estadísticas (INE)',
   'https://www.ine.gob.cl/estadisticas/economia/edificacion-y-construccion/permisos-de-edificacion',
   'https://services5.arcgis.com/hUyD8u3TeZLKPe4T/arcgis/rest/services/CRF_PE_v2/FeatureServer/2',
   null,
   'Fuente: Instituto Nacional de Estadísticas (INE), certificados de recepción final',
   'automatic', 365, 210, 30, 30,
   'comprobado', date '2026-10-17',
   'Estructura y conteos COMPROBADOS por sondeo real el 2026-10-17: 18.272 polígonos (OBJECTID 1..18272), AÑO_EMISION 2011-2025, 309 CUT distintos (CUT sin cero inicial en regiones 1-9), 5-58 vértices por polígono. LICENCIA NO DECLARADA en el servicio ni en su ítem de ArcGIS Online: por confirmar. Cadencia/rezago son HIPÓTESIS.',
   'Obra TERMINADA y recepcionada, no un permiso: no se suma ni se mezcla con los permisos. Un polígono es una huella, N_VIVIENDA las viviendas del certificado. Cobertura parcial de comunas (127-182 por año).')
on conflict (source_key) do nothing;

-- -----------------------------------------------------------------------------
-- Hechos
-- -----------------------------------------------------------------------------
--   geom_status: 0 = válida tal cual, 1 = reparada (original en geom_original), 2 = reparada con diferencia de área sobre el umbral (needs_review)
create table if not exists public.ine_crf_polygons (
  snapshot_n    integer  not null,
  src_oid       integer  not null,
  year          smallint not null check (year between 2000 and 2100),       -- AÑO_EMISION
  dwellings     integer  not null check (dwellings >= 0),                   -- N_VIVIENDA
  geom_status   smallint not null check (geom_status between 0 and 2),
  comuna_cut    char(5)  not null references public.comunas(cut),
  geom          geometry(MultiPolygon, 4326) not null,
  geom_original geometry(Geometry, 4326),                                    -- solo si hubo que repararla
  constraint ine_crf_polygons_geom_valid check (ST_IsValid(geom)),
  constraint ine_crf_polygons_original_iff_repaired check ((geom_status = 0) = (geom_original is null))
) partition by list (snapshot_n);

create index if not exists ine_crf_polygons_geom_gix on public.ine_crf_polygons using gist (geom);
create index if not exists ine_crf_polygons_year_cut on public.ine_crf_polygons (year, comuna_cut);

comment on table public.ine_crf_polygons is
  'INE CRF_NACIONAL: certificados de recepción final (obra TERMINADA, no permiso). Nunca se suma con permisos. Particionada por snapshot_n.';
comment on column public.ine_crf_polygons.dwellings is 'N_VIVIENDA: viviendas del certificado. No es unidades de permiso.';

create table if not exists public.ine_crf_geom_repairs (
  id               bigint generated always as identity primary key,
  snapshot_n       integer not null,
  src_oid          integer not null,
  invalid_reason   text    not null,
  method           text    not null,
  area_original_m2 double precision,
  area_repaired_m2 double precision,
  area_diff_pct    numeric,
  needs_review     boolean not null,
  repaired_at      timestamptz not null default now()
);
create index if not exists ine_crf_geom_repairs_snapshot_idx on public.ine_crf_geom_repairs (snapshot_n);

create unlogged table if not exists public.ine_crf_stage (
  snapshot_n integer  not null,
  src_oid    integer  not null,
  comuna_cut char(5)  not null,
  year       smallint not null,
  dwellings  integer  not null,
  geojson    text     not null                  -- geometría tal como llegó (outSR=4326)
);

create or replace function public._ine_crf_make_partition(p_n integer)
returns text language plpgsql security definer set search_path = public as $$
declare v text := format('ine_crf_polygons_p%s', p_n);
begin
  if to_regclass('public.' || v) is not null then raise exception 'la partición % ya existe', v; end if;
  execute format('create table public.%I partition of public.ine_crf_polygons for values in (%s)', v, p_n);
  execute format('revoke all on public.%I from public, anon, authenticated', v);
  return v;
end $$;

-- Área en m2 o NULL si PostGIS no puede calcularla (polígonos con anillos que se cruzan, etc.)
create or replace function public._safe_area_m2(g geometry)
returns double precision language plpgsql immutable set search_path = public as $$
begin
  return ST_Area(g::geography);
exception when others then
  return null;
end $$;

-- Repara un polígono. Devuelve la geometría válida (MultiPolygon), la clase y la diferencia de área.
create or replace function public._repair_polygon(p_in geometry, p_max_diff_pct numeric,
  out o_geom geometry, out o_status smallint, out o_diff_pct numeric, out o_reason text,
  out o_area_orig double precision, out o_area_fixed double precision)
language plpgsql immutable set search_path = public as $$
begin
  if ST_IsValid(p_in) then
    o_geom := ST_Multi(p_in); o_status := 0; return;
  end if;
  o_reason := ST_IsValidReason(p_in);
  o_geom := ST_Multi(ST_CollectionExtract(ST_MakeValid(p_in), 3));
  if o_geom is null or ST_IsEmpty(o_geom) or not ST_IsValid(o_geom) then
    o_geom := null; o_status := null; return;                           -- irreparable: el llamador lo rechaza
  end if;
  o_area_orig := public._safe_area_m2(p_in);
  o_area_fixed := public._safe_area_m2(o_geom);
  if o_area_orig is null or o_area_orig = 0 then
    o_diff_pct := null; o_status := 2;                                  -- área original incalculable: revisión manual
  else
    o_diff_pct := round((abs(o_area_fixed - o_area_orig) / o_area_orig * 100)::numeric, 4);
    o_status := case when o_diff_pct > p_max_diff_pct then 2 else 1 end;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Publicación
-- -----------------------------------------------------------------------------
create or replace function public.publish_ine_crf_snapshot(p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_snap public.source_snapshots%rowtype;
  v_key text; v_n int; v_staged bigint; v_bad text; v_max_reject numeric; v_max_diff numeric; v_max_inv numeric;
  v_inserted bigint; v_repaired bigint; v_unrepairable bigint; v_keep int; v_old record; v_dropped int := 0; v_report jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('ine_crf_publish'));
  perform set_config('statement_timeout', '10min', true);

  select * into v_snap from public.source_snapshots where id = p_snapshot_id for update;
  if not found then raise exception 'snapshot % no existe', p_snapshot_id; end if;
  select source_key into v_key from public.data_sources where id = v_snap.source_id;
  if v_key <> 'ine_crf_nacional' then raise exception 'el snapshot es de %, no de ine_crf_nacional', v_key; end if;
  if v_snap.status <> 'validated' then raise exception 'el snapshot está en estado % (debe ser validated)', v_snap.status; end if;
  v_n := v_snap.n;
  if exists (select 1 from public.source_snapshots where source_id = v_snap.source_id and status = 'loaded' and n > v_n) then
    raise exception 'ya hay un snapshot más nuevo publicado; no se publica uno más viejo';
  end if;

  select count(*) into v_staged from public.ine_crf_stage where snapshot_n = v_n;
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

  select string_agg(distinct c, ', ') into v_bad from (
    select s.comuna_cut::text as c from public.ine_crf_stage s left join public.comunas m on m.cut = s.comuna_cut
     where s.snapshot_n = v_n and m.cut is null limit 20) x;
  if v_bad is not null then raise exception 'CUT que no existen en comunas: %', v_bad; end if;
  if exists (select 1 from public.ine_crf_stage where snapshot_n = v_n and (dwellings < 0
             or year not between extract(year from v_snap.period_start) and extract(year from v_snap.period_end))) then
    raise exception 'viviendas negativas o años fuera del período declarado (% a %)', v_snap.period_start, v_snap.period_end;
  end if;

  v_max_diff := public.pipeline_setting('crf.geom_repair_max_area_diff_pct');
  v_max_inv  := public.pipeline_setting('crf.max_invalid_ratio');
  perform public._ine_crf_make_partition(v_n);

  -- reparación una sola vez por fila (la función es inmutable pero costosa)
  create temp table _crf_fix on commit drop as
    select s.src_oid, s.comuna_cut, s.year, s.dwellings,
           ST_SetSRID(ST_GeomFromGeoJSON(s.geojson), 4326) as g0
      from public.ine_crf_stage s where s.snapshot_n = v_n;
  create temp table _crf_res on commit drop as
    select f.src_oid, f.comuna_cut, f.year, f.dwellings, f.g0, r.*
      from _crf_fix f, lateral public._repair_polygon(f.g0, v_max_diff) r;

  select count(*) into v_unrepairable from _crf_res where o_geom is null;
  if v_unrepairable > 0 then
    raise exception '% polígonos no se pudieron reparar (el ETL debe rechazarlos antes de publicar)', v_unrepairable;
  end if;
  if exists (select 1 from _crf_res where GeometryType(g0) not in ('POLYGON', 'MULTIPOLYGON')) then
    raise exception 'hay geometrías que no son polígonos';
  end if;
  select count(*) into v_repaired from _crf_res where o_status > 0;
  if v_repaired::numeric / greatest(v_staged, 1) > v_max_inv then
    raise exception 'polígonos inválidos %, de %: superan el máximo configurado (%)', v_repaired, v_staged, v_max_inv;
  end if;

  insert into public.ine_crf_geom_repairs (snapshot_n, src_oid, invalid_reason, method, area_original_m2, area_repaired_m2, area_diff_pct, needs_review)
    select v_n, src_oid, o_reason, 'ST_MakeValid+ST_CollectionExtract(3)', o_area_orig, o_area_fixed, o_diff_pct, o_status = 2
      from _crf_res where o_status > 0;

  insert into public.ine_crf_polygons (snapshot_n, src_oid, year, dwellings, geom_status, comuna_cut, geom, geom_original)
    select v_n, src_oid, year, dwellings, o_status, comuna_cut, o_geom, case when o_status > 0 then g0 end
      from _crf_res order by comuna_cut;
  get diagnostics v_inserted = row_count;
  if v_inserted <> v_staged then raise exception 'se insertaron % filas y había % en la zona de paso', v_inserted, v_staged; end if;

  update public.source_snapshots set status = 'superseded'
   where source_id = v_snap.source_id and status = 'loaded' and id <> p_snapshot_id;
  update public.source_snapshots set status = 'loaded', loaded_at = now() where id = p_snapshot_id;

  v_keep := greatest(public.pipeline_setting('retention.keep_point_snapshots')::int, 1);
  for v_old in
    select s.n from public.source_snapshots s
     where s.source_id = v_snap.source_id and s.status in ('loaded', 'superseded') order by s.n desc offset v_keep
  loop
    if to_regclass(format('public.ine_crf_polygons_p%s', v_old.n)) is not null then
      execute format('drop table public.ine_crf_polygons_p%s', v_old.n);
      v_dropped := v_dropped + 1;
    end if;
  end loop;
  truncate public.ine_crf_stage;

  v_report := jsonb_build_object(
    'inserted', v_inserted, 'rejected', v_snap.rejected_count, 'repaired', v_repaired, 'partitions_dropped', v_dropped,
    'needs_review', (select count(*) from public.ine_crf_polygons where snapshot_n = v_n and geom_status = 2),
    'year_min', (select min(year) from public.ine_crf_polygons where snapshot_n = v_n),
    'year_max', (select max(year) from public.ine_crf_polygons where snapshot_n = v_n),
    'comunas', (select count(distinct comuna_cut) from public.ine_crf_polygons where snapshot_n = v_n),
    'dwellings_total', (select sum(dwellings) from public.ine_crf_polygons where snapshot_n = v_n));
  update public.source_snapshots set validation_report = validation_report || jsonb_build_object('publish', v_report) where id = p_snapshot_id;
  return v_report;
end $$;

-- -----------------------------------------------------------------------------
-- Lectura
-- -----------------------------------------------------------------------------
create or replace function public._ine_crf_current_snapshot()
returns integer language sql stable set search_path = public as $$
  select max(s.n) from public.source_snapshots s join public.data_sources d on d.id = s.source_id
   where d.source_key = 'ine_crf_nacional' and s.status = 'loaded'
$$;

-- Polígonos en una caja (zoom alto). Devuelve hasta p_limit + 1 filas: si llegan p_limit + 1, el cliente sabe que se truncó.
create or replace function public.get_ine_crf_polygons(
  p_west double precision, p_south double precision, p_east double precision, p_north double precision,
  p_years smallint[] default null, p_limit integer default 4000)
returns table (src_oid integer, comuna_cut char(5), year smallint, dwellings integer, geom_status smallint, geojson text)
language sql stable security invoker set search_path = public as $$
  select p.src_oid, p.comuna_cut, p.year, p.dwellings, p.geom_status, ST_AsGeoJSON(p.geom, 6)
    from public.ine_crf_polygons p
   where p.snapshot_n = public._ine_crf_current_snapshot()
     and p.geom && ST_MakeEnvelope(p_west, p_south, p_east, p_north, 4326)
     and (p_years is null or p.year = any (p_years))
   order by p.src_oid
   limit p_limit + 1
$$;

-- Agregado por comuna (zoom bajo): viviendas de los certificados en los años elegidos, en el punto interior de la comuna.
create or replace function public.get_ine_crf_by_comuna(p_years smallint[] default null)
returns table (comuna_cut char(5), polygons bigint, dwellings bigint, lon double precision, lat double precision)
language sql stable security invoker set search_path = public as $$
  select p.comuna_cut, count(*), sum(p.dwellings)::bigint,
         ST_X(ST_PointOnSurface(c.geom)), ST_Y(ST_PointOnSurface(c.geom))
    from public.ine_crf_polygons p join public.comunas c on c.cut = p.comuna_cut
   where p.snapshot_n = public._ine_crf_current_snapshot() and (p_years is null or p.year = any (p_years))
   group by p.comuna_cut, c.geom
$$;

create or replace function public.get_ine_crf_coverage()
returns table (year smallint, polygons bigint, dwellings bigint, comunas integer, comunas_total integer, repaired bigint)
language sql stable security invoker set search_path = public as $$
  select p.year, count(*), sum(p.dwellings)::bigint, count(distinct p.comuna_cut)::integer,
         (select count(*)::integer from public.comunas), count(*) filter (where p.geom_status > 0)
    from public.ine_crf_polygons p
   where p.snapshot_n = public._ine_crf_current_snapshot()
   group by p.year order by p.year
$$;

-- -----------------------------------------------------------------------------
-- RLS y permisos
-- -----------------------------------------------------------------------------
alter table public.ine_crf_polygons      enable row level security;
alter table public.ine_crf_stage         enable row level security;
alter table public.ine_crf_geom_repairs  enable row level security;

drop policy if exists ine_crf_polygons_read on public.ine_crf_polygons;
create policy ine_crf_polygons_read on public.ine_crf_polygons for select to authenticated using (true);
drop policy if exists ine_crf_geom_repairs_read on public.ine_crf_geom_repairs;
create policy ine_crf_geom_repairs_read on public.ine_crf_geom_repairs for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

revoke all on public.ine_crf_polygons, public.ine_crf_stage, public.ine_crf_geom_repairs from anon;
revoke insert, update, delete, truncate on public.ine_crf_polygons, public.ine_crf_geom_repairs from authenticated;
revoke all on public.ine_crf_stage from authenticated;

revoke all on function public.publish_ine_crf_snapshot(uuid), public._ine_crf_make_partition(integer),
  public._repair_polygon(geometry, numeric), public._safe_area_m2(geometry) from public, anon, authenticated;
grant execute on function public.publish_ine_crf_snapshot(uuid), public._ine_crf_make_partition(integer),
  public._repair_polygon(geometry, numeric), public._safe_area_m2(geometry) to service_role;

revoke all on function public._ine_crf_current_snapshot(),
  public.get_ine_crf_polygons(double precision, double precision, double precision, double precision, smallint[], integer),
  public.get_ine_crf_by_comuna(smallint[]), public.get_ine_crf_coverage() from public, anon;
grant execute on function public._ine_crf_current_snapshot(),
  public.get_ine_crf_polygons(double precision, double precision, double precision, double precision, smallint[], integer),
  public.get_ine_crf_by_comuna(smallint[]), public.get_ine_crf_coverage() to authenticated, service_role;

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
      union all select 'data_sources_other', count(*) from public.data_sources where source_key <> 'ine_crf_nacional'
    ) a using (t)
   where a.n <> b.n;
  if v_bad is not null then raise exception 'Guardrail: cambiaron conteos de tablas existentes (%)', v_bad; end if;
end $$;

insert into public._migration_log (sprint, notes) values ('ine_crf_polygons_v1', 'done');
