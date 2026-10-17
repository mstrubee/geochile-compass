-- =============================================================================
-- PROPUESTA (NO APLICADA) — Proyectos puntuales del SEIA, parte 1/3: tablas, validación y publicación
-- =============================================================================
-- REEMPLAZA a 20261020120300_building_projects.sql (nunca se aplicó). Cambios respecto de ese diseño:
--   * Tablas PROPIAS del SEIA (seia_*), sin una tabla genérica de "proyectos" compartida con el INE.
--     Si más adelante hace falta una vista común, va en un PR aparte.
--   * Una fuente = una capa del servicio (EIA o DIA): desaparece service_layer y la clave es (source_id, external_id).
--   * Cada carga es una foto COMPLETA (≈ 30.000 filas por semana). Dos decisiones para que no crezca sin límite:
--       - "Vigente" es UN puntero por fuente (seia_current_snapshot), no una columna por fila. Publicar es un upsert de
--         una fila: antes eran ~56.000 UPDATE por carga (medido: bloat y 494 MB con 3 fotos sin purga).
--       - seia_purge_superseded() conserva las filas de los últimos K snapshots (pipeline_settings
--         'retention.keep_snapshots') y NUNCA toca el archivo original en Storage.
--     El resultado de la validación geográfica va en una tabla ANGOSTA aparte (seia_project_geo_checks), así
--     seia_projects no se actualiza nunca (un UPDATE de ~30.000 filas con texto y JSONB duplicaba el espacio).
--   * El cruce COMUNAS → CUT puede quedar incompleto: lo no resuelto se guarda (comunas_unresolved) en vez de perderse.
--   * Una fila con coordenadas fuera de rango se conserva SIN punto (no_geometry) y no se descarta.
--
-- Requiere la parte 1 de permisos (data_sources, source_snapshots, comunas, pipeline_settings).
-- No requiere thematic_layers: la hoja del árbol va en 20261021120200 (después de desplegar el front).
--
-- Fuente: servicio ArcGIS REST público del SEA (COMPROBADO por el usuario el 2026-10-16 desde otro
-- entorno): .../WEBServices/ProyectosSEIA/MapServer  capa 1 = EIA (1.594), capa 2 = DIA (28.408).
--
-- Semántica que NO se debe perder en la interfaz:
--   * SEIA cubre SOLO los proyectos que ingresan al SEIA (no es un catastro de edificación).
--   * qualified_at (FECHA_CALIFICACION) NO es permiso de edificación ni inicio de obras.
--   * investment_usd (INVERSION_US) es la inversión DECLARADA, no la ejecutada.
--
-- Calidad de ubicación: el punto que informa el SEA a veces cae fuera de su comuna ("Praderas La
-- Dehesa", Lo Barnechea, trae lat -33,80). seia_check_geometry() lo detecta y lo MARCA. La geometría
-- original NUNCA se modifica: una corrección es un registro aparte y visible (seia_project_geo_reviews).
--
-- Rollback: supabase/rollbacks/20261021120000_seia_projects_down.sql
-- =============================================================================

select pg_advisory_xact_lock(hashtext('seia_projects_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('seia_projects_v1', 'start');

do $$
begin
  if to_regclass('public.source_snapshots') is null or to_regclass('public.comunas') is null
     or to_regclass('public.pipeline_settings') is null or to_regclass('public.data_sources') is null then
    raise exception 'Guardrail: falta la parte 1 de permisos (permits_provenance_v1); aplicarla primero';
  end if;
  if (select count(*) from public.data_sources where source_key in ('seia_proyectos_eia', 'seia_proyectos_dia')) <> 2 then
    raise exception 'Guardrail: data_sources no tiene las fuentes seia_proyectos_eia / seia_proyectos_dia';
  end if;
end $$;

create temp table _seia_counts_before on commit drop as
  select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
  union all select 'territorial_features', count(*) from public.territorial_features
  union all select 'comunas', count(*) from public.comunas
  union all select 'data_sources', count(*) from public.data_sources
  union all select 'source_snapshots', count(*) from public.source_snapshots;

-- -----------------------------------------------------------------------------
-- 1. Proyectos
-- -----------------------------------------------------------------------------
create table if not exists public.seia_projects (
  id                     bigint generated always as identity primary key,
  source_id              uuid not null,                                        -- EIA o DIA: una fuente por capa del servicio
  snapshot_id            uuid not null,
  external_id            text not null check (btrim(external_id) <> ''),       -- ID_EXPEDIENTE
  name                   text,                                                 -- NOMBRE_PROYECTO
  submission_form_declared text,                                               -- FORMA_PRESENTACION
  typology_letter        text,                                                 -- LETRA_TIPOLOGIA (p. ej. "h.1")
  typology_name          text,                                                 -- NOMBRE_TIPOLOGIA (p. ej. "h.1) Proyectos inmobiliarios")
  region_declared        text,                                                 -- REGION
  comunas_declared       text,                                                 -- COMUNAS, tal cual (puede traer varias)
  comuna_cuts            char(5)[] not null default '{}',                      -- CUT resueltos por el ETL; vacío = no se pudo cruzar
  comunas_unresolved     text[] not null default '{}',                         -- fragmentos de COMUNAS que NO calzaron con una comuna
  titular                text,
  status_declared        text,                                                 -- ESTADO_EVALUACION
  submitted_at           date,                                                 -- FECHA_PRESENTACION
  qualified_at           date,                                                 -- FECHA_CALIFICACION (epoch ms -> fecha en America/Santiago)
  investment_usd         numeric(18, 2) check (investment_usd is null or investment_usd >= 0),   -- DECLARADA
  expediente_url         text,
  geom                   geometry(Point, 4326),                                -- punto ORIGINAL del servicio, jamás corregido en sitio
  raw                    jsonb not null,                                       -- atributos que NO están en una columna tal cual: OBJECTID, X, Y, NUEVO_X, NUEVO_Y,
                                                                               -- MODIFICADO, las fechas en epoch original y cualquier campo desconocido. El
                                                                               -- original COMPLETO está archivado en Storage (source_snapshots.storage_path).
  created_at             timestamptz not null default now(),
  constraint sp_snapshot_belongs_to_source
    foreign key (snapshot_id, source_id) references public.source_snapshots (id, source_id) on delete restrict,
  -- si el ETL ve el mismo expediente dos veces en una capa lo RECHAZA y lo reporta; no deduplica callado
  constraint sp_snapshot_key_uniq unique (snapshot_id, external_id)
);
-- Dos índices: el mapa (bbox) y la ficha (búsqueda por expediente). Cubren las filas retenidas (K fotos), no solo las vigentes;
-- el filtro por foto vigente lo hace el JOIN con seia_current_snapshot. Sin índice por tipología: se filtra después del bbox.
create index if not exists sp_geom_gix on public.seia_projects using gist (geom);
create index if not exists sp_external_idx on public.seia_projects (source_id, external_id);

comment on table public.seia_projects is
  'Proyectos que ingresan al SEIA (capas EIA y DIA del servicio ArcGIS del SEA). NO es un catastro de edificación.';
comment on column public.seia_projects.qualified_at is
  'FECHA_CALIFICACION del SEIA. NO es fecha de permiso de edificación ni de inicio de obras.';
comment on column public.seia_projects.investment_usd is
  'Inversión DECLARADA por el titular (INVERSION_US), no la ejecutada.';
comment on column public.seia_projects.geom is
  'Punto ORIGINAL informado por el servicio. Nunca se modifica; una corrección es una fila de seia_project_geo_reviews.';

-- Resultado de la validación geográfica: UNA fila angosta por proyecto (nunca se actualiza la fila ancha).
-- "Sin validar" = no hay fila aquí; seia_publish_snapshot() no publica mientras falte alguna.
create table if not exists public.seia_project_geo_checks (
  project_id bigint primary key references public.seia_projects(id) on delete cascade,
  status     text not null check (status in ('inside', 'near_border', 'outside_declared', 'comuna_unmatched', 'no_geometry')),
  distance_m numeric(12, 1),
  detail     jsonb,
  checked_at timestamptz not null default now()
);

-- Foto vigente de cada fuente. Cada carga SEIA es una foto COMPLETA de su capa: lo que no está en la vigente ya no existe
-- en el servicio (queda solo en su snapshot histórico). Solo seia_publish_snapshot() escribe aquí.
create table if not exists public.seia_current_snapshot (
  source_id    uuid primary key references public.data_sources(id) on delete restrict,
  snapshot_id  uuid not null,
  published_at timestamptz not null default now(),
  constraint scs_snapshot_belongs_to_source
    foreign key (snapshot_id, source_id) references public.source_snapshots (id, source_id) on delete restrict
);

-- Filas que el ETL no pudo cargar, con motivo (no se descartan en silencio).
create table if not exists public.seia_rejected_rows (
  id          bigint generated always as identity primary key,
  snapshot_id uuid not null references public.source_snapshots(id) on delete cascade,
  row_ref     jsonb not null,                                     -- p. ej. {"objectid": 123}
  reason_code text not null check (reason_code in ('missing_id', 'duplicate_key', 'unreadable_feature')),
  detail      text,
  raw         jsonb
);
create index if not exists seia_rejected_snapshot_idx on public.seia_rejected_rows (snapshot_id);

-- Revisión humana de una ubicación dudosa. Append-only: se ve quién, cuándo y por qué.
-- Se identifica el proyecto por (fuente, expediente) y NO por seia_projects.id, para que la revisión
-- sobreviva a una carga nueva y a la purga de snapshots viejos.
create table if not exists public.seia_project_geo_reviews (
  id            bigint generated always as identity primary key,
  source_id     uuid not null references public.data_sources(id) on delete restrict,
  external_id   text not null check (btrim(external_id) <> ''),
  decision      text not null check (decision in ('confirmed_ok', 'confirmed_error', 'corrected')),
  proposed_geom geometry(Point, 4326),
  note          text not null check (btrim(note) <> ''),
  reviewed_by   uuid not null default auth.uid() references auth.users(id),
  reviewed_at   timestamptz not null default now(),
  constraint spgr_corrected_has_geom check (decision <> 'corrected' or proposed_geom is not null)
);
create index if not exists spgr_project_idx on public.seia_project_geo_reviews (source_id, external_id, reviewed_at desc);

-- -----------------------------------------------------------------------------
-- 2. Validación de punto en polígono contra la(s) comuna(s) que declara el propio expediente
--     inside            el punto cae dentro de alguna comuna declarada
--     near_border       fuera, pero a <= la tolerancia configurable (la geometría comunal puede diferir levemente)
--     outside_declared  fuera y a más de la tolerancia: MARCAR, nunca mover
--     comuna_unmatched  el ETL no pudo traducir COMUNAS a ningún CUT con geometría
--     no_geometry       el servicio no trajo punto (o venía fuera de rango)
-- Si COMUNAS trae varias comunas y solo algunas se resolvieron, el estado se calcula con las resueltas y
-- los fragmentos sin resolver quedan en seia_project_geo_checks.detail ('unresolved') para que se vea.
-- -----------------------------------------------------------------------------
create or replace function public.seia_check_geometry(p_snapshot_id uuid, p_tolerance_m numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_counts jsonb; v_tol numeric;
begin
  -- la tolerancia es configurable (pipeline_settings 'projects.near_border_m', valor inicial 500 m); el parámetro la sobrescribe
  v_tol := coalesce(p_tolerance_m, public.pipeline_setting('projects.near_border_m'));
  if v_tol < 0 then raise exception 'la tolerancia debe ser >= 0'; end if;

  -- repetir la validación (p. ej. con otra tolerancia) actualiza SOLO la fila angosta del resultado
  insert into public.seia_project_geo_checks (project_id, status, distance_m, detail, checked_at)
  select x.id, x.status, x.dist, x.detail, now()
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
             -- solo lo que NO está ya en seia_projects (CUT, lon y lat se leen de allí): la tolerancia usada y lo no resuelto
             jsonb_strip_nulls(jsonb_build_object(
               'tolerance_m', v_tol,
               'unresolved', case when cardinality(bp.comunas_unresolved) > 0 then to_jsonb(bp.comunas_unresolved) end)) as detail
        from public.seia_projects bp
        left join lateral (
          -- ST_Covers usa el índice/bbox; la distancia en geography solo se calcula para lo que NO está cubierto
          select min(case when ST_Covers(c.geom, bp.geom) then 0
                          else ST_Distance(c.geom::geography, bp.geom::geography) end) as dist
            from public.comunas c
           where c.cut = any (bp.comuna_cuts) and c.geom is not null and bp.geom is not null
        ) d on true
       where bp.snapshot_id = p_snapshot_id
    ) x
  on conflict (project_id) do update
     set status = excluded.status, distance_m = excluded.distance_m, detail = excluded.detail, checked_at = excluded.checked_at;

  select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) into v_counts
    from (select c.status, count(*) as n
            from public.seia_project_geo_checks c join public.seia_projects p on p.id = c.project_id
           where p.snapshot_id = p_snapshot_id group by 1) t;
  return v_counts;
end $$;

-- Vista para el mapa: SOLO la foto vigente de cada fuente; el punto ORIGINAL + la última revisión humana, sin mezclarlos.
-- Sin `raw` (pesa). Un proyecto sin fila de validación figuraría 'pending' (no debería existir: publish lo impide).
create or replace view public.seia_projects_current_v with (security_invoker = true) as
select p.id, p.source_id, d.source_key, upper(right(d.source_key, 3)) as kind,
       p.snapshot_id, p.external_id, p.name, p.submission_form_declared, p.typology_letter, p.typology_name,
       p.region_declared, p.comunas_declared, p.comuna_cuts, p.comunas_unresolved, p.titular, p.status_declared,
       p.submitted_at, p.qualified_at, p.investment_usd, p.expediente_url, p.geom,
       coalesce(c.status, 'pending') as geo_check_status, c.distance_m as geo_check_distance_m,
       c.detail as geo_check_detail, c.checked_at as geo_checked_at,
       r.decision as review_decision, r.note as review_note, r.reviewed_at, r.proposed_geom as review_proposed_geom
  from public.seia_projects p
  join public.seia_current_snapshot cs on cs.snapshot_id = p.snapshot_id          -- solo la foto vigente de cada fuente
  join public.data_sources d on d.id = p.source_id
  left join public.seia_project_geo_checks c on c.project_id = p.id
  left join lateral (
    select g.decision, g.note, g.reviewed_at, g.proposed_geom
      from public.seia_project_geo_reviews g
     where g.source_id = p.source_id and g.external_id = p.external_id
     order by g.reviewed_at desc, g.id desc limit 1
  ) r on true;

-- -----------------------------------------------------------------------------
-- 3. Un proyecto cargado NO se edita jamás. Corregir una ubicación es una fila de seia_project_geo_reviews;
--    cambiar datos es cargar un snapshot nuevo. (No hay UPDATE: tampoco para la validación, que vive aparte.)
-- -----------------------------------------------------------------------------
create or replace function public.seia_projects_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'seia_projects es inmutable: cargar un snapshot nuevo (id %)', old.id using errcode = 'check_violation';
end $$;
drop trigger if exists trg_seia_projects_immutable on public.seia_projects;
create trigger trg_seia_projects_immutable before update on public.seia_projects
  for each row execute function public.seia_projects_immutable();

-- -----------------------------------------------------------------------------
-- 4. Publicar. Mismas invariantes que las estadísticas. La paginación pudo cortarse a la mitad (o el
--    servicio cambió mientras se paginaba), así que se exige que lo cargado cuadre con el conteo que
--    informó el servicio (returnCountOnly), que el ETL deja en validation_report -> 'service_count'.
-- -----------------------------------------------------------------------------
create or replace function public.seia_publish_snapshot(p_snapshot_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.source_snapshots; d public.data_sources;
  v_rows bigint; v_expected bigint; v_pending bigint; v_ratio numeric; v_max numeric;
begin
  select * into s from public.source_snapshots where id = p_snapshot_id for update;
  if not found then raise exception 'snapshot % no existe', p_snapshot_id; end if;
  select * into d from public.data_sources where id = s.source_id;
  if d.source_key not in ('seia_proyectos_eia', 'seia_proyectos_dia') then
    raise exception 'snapshot %: la fuente % no es del SEIA', s.id, d.source_key;
  end if;
  perform pg_advisory_xact_lock(hashtext('seia_publish:' || s.source_id::text));
  if s.status = 'loaded' then return jsonb_build_object('snapshot_id', s.id, 'already_loaded', true); end if;
  if s.status <> 'validated' then raise exception 'snapshot % no está validado (status = %)', s.id, s.status; end if;

  -- una foto vieja no puede reemplazar a una más nueva
  if exists (select 1 from public.source_snapshots o
              where o.source_id = s.source_id and o.status in ('loaded', 'superseded') and o.n > s.n) then
    raise exception 'snapshot %: ya hay uno publicado más nuevo; no se publica una foto más vieja', s.id;
  end if;

  select count(*) into v_rows from public.seia_projects where snapshot_id = s.id;
  v_expected := (s.validation_report ->> 'service_count')::bigint;
  if v_rows = 0 then raise exception 'snapshot % no tiene filas', s.id; end if;
  if v_expected is null then raise exception 'snapshot %: falta service_count en validation_report', s.id; end if;
  if v_rows + s.rejected_count <> v_expected then
    raise exception 'snapshot %: cargadas % + rechazadas % <> % que informa el servicio', s.id, v_rows, s.rejected_count, v_expected;
  end if;
  v_max := public.pipeline_setting('publish.max_reject_ratio');
  v_ratio := s.rejected_count::numeric / v_expected;
  if v_ratio > v_max then
    raise exception 'snapshot %: % rechazadas de % (% > umbral %)', s.id, s.rejected_count, v_expected, round(v_ratio, 4), v_max;
  end if;
  select count(*) into v_pending from public.seia_projects p
   where p.snapshot_id = s.id and not exists (select 1 from public.seia_project_geo_checks c where c.project_id = p.id);
  if v_pending > 0 then raise exception 'snapshot %: % proyectos sin validar geometría', s.id, v_pending; end if;

  -- cada snapshot SEIA es una foto COMPLETA de la capa: el puntero pasa a la nueva y la anterior deja de ser vigente
  -- (un expediente que ya no aparece en el servicio queda solo en su snapshot histórico). Una fila, atómico.
  insert into public.seia_current_snapshot (source_id, snapshot_id) values (s.source_id, s.id)
  on conflict (source_id) do update set snapshot_id = excluded.snapshot_id, published_at = now();

  update public.source_snapshots set status = 'superseded'
   where source_id = s.source_id and status = 'loaded' and id <> s.id;
  update public.source_snapshots set status = 'loaded', loaded_at = now() where id = s.id;
  return jsonb_build_object('snapshot_id', s.id, 'rows', v_rows, 'rejected', s.rejected_count);
end $$;

-- Libera espacio: conserva las filas de los últimos K snapshots PUBLICADOS de la fuente (K = retention.keep_snapshots)
-- y borra las de los más viejos, incluidas las de cargas rechazadas (una publicación fallida deja ~30.000 filas inútiles).
-- NUNCA toca la foto vigente, una carga en curso ('received'/'validated'), el registro del snapshot ni su archivo original
-- en Storage, y solo purga snapshots cuyo original está archivado con su hash (sin archivo no habría cómo reconstruirlos).
create or replace function public.seia_purge_superseded(p_source_id uuid, p_keep int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_keep int; v_min_n integer; v_deleted bigint;
begin
  v_keep := coalesce(p_keep, public.pipeline_setting('retention.keep_snapshots')::int);
  if v_keep < 1 then raise exception 'retención debe ser >= 1'; end if;
  perform pg_advisory_xact_lock(hashtext('seia_publish:' || p_source_id::text));

  select min(n) into v_min_n from (
    select n from public.source_snapshots
     where source_id = p_source_id and status in ('loaded', 'superseded')
     order by n desc limit v_keep) t;
  if v_min_n is null then return jsonb_build_object('rows_deleted', 0); end if;

  delete from public.seia_projects p
   using public.source_snapshots s
   where s.id = p.snapshot_id and s.source_id = p_source_id
     and s.n < v_min_n and p.snapshot_id not in (select snapshot_id from public.seia_current_snapshot)
     and s.status in ('loaded', 'superseded', 'rejected')
     and s.storage_path is not null and length(s.sha256) = 64;
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('source_id', p_source_id, 'keep', v_keep, 'rows_deleted', v_deleted);
end $$;

-- -----------------------------------------------------------------------------
-- 5. RLS (coherente con el resto: lee autenticado; escribe solo el ETL con service_role)
-- -----------------------------------------------------------------------------
alter table public.seia_projects            enable row level security;
alter table public.seia_current_snapshot    enable row level security;
alter table public.seia_project_geo_checks  enable row level security;
alter table public.seia_rejected_rows       enable row level security;
alter table public.seia_project_geo_reviews enable row level security;

drop policy if exists seia_projects_read on public.seia_projects;
create policy seia_projects_read on public.seia_projects for select to authenticated using (true);
drop policy if exists seia_checks_read on public.seia_project_geo_checks;
create policy seia_checks_read on public.seia_project_geo_checks for select to authenticated using (true);
drop policy if exists seia_current_read on public.seia_current_snapshot;
create policy seia_current_read on public.seia_current_snapshot for select to authenticated using (true);
drop policy if exists seia_rejected_read on public.seia_rejected_rows;
create policy seia_rejected_read on public.seia_rejected_rows for select to authenticated using (true);
drop policy if exists spgr_read on public.seia_project_geo_reviews;
create policy spgr_read on public.seia_project_geo_reviews for select to authenticated using (true);
drop policy if exists spgr_insert on public.seia_project_geo_reviews;
create policy spgr_insert on public.seia_project_geo_reviews for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin') and reviewed_by = auth.uid());
-- sin UPDATE/DELETE: el historial de revisiones no se reescribe; las demás tablas no tienen política de escritura

revoke all on public.seia_projects, public.seia_project_geo_checks, public.seia_current_snapshot, public.seia_rejected_rows, public.seia_project_geo_reviews, public.seia_projects_current_v from anon;
grant select on public.seia_projects_current_v to authenticated;
revoke all on function public.seia_check_geometry(uuid, numeric), public.seia_publish_snapshot(uuid),
                       public.seia_purge_superseded(uuid, int) from public, anon, authenticated;
grant execute on function public.seia_check_geometry(uuid, numeric), public.seia_publish_snapshot(uuid),
                          public.seia_purge_superseded(uuid, int) to service_role;

-- -----------------------------------------------------------------------------
-- 6. Cero pérdida: nada de lo existente cambió
-- -----------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(b.t || ': ' || b.n || ' -> ' || a.n, ', ') into v_bad
    from _seia_counts_before b
    join (
      select 'layer_nodes'::text as t, count(*)::bigint as n from public.layer_nodes
      union all select 'territorial_features', count(*) from public.territorial_features
      union all select 'comunas', count(*) from public.comunas
      union all select 'data_sources', count(*) from public.data_sources
      union all select 'source_snapshots', count(*) from public.source_snapshots
    ) a using (t)
   where a.n <> b.n;
  if v_bad is not null then raise exception 'Guardrail: cambiaron conteos de tablas existentes (%)', v_bad; end if;
end $$;

insert into public._migration_log (sprint, notes) values ('seia_projects_v1', 'done');
