-- =============================================================================
-- PROPUESTA (NO APLICADA) — Permisos de edificación, parte 4/4: proyectos individuales (SEIA)
-- =============================================================================
-- FASE 2, fuera del MVP. Requiere las partes 1 y 2.
--
-- Fuente: servicio ArcGIS REST público del SEA (COMPROBADO por el usuario el 2026-10-16 desde otro
-- entorno): .../WEBServices/ProyectosSEIA/MapServer  capa 1 = EIA (1.594), capa 2 = DIA (28.408).
-- Reemplaza el raspado del buscador.
--
-- Semántica que NO se debe perder en la interfaz:
--   * SEIA cubre SOLO los proyectos que ingresan al SEIA (no es un catastro de edificación).
--   * qualified_at (FECHA_CALIFICACION) NO es permiso de edificación ni inicio de obras.
--   * investment_usd (INVERSION_US) es la inversión DECLARADA, no la ejecutada.
--
-- Calidad de ubicación: el punto que informa el SEA a veces cae fuera de su comuna ("Praderas La
-- Dehesa", Lo Barnechea, trae lat -33,80). check_project_geometry() lo detecta y lo MARCA.
-- La geometría original NUNCA se modifica: una corrección es un registro aparte y visible
-- (building_project_geo_reviews), no un UPDATE silencioso.
--
-- Rollback: supabase/rollbacks/20261020120300_building_projects_down.sql
-- =============================================================================

select pg_advisory_xact_lock(hashtext('permits_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('building_projects_v1', 'start');

do $$
begin
  if to_regclass('public.source_snapshots') is null or to_regclass('public.comunas') is null or to_regclass('public.pipeline_settings') is null then
    raise exception 'Guardrail: falta la parte 1 (permits_provenance_v1); aplicarla primero';
  end if;
end $$;

create temp table _permits_counts_before on commit drop as
  select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
  union all select 'territorial_features', count(*) from public.territorial_features
  union all select 'comunas', count(*) from public.comunas;

create table if not exists public.building_projects (
  id                     bigint generated always as identity primary key,
  source_id              uuid not null,
  snapshot_id            uuid not null,
  service_layer          smallint not null check (service_layer in (1, 2)),   -- 1 = EIA, 2 = DIA
  external_id            text not null check (btrim(external_id) <> ''),      -- ID_EXPEDIENTE
  name                   text,                                                -- NOMBRE_PROYECTO
  submission_form_declared text,                                              -- FORMA_PRESENTACION
  typology_letter        text,                                                -- LETRA_TIPOLOGIA
  typology_name          text,                                                -- NOMBRE_TIPOLOGIA (p. ej. "h.1) Proyectos inmobiliarios")
  region_declared        text,                                                -- REGION
  comunas_declared       text,                                                -- COMUNAS, tal cual (puede traer varias)
  comuna_cuts            char(5)[] not null default '{}',                     -- CUT resueltos por el ETL (FK lógica a comunas); vacío = no se pudo cruzar
  titular                text,
  status_declared        text,                                                -- ESTADO_EVALUACION
  submitted_at           date,                                                -- FECHA_PRESENTACION
  qualified_at           date,                                                -- FECHA_CALIFICACION (epoch ms -> fecha en America/Santiago)
  investment_usd         numeric(18, 2) check (investment_usd is null or investment_usd >= 0),  -- DECLARADA
  expediente_url         text,
  geom                   geometry(Point, 4326),                               -- punto ORIGINAL del servicio, jamás corregido en sitio
  raw                    jsonb not null,                                      -- todos los atributos tal cual (incl. X, Y, NUEVO_X, NUEVO_Y, MODIFICADO, OBJECTID)
  geo_check_status       text not null default 'pending' check (geo_check_status in (
                           'pending', 'inside', 'near_border', 'outside_declared', 'comuna_unmatched', 'no_geometry')),
  geo_check_distance_m   numeric(12, 1),
  geo_check_detail       jsonb,
  geo_checked_at         timestamptz,
  is_current             boolean not null default false,
  created_at             timestamptz not null default now(),
  constraint bp_snapshot_belongs_to_source
    foreign key (snapshot_id, source_id) references public.source_snapshots (id, source_id) on delete restrict,
  -- si el ETL ve el mismo expediente dos veces en una capa lo RECHAZA y lo reporta; no deduplica callado
  constraint bp_snapshot_key_uniq unique (snapshot_id, service_layer, external_id)
);
create unique index if not exists bp_one_current_idx
  on public.building_projects (source_id, service_layer, external_id) where is_current;
create index if not exists bp_geom_gix on public.building_projects using gist (geom) where is_current;
create index if not exists bp_comunas_gin on public.building_projects using gin (comuna_cuts) where is_current;
create index if not exists bp_typology_idx on public.building_projects (typology_letter) where is_current;
create index if not exists bp_check_idx on public.building_projects (geo_check_status) where is_current;

comment on column public.building_projects.qualified_at is
  'FECHA_CALIFICACION del SEIA. NO es fecha de permiso de edificación ni de inicio de obras.';
comment on column public.building_projects.investment_usd is
  'Inversión DECLARADA por el titular (INVERSION_US), no la ejecutada.';

-- Revisión humana de una ubicación dudosa. Append-only: se ve quién, cuándo y por qué.
create table if not exists public.building_project_geo_reviews (
  id            bigint generated always as identity primary key,
  source_id     uuid not null,
  service_layer smallint not null,
  external_id   text not null,
  decision      text not null check (decision in ('confirmed_ok', 'confirmed_error', 'corrected')),
  proposed_geom geometry(Point, 4326),
  note          text not null check (btrim(note) <> ''),
  reviewed_by   uuid not null default auth.uid() references auth.users(id),
  reviewed_at   timestamptz not null default now(),
  constraint bpgr_corrected_has_geom check (decision <> 'corrected' or proposed_geom is not null)
);
create index if not exists bpgr_project_idx on public.building_project_geo_reviews (source_id, service_layer, external_id, reviewed_at desc);

-- Validación de punto en polígono contra la(s) comuna(s) que declara el propio expediente.
--   inside            el punto cae dentro de alguna comuna declarada
--   near_border       fuera, pero a <= la tolerancia configurable (la geometría comunal puede diferir levemente)
--   outside_declared  fuera y a más de p_tolerance_m: MARCAR, nunca mover
--   comuna_unmatched  el ETL no pudo traducir COMUNAS a CUT
--   no_geometry       el servicio no trajo punto
create or replace function public.check_project_geometry(p_snapshot_id uuid, p_tolerance_m numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_counts jsonb; v_tol numeric;
begin
  -- la tolerancia es configurable (pipeline_settings 'projects.near_border_m', valor inicial 500 m); el parámetro la sobrescribe
  v_tol := coalesce(p_tolerance_m, public.pipeline_setting('projects.near_border_m'));
  if v_tol < 0 then raise exception 'la tolerancia debe ser >= 0'; end if;

  update public.building_projects p
     set geo_check_status = x.status,
         geo_check_distance_m = x.dist,
         geo_check_detail = x.detail,
         geo_checked_at = now()
    from (
      select bp.id,
             case
               when bp.geom is null then 'no_geometry'
               when cardinality(bp.comuna_cuts) = 0
                    or (select count(*) from public.comunas c where c.cut = any (bp.comuna_cuts) and c.geom is not null) = 0
                 then 'comuna_unmatched'
               when d.dist = 0 then 'inside'
               when d.dist <= v_tol then 'near_border'
               else 'outside_declared'
             end as status,
             d.dist,
             jsonb_build_object('comuna_cuts', bp.comuna_cuts, 'tolerance_m', v_tol,
                                'lon', case when bp.geom is not null then ST_X(bp.geom) end,
                                'lat', case when bp.geom is not null then ST_Y(bp.geom) end) as detail
        from public.building_projects bp
        left join lateral (
          select min(case when ST_Covers(c.geom, bp.geom) then 0
                          else ST_Distance(c.geom::geography, bp.geom::geography) end) as dist
            from public.comunas c
           where c.cut = any (bp.comuna_cuts) and c.geom is not null and bp.geom is not null
        ) d on true
       where bp.snapshot_id = p_snapshot_id
    ) x
   where p.id = x.id;

  select coalesce(jsonb_object_agg(geo_check_status, n), '{}'::jsonb) into v_counts
    from (select geo_check_status, count(*) as n from public.building_projects where snapshot_id = p_snapshot_id group by 1) t;
  return v_counts;
end $$;

-- Vista para el mapa: el punto ORIGINAL + la última revisión humana, sin mezclarlos.
create or replace view public.building_projects_current_v with (security_invoker = true) as
select p.*,
       r.decision as review_decision, r.note as review_note, r.reviewed_at, r.proposed_geom as review_proposed_geom
  from public.building_projects p
  left join lateral (
    select * from public.building_project_geo_reviews g
     where g.source_id = p.source_id and g.service_layer = p.service_layer and g.external_id = p.external_id
     order by g.reviewed_at desc limit 1
  ) r on true
 where p.is_current;

-- Un proyecto publicado no se edita (salvo is_current y el resultado de la validación geográfica).
create or replace function public.bp_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  if (to_jsonb(new) - 'is_current' - 'geo_check_status' - 'geo_check_distance_m' - 'geo_check_detail' - 'geo_checked_at')
     is distinct from
     (to_jsonb(old) - 'is_current' - 'geo_check_status' - 'geo_check_distance_m' - 'geo_check_detail' - 'geo_checked_at') then
    raise exception 'building_projects es inmutable: cargar un snapshot nuevo (id %)', old.id using errcode = 'check_violation';
  end if;
  return new;
end $$;
drop trigger if exists trg_bp_immutable on public.building_projects;
create trigger trg_bp_immutable before update on public.building_projects
  for each row execute function public.bp_immutable();

-- Publicar: mismas invariantes que las estadísticas. La paginación pudo cortarse a la mitad,
-- así que se exige que lo cargado cuadre con el conteo que informó el servicio (returnCountOnly),
-- que el ETL deja en validation_report -> 'service_count_by_layer'.
create or replace function public.publish_project_snapshot(p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.source_snapshots; v_rows bigint; v_expected bigint; v_pending bigint; v_layer smallint;
begin
  select * into s from public.source_snapshots where id = p_snapshot_id for update;
  if not found then raise exception 'snapshot % no existe', p_snapshot_id; end if;
  perform pg_advisory_xact_lock(hashtext('projects_publish:' || s.source_id::text));
  if s.status = 'loaded' then return jsonb_build_object('snapshot_id', s.id, 'already_loaded', true); end if;
  if s.status <> 'validated' then raise exception 'snapshot % no está validado (status = %)', s.id, s.status; end if;

  select count(*), min(service_layer) into v_rows, v_layer from public.building_projects where snapshot_id = s.id;
  v_expected := (s.validation_report -> 'service_count_by_layer' ->> v_layer::text)::bigint;
  if v_rows = 0 then raise exception 'snapshot % no tiene filas', s.id; end if;
  if v_expected is null then raise exception 'snapshot %: falta service_count_by_layer en validation_report', s.id; end if;
  if v_rows + s.rejected_count <> v_expected then
    raise exception 'snapshot %: cargadas % + rechazadas % <> % que informa el servicio', s.id, v_rows, s.rejected_count, v_expected;
  end if;
  select count(*) into v_pending from public.building_projects where snapshot_id = s.id and geo_check_status = 'pending';
  if v_pending > 0 then raise exception 'snapshot %: % proyectos sin validar geometría', s.id, v_pending; end if;

  -- cada snapshot SEIA es una foto COMPLETA de la capa: lo vigente anterior deja de serlo
  -- (un expediente que ya no aparece en el servicio queda solo en su snapshot histórico)
  update public.building_projects o set is_current = false
   where o.is_current and o.source_id = s.source_id and o.snapshot_id <> s.id;
  update public.building_projects set is_current = true where snapshot_id = s.id;

  update public.source_snapshots set status = 'superseded'
   where source_id = s.source_id and status = 'loaded' and id <> s.id;
  update public.source_snapshots set status = 'loaded', loaded_at = now() where id = s.id;
  return jsonb_build_object('snapshot_id', s.id, 'rows', v_rows);
end $$;

-- RLS
alter table public.building_projects            enable row level security;
alter table public.building_project_geo_reviews enable row level security;

drop policy if exists bp_read on public.building_projects;
create policy bp_read on public.building_projects for select to authenticated using (true);
drop policy if exists bpgr_read on public.building_project_geo_reviews;
create policy bpgr_read on public.building_project_geo_reviews for select to authenticated using (true);
drop policy if exists bpgr_insert on public.building_project_geo_reviews;
create policy bpgr_insert on public.building_project_geo_reviews for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin') and reviewed_by = auth.uid());
-- sin UPDATE/DELETE: el historial de revisiones no se reescribe

revoke all on public.building_projects, public.building_project_geo_reviews, public.building_projects_current_v from anon;
grant select on public.building_projects_current_v to authenticated;
revoke all on function public.check_project_geometry(uuid, numeric), public.publish_project_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.check_project_geometry(uuid, numeric), public.publish_project_snapshot(uuid) to service_role;

do $$
declare v_bad text;
begin
  select string_agg(b.t || ': ' || b.n || ' -> ' || a.n, ', ') into v_bad
    from _permits_counts_before b
    join (
      select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
      union all select 'territorial_features', count(*) from public.territorial_features
      union all select 'comunas', count(*) from public.comunas
    ) a using (t)
   where a.n <> b.n;
  if v_bad is not null then raise exception 'Guardrail: cambiaron conteos de tablas existentes (%)', v_bad; end if;
end $$;

insert into public._migration_log (sprint, notes) values ('building_projects_v1', 'done');
