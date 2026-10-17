-- =============================================================================
-- PROPUESTA (NO APLICADA) — Parte 4, 3/4: proyectos del SEIA (EIA y DIA), tipologías inmobiliarias y urbanas
-- =============================================================================
-- Reemplaza a la antigua 20261020120300_building_projects (fase 2, nunca aplicada). Fuente: servicio ArcGIS REST
-- del SEA, ProyectosSEIA/MapServer, capa 1 (EIA, 1.594 registros) y capa 2 (DIA, 28.408), sondeo real del 2026-10-17.
--
-- HALLAZGOS REALES que cambian el diseño anterior (docs/proyectos-parte4/HALLAZGOS_SONDEO.md):
--   * ID_EXPEDIENTE llega a 2.147.998.999 (> 2^31-1): bigint, no integer;
--   * la geometría del servicio coincide con NUEVO_X/NUEVO_Y (coordenadas corregidas por el SEA); X/Y vienen redondeados a
--     grados enteros en proyectos recientes. Se guarda la geometría del servicio y X/Y crudos aparte;
--   * COMUNAS es el NOMBRE de la comuna (el ETL lo cruza a CUT contra `comunas` + alias); REGION es romano;
--   * las fechas son epoch a medianoche UTC (se convierten a fecha en UTC);
--   * el MISMO código de tipología tiene NOMBRES distintos según el reglamento: se filtra por letra (tabla de reglas, editable);
--   * `h.1 Proyectos inmobiliarios` incluye proyectos no residenciales: tipología inmobiliaria != vivienda;
--   * caso reproducido con datos reales: Praderas La Dehesa (expediente 2147600353, Lo Barnechea) tiene su punto en -33,802 /
--     -70,720, fuera de la comuna: queda outside_declared con su distancia; el original NUNCA se mueve.
--
-- Semántica que la interfaz NO puede perder: el SEIA cubre SOLO lo que ingresa al sistema; FECHA_CALIFICACION NO es un
-- permiso de edificación ni el inicio de obras; INVERSION_US es DECLARADA; el estado de evaluación se muestra siempre.
--
-- Requiere 20261021120000_ine_permit_points (geo_rejected_rows y settings). SOLO ADITIVA.
-- Rollback: supabase/rollbacks/20261021120200_seia_projects_down.sql
-- =============================================================================

select pg_advisory_xact_lock(hashtext('permits_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('seia_projects_v1', 'start');

do $$
begin
  if to_regclass('public.geo_rejected_rows') is null or to_regclass('public.comuna_name_aliases') is null then
    raise exception 'Guardrail: falta 20261021120000_ine_permit_points; aplicarla primero';
  end if;
end $$;

create temp table _p4_counts_before on commit drop as
  select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
  union all select 'territorial_layers', count(*) from public.territorial_layers
  union all select 'territorial_features', count(*) from public.territorial_features
  union all select 'comunas', count(*) from public.comunas
  union all select 'source_snapshots', count(*) from public.source_snapshots
  union all select 'data_sources', count(*) from public.data_sources;

-- Las dos fuentes SEIA ya existen (parte 1): se actualiza su verificación con el sondeo real (idempotente).
update public.data_sources
   set verified_at = date '2026-10-17',
       verification_note = verification_note || ' RE-COMPROBADO por sondeo real el 2026-10-17: capa 1 = 1.594 y capa 2 = 28.408 registros; maxRecordCount 2000; el servicio NO declara editingInfo (sin fecha de última edición); copyrightText = "sea"; sin licencia declarada (por confirmar). La geometría del servicio coincide con NUEVO_X/NUEVO_Y.',
       scope_note = 'Solo proyectos que ingresan al SEIA (no es un catastro de edificación). FECHA_CALIFICACION no es permiso de edificación ni inicio de obras. INVERSION_US es DECLARADA. La tipología inmobiliaria incluye proyectos no residenciales. El estado de evaluación (aprobado, desistido, rechazado…) se muestra siempre.'
 where source_key in ('seia_proyectos_eia', 'seia_proyectos_dia')
   and verification_note not like '%RE-COMPROBADO por sondeo real el 2026-10-17%';

-- -----------------------------------------------------------------------------
-- Reglas de tipología (datos, no código): qué letras entran
-- -----------------------------------------------------------------------------
create table if not exists public.seia_typology_rules (
  letter   text primary key check (btrim(letter) <> ''),
  include  boolean not null,
  category text not null check (category in ('urban_development', 'housing', 'equipment', 'tourism',
                                             'industrial_urbanization', 'real_estate', 'industrial', 'plan', 'other')),
  reason   text not null
);
insert into public.seia_typology_rules (letter, include, category, reason) values
  ('g.',  true,  'urban_development',      'Proyectos de desarrollo urbano o turístico fuera de los planes del art. 10 letra h (EIA/DIA, reglamento antiguo).'),
  ('g.1', true,  'urban_development',      'Conjuntos habitacionales >= 80 viviendas / proyectos de desarrollo urbano con edificación y/o urbanización (dos redacciones del reglamento).'),
  ('g.2', true,  'equipment',              'Proyectos de equipamiento o de desarrollo turístico (dos redacciones del reglamento).'),
  ('g.3', true,  'industrial_urbanization','Urbanizaciones y/o loteos con destino industrial >= 30.000 m2.'),
  ('g.4', true,  'tourism',                'Proyectos de desarrollo turístico con uso habitacional y/o equipamiento.'),
  ('h.1', true,  'real_estate',            'Proyectos inmobiliarios. OJO: incluye proyectos no residenciales (fábricas, centros comerciales); tipología inmobiliaria != vivienda.'),
  ('h.2', false, 'industrial',             'Proyectos industriales en zonas de planes: no son proyectos inmobiliarios ni urbanos de edificación. EXCLUIDA por defecto (decisión editable).'),
  ('h.3', false, 'plan',                   'Plan regional de desarrollo urbano: es un instrumento de planificación, no una obra.'),
  ('h.4', false, 'plan',                   'Plan intercomunal: instrumento de planificación.'),
  ('h.5', false, 'plan',                   'Plan regulador comunal: instrumento de planificación.'),
  ('h.6', false, 'plan',                   'Plan seccional: instrumento de planificación.')
on conflict (letter) do nothing;
-- Cualquier letra que no esté en la tabla queda EXCLUIDA (minería, energía, acuicultura, infraestructura…); el ETL informa sus conteos.

-- -----------------------------------------------------------------------------
-- Proyectos
-- -----------------------------------------------------------------------------
--   service_layer: 1 = EIA, 2 = DIA
--   geo_status: 0 inside · 1 near_border · 2 outside_declared · 3 comuna_unmatched · 4 no_geometry · 5 comuna_without_polygon
create table if not exists public.building_projects (
  snapshot_n        integer  not null,
  service_layer     smallint not null check (service_layer in (1, 2)),
  expediente_id     bigint   not null,                                   -- ID_EXPEDIENTE (llega hasta 2.147.998.999)
  src_oid           bigint   not null,                                   -- OBJECTID (no estable entre capturas)
  name              text     not null,                                   -- NOMBRE_PROYECTO
  form              text     not null check (form in ('EIA', 'DIA')),    -- FORMA_PRESENTACION
  typology_letter   text     not null references public.seia_typology_rules(letter),
  typology_name     text     not null,
  region_declared   text,                                                -- REGION tal cual ('RM', 'VI'…)
  comunas_declared  text,                                                -- COMUNAS tal cual (NOMBRE de la comuna)
  comuna_cuts       char(5)[] not null default '{}',                     -- CUT resueltos por el ETL; vacío = no se pudo cruzar
  titular           text,
  status_declared   text     not null,                                   -- ESTADO_EVALUACION
  submitted_at      date,                                                -- FECHA_PRESENTACION (fecha UTC)
  qualified_at      date,                                                -- FECHA_CALIFICACION: NO es permiso ni inicio de obras
  investment_usd    numeric(18, 2) check (investment_usd is null or investment_usd >= 0),   -- DECLARADA
  expediente_url    text,
  x_raw             double precision,                                    -- X crudo (suele venir redondeado a grados enteros)
  y_raw             double precision,
  modificado        smallint,                                            -- MODIFICADO (significado NO documentado por el SEA)
  geo_status        smallint not null check (geo_status between 0 and 5),
  geo_distance_m    real,                                                -- metros a la comuna declarada más cercana (solo si no cae dentro)
  geom              geometry(Point, 4326),                               -- geometría del servicio; jamás corregida en sitio
  constraint building_projects_pk primary key (snapshot_n, service_layer, expediente_id),
  constraint building_projects_form_layer check ((service_layer = 1 and form = 'EIA') or (service_layer = 2 and form = 'DIA'))
);
create index if not exists building_projects_geom_gix on public.building_projects using gist (geom);
create index if not exists building_projects_status_idx on public.building_projects (snapshot_n, status_declared);

comment on table public.building_projects is
  'Proyectos del SEIA (EIA/DIA) de tipologías inmobiliarias y urbanas. Solo lo que ingresa al SEIA. qualified_at NO es permiso ni inicio de obras; investment_usd es DECLARADA; muestra siempre status_declared.';
comment on column public.building_projects.geom is 'Geometría del servicio (= NUEVO_X/NUEVO_Y). Nunca se modifica; una corrección es una fila en building_project_geo_reviews.';
comment on column public.building_projects.geo_status is '0 dentro de la comuna declarada, 1 near_border, 2 outside_declared, 3 comuna_unmatched, 4 no_geometry, 5 comuna sin polígono.';

-- Revisión humana de una ubicación dudosa: APPEND-ONLY y por proyecto (sobrevive a los snapshots).
create table if not exists public.building_project_geo_reviews (
  id             bigint generated always as identity primary key,
  service_layer  smallint not null check (service_layer in (1, 2)),
  expediente_id  bigint   not null,
  decision       text     not null check (decision in ('confirm_original', 'propose_correction', 'unlocatable')),
  proposed_lon   double precision check (proposed_lon is null or proposed_lon between -180 and 180),
  proposed_lat   double precision check (proposed_lat is null or proposed_lat between -90 and 90),
  note           text     not null check (btrim(note) <> ''),
  reviewed_by    uuid     references auth.users(id) on delete set null,
  reviewed_at    timestamptz not null default now(),
  constraint geo_reviews_correction_has_coords check (decision <> 'propose_correction' or (proposed_lon is not null and proposed_lat is not null))
);
create index if not exists building_project_geo_reviews_key_idx on public.building_project_geo_reviews (service_layer, expediente_id, reviewed_at desc);

create or replace function public.building_project_geo_reviews_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'building_project_geo_reviews es solo de agregado: no se modifica ni se borra (corrige agregando otra revisión)';
end $$;
drop trigger if exists trg_geo_reviews_append_only on public.building_project_geo_reviews;
create trigger trg_geo_reviews_append_only before update or delete on public.building_project_geo_reviews
  for each row execute function public.building_project_geo_reviews_append_only();

create unlogged table if not exists public.seia_stage (
  snapshot_n       integer  not null,
  service_layer    smallint not null,
  expediente_id    bigint   not null,
  src_oid          bigint   not null,
  name             text     not null,
  form             text     not null,
  typology_letter  text     not null,
  typology_name    text     not null,
  region_declared  text,
  comunas_declared text,
  comuna_cuts      char(5)[] not null default '{}',
  titular          text,
  status_declared  text     not null,
  submitted_at     date,
  qualified_at     date,
  investment_usd   double precision,
  expediente_url   text,
  x_raw            double precision,
  y_raw            double precision,
  modificado       smallint,
  lon              double precision,
  lat              double precision
);

-- -----------------------------------------------------------------------------
-- Publicación (única vía) — re-valida y calcula la validación geográfica
-- -----------------------------------------------------------------------------
create or replace function public.publish_seia_snapshot(p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_snap public.source_snapshots%rowtype;
  v_key text; v_n int; v_layer smallint; v_staged bigint; v_excluded bigint; v_bad text;
  v_max_reject numeric; v_near numeric; v_inserted bigint; v_keep int; v_old record; v_removed bigint := 0; v_report jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('seia_publish'));
  perform set_config('statement_timeout', '10min', true);

  select * into v_snap from public.source_snapshots where id = p_snapshot_id for update;
  if not found then raise exception 'snapshot % no existe', p_snapshot_id; end if;
  select source_key into v_key from public.data_sources where id = v_snap.source_id;
  v_layer := case v_key when 'seia_proyectos_eia' then 1 when 'seia_proyectos_dia' then 2 end;
  if v_layer is null then raise exception 'el snapshot es de %, no de una fuente SEIA', v_key; end if;
  if v_snap.status <> 'validated' then raise exception 'el snapshot está en estado % (debe ser validated)', v_snap.status; end if;
  v_n := v_snap.n;
  if exists (select 1 from public.source_snapshots where source_id = v_snap.source_id and status = 'loaded' and n > v_n) then
    raise exception 'ya hay un snapshot más nuevo publicado; no se publica uno más viejo';
  end if;

  -- conteos: lo cargado + lo excluido por tipología + lo rechazado = lo que el servidor declaró; el servidor no cambió
  select count(*) into v_staged from public.seia_stage where snapshot_n = v_n;
  v_excluded := coalesce((v_snap.validation_report ->> 'typology_excluded_count')::bigint, -1);
  if v_excluded < 0 then raise exception 'falta typology_excluded_count en el reporte del snapshot'; end if;
  if (v_snap.validation_report ->> 'server_count_before') is distinct from (v_snap.validation_report ->> 'server_count_after')
     or (v_snap.validation_report ->> 'server_count_before')::bigint is distinct from v_snap.row_count_raw then
    raise exception 'el conteo del servidor cambió durante la descarga o no coincide con row_count_raw (antes %, después %, declarado %)',
      v_snap.validation_report ->> 'server_count_before', v_snap.validation_report ->> 'server_count_after', v_snap.row_count_raw;
  end if;
  if v_staged + v_excluded + v_snap.rejected_count <> v_snap.row_count_raw then
    raise exception 'cuadre de conteos: cargados % + excluidos por tipología % + rechazados % <> servidor %',
      v_staged, v_excluded, v_snap.rejected_count, v_snap.row_count_raw;
  end if;
  v_max_reject := public.pipeline_setting('publish.max_reject_ratio');
  if v_snap.row_count_raw = 0 or v_snap.rejected_count::numeric / v_snap.row_count_raw > v_max_reject then
    raise exception 'rechazos % de % superan el máximo configurado (%)', v_snap.rejected_count, v_snap.row_count_raw, v_max_reject;
  end if;

  -- dominios
  if exists (select 1 from public.seia_stage where snapshot_n = v_n and service_layer <> v_layer) then
    raise exception 'hay filas de otra capa en la zona de paso';
  end if;
  select string_agg(distinct s.typology_letter, ', ') into v_bad from public.seia_stage s
    left join public.seia_typology_rules r on r.letter = s.typology_letter and r.include
   where s.snapshot_n = v_n and r.letter is null;
  if v_bad is not null then raise exception 'tipologías no incluidas (o desconocidas) en la zona de paso: %', v_bad; end if;
  select string_agg(distinct c::text, ', ') into v_bad from (
    select unnest(s.comuna_cuts) c from public.seia_stage s where s.snapshot_n = v_n) x
    left join public.comunas m on m.cut = x.c where m.cut is null;
  if v_bad is not null then raise exception 'CUT que no existen en comunas: %', v_bad; end if;
  if exists (select 1 from public.seia_stage where snapshot_n = v_n and (lon not between -180 and 180 or lat not between -90 and 90)) then
    raise exception 'coordenadas fuera de rango';
  end if;
  if exists (select 1 from public.seia_stage where snapshot_n = v_n group by expediente_id having count(*) > 1) then
    raise exception 'ID_EXPEDIENTE duplicado dentro del snapshot';
  end if;

  -- validación geográfica contra la(s) comuna(s) que declara el expediente; la distancia solo se calcula si no cae dentro
  v_near := public.pipeline_setting('projects.near_border_m');
  create temp table _seia_geo on commit drop as
    select s.expediente_id,
           case when s.lon is null or s.lat is null then null else ST_SetSRID(ST_MakePoint(s.lon, s.lat), 4326) end as pt,
           s.comuna_cuts,
           (select count(*) from public.comunas c where c.cut = any (s.comuna_cuts) and c.geom is not null) as n_poly
      from public.seia_stage s where s.snapshot_n = v_n;
  alter table _seia_geo add column inside boolean, add column dist real;
  update _seia_geo g set inside = exists (select 1 from public.comunas c where c.cut = any (g.comuna_cuts) and c.geom is not null and ST_Covers(c.geom, g.pt))
   where g.pt is not null and g.n_poly > 0;
  update _seia_geo g set dist = (select min(ST_Distance(c.geom::geography, g.pt::geography))::real from public.comunas c
                                  where c.cut = any (g.comuna_cuts) and c.geom is not null)
   where g.pt is not null and g.n_poly > 0 and not g.inside;

  insert into public.building_projects (snapshot_n, service_layer, expediente_id, src_oid, name, form, typology_letter, typology_name,
      region_declared, comunas_declared, comuna_cuts, titular, status_declared, submitted_at, qualified_at, investment_usd, expediente_url,
      x_raw, y_raw, modificado, geo_status, geo_distance_m, geom)
  select s.snapshot_n, s.service_layer, s.expediente_id, s.src_oid, s.name, s.form, s.typology_letter, s.typology_name,
         s.region_declared, s.comunas_declared, s.comuna_cuts, s.titular, s.status_declared, s.submitted_at, s.qualified_at,
         s.investment_usd::numeric(18, 2), s.expediente_url, s.x_raw, s.y_raw, s.modificado,
         (case when g.pt is null then 4
               when cardinality(s.comuna_cuts) = 0 then 3
               when g.n_poly = 0 then 5
               when g.inside then 0
               when g.dist <= v_near then 1
               else 2 end)::smallint,
         g.dist, g.pt
    from public.seia_stage s join _seia_geo g on g.expediente_id = s.expediente_id
   where s.snapshot_n = v_n;
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
    delete from public.building_projects where snapshot_n = v_old.n;
    v_removed := v_removed + 1;
  end loop;
  truncate public.seia_stage;

  v_report := jsonb_build_object(
    'inserted', v_inserted, 'typology_excluded', v_excluded, 'rejected', v_snap.rejected_count, 'old_snapshots_cleared', v_removed,
    'geo_status', (select jsonb_object_agg(geo_status::text, n) from (
        select geo_status, count(*) n from public.building_projects where snapshot_n = v_n and service_layer = v_layer group by 1) a),
    'status_declared', (select jsonb_object_agg(status_declared, n) from (
        select status_declared, count(*) n from public.building_projects where snapshot_n = v_n and service_layer = v_layer group by 1) a));
  update public.source_snapshots set validation_report = validation_report || jsonb_build_object('publish', v_report) where id = p_snapshot_id;
  return v_report;
end $$;

-- -----------------------------------------------------------------------------
-- Lectura
-- -----------------------------------------------------------------------------
-- Última captura publicada de cada capa (EIA y DIA son fuentes distintas).
create or replace function public._seia_current_snapshots()
returns table (service_layer smallint, snapshot_n integer, snapshot_id uuid, captured_at timestamptz)
language sql stable set search_path = public as $$
  select distinct on (d.source_key)
         case d.source_key when 'seia_proyectos_eia' then 1 else 2 end::smallint, s.n, s.id, s.captured_at
    from public.source_snapshots s join public.data_sources d on d.id = s.source_id
   where d.source_key in ('seia_proyectos_eia', 'seia_proyectos_dia') and s.status = 'loaded'
   order by d.source_key, s.n desc
$$;

create or replace function public.get_seia_projects(
  p_west double precision default -180, p_south double precision default -90, p_east double precision default 180, p_north double precision default 90,
  p_states text[] default null, p_forms text[] default null, p_year_from integer default null, p_year_to integer default null,
  p_limit integer default 6000)
returns table (
  service_layer smallint, expediente_id bigint, name text, form text, typology_letter text, typology_name text,
  status_declared text, comunas_declared text, titular text, submitted_at date, qualified_at date, investment_usd numeric,
  expediente_url text, lon double precision, lat double precision, geo_status smallint, geo_distance_m real,
  review_decision text, proposed_lon double precision, proposed_lat double precision, review_note text,
  snapshot_id uuid, captured_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select p.service_layer, p.expediente_id, p.name, p.form, p.typology_letter, p.typology_name, p.status_declared, p.comunas_declared,
         p.titular, p.submitted_at, p.qualified_at, p.investment_usd, p.expediente_url, ST_X(p.geom), ST_Y(p.geom), p.geo_status, p.geo_distance_m,
         r.decision, r.proposed_lon, r.proposed_lat, r.note, c.snapshot_id, c.captured_at
    from public._seia_current_snapshots() c
    join public.building_projects p on p.snapshot_n = c.snapshot_n and p.service_layer = c.service_layer
    left join lateral (
      select rr.decision, rr.proposed_lon, rr.proposed_lat, rr.note from public.building_project_geo_reviews rr
       where rr.service_layer = p.service_layer and rr.expediente_id = p.expediente_id order by rr.reviewed_at desc, rr.id desc limit 1) r on true
   where p.geom is not null and p.geom && ST_MakeEnvelope(p_west, p_south, p_east, p_north, 4326)
     and (p_states is null or p.status_declared = any (p_states))
     and (p_forms is null or p.form = any (p_forms))
     and (p_year_from is null or extract(year from p.submitted_at) >= p_year_from)
     and (p_year_to   is null or extract(year from p.submitted_at) <= p_year_to)
   order by p.submitted_at desc nulls last, p.expediente_id
   limit p_limit
$$;

-- Resumen para la leyenda: cuántos proyectos hay por estado y calidad de ubicación (de la captura vigente).
create or replace function public.get_seia_summary()
returns table (service_layer smallint, status_declared text, geo_status smallint, projects bigint, investment_usd numeric)
language sql stable security invoker set search_path = public as $$
  select p.service_layer, p.status_declared, p.geo_status, count(*), sum(p.investment_usd)
    from public._seia_current_snapshots() c
    join public.building_projects p on p.snapshot_n = c.snapshot_n and p.service_layer = c.service_layer
   group by 1, 2, 3 order by 1, 2, 3
$$;

-- -----------------------------------------------------------------------------
-- RLS y permisos
-- -----------------------------------------------------------------------------
alter table public.seia_typology_rules          enable row level security;
alter table public.building_projects            enable row level security;
alter table public.building_project_geo_reviews enable row level security;
alter table public.seia_stage                   enable row level security;

drop policy if exists seia_typology_rules_read on public.seia_typology_rules;
create policy seia_typology_rules_read on public.seia_typology_rules for select to authenticated using (true);
drop policy if exists seia_typology_rules_write on public.seia_typology_rules;
create policy seia_typology_rules_write on public.seia_typology_rules for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
drop policy if exists building_projects_read on public.building_projects;
create policy building_projects_read on public.building_projects for select to authenticated using (true);
drop policy if exists geo_reviews_read on public.building_project_geo_reviews;
create policy geo_reviews_read on public.building_project_geo_reviews for select to authenticated using (true);
drop policy if exists geo_reviews_insert on public.building_project_geo_reviews;
create policy geo_reviews_insert on public.building_project_geo_reviews for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin') and reviewed_by = auth.uid());

revoke all on public.seia_typology_rules, public.building_projects, public.building_project_geo_reviews, public.seia_stage from anon;
revoke insert, update, delete, truncate on public.building_projects from authenticated;
revoke update, delete, truncate on public.building_project_geo_reviews from authenticated;
revoke all on public.seia_stage from authenticated;

revoke all on function public.publish_seia_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.publish_seia_snapshot(uuid) to service_role;
revoke all on function public._seia_current_snapshots(),
  public.get_seia_projects(double precision, double precision, double precision, double precision, text[], text[], integer, integer, integer),
  public.get_seia_summary() from public, anon;
grant execute on function public._seia_current_snapshots(),
  public.get_seia_projects(double precision, double precision, double precision, double precision, text[], text[], integer, integer, integer),
  public.get_seia_summary() to authenticated, service_role;

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
      union all select 'data_sources', count(*) from public.data_sources
    ) a using (t)
   where a.n <> b.n;
  if v_bad is not null then raise exception 'Guardrail: cambiaron conteos de tablas existentes (%)', v_bad; end if;
end $$;

insert into public._migration_log (sprint, notes) values ('seia_projects_v1', 'done');
