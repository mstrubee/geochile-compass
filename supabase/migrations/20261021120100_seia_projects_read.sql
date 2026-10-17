-- =============================================================================
-- PROPUESTA (NO APLICADA) — Proyectos puntuales del SEIA, parte 2/3: lectura para el mapa y la ficha
-- =============================================================================
-- Requiere 20261021120000_seia_projects.sql. Es SOLO ADITIVA (funciones; no toca tablas).
--
--   get_seia_projects()  proyectos vigentes dentro de un recuadro (bbox), con filtros. Usa el GIST de geom.
--   get_seia_facets()    valores REALES para armar los filtros (tipologías, estados, años) y conteos de calidad
--                        de ubicación. Nada de vocabularios escritos a mano en el front: el servicio no los
--                        tiene comprobados (DISENO.md, Parte 4, P7).
--   get_seia_project()   ficha de un expediente: campos, atributos originales, snapshot de origen y revisiones.
--
-- Las tres son SECURITY INVOKER: valen las políticas RLS de las tablas (autenticado lee, anon nada).
-- La procedencia de la capa (fuente, captura, frescura) sale de get_layer_provenance('building_projects').
-- Rollback: supabase/rollbacks/20261021120100_seia_projects_read_down.sql
-- =============================================================================

select pg_advisory_xact_lock(hashtext('seia_projects_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('seia_projects_read_v1', 'start');

do $$
begin
  if to_regclass('public.seia_projects_current_v') is null then
    raise exception 'Guardrail: falta 20261021120000_seia_projects.sql; aplicarla primero';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Proyectos dentro de un recuadro. Un dato faltante es NULL (no hay 0 inventados).
--   p_typology   CÓDIGOS de tipología EXACTOS ('h.1', 'g.3'), sin distinguir mayúsculas, espacios ni el punto final
--                ('c.' = 'c'). NO es por letra: el sondeo real mostró que h.1 es inmobiliario pero h.2 (industrial) y h.3-h.6
--                (planes) no, y que un mismo código puede tener nombres distintos según el año del reglamento.
--                El panel expande los grupos (p. ej. 'g' → g, g.1…g.4) con los códigos que existen. NULL = todas.
--   p_status     ESTADO_EVALUACION exacto (valores de get_seia_facets); NULL = todos
--   p_year_from / p_year_to   año de FECHA_PRESENTACION; un proyecto sin fecha NO pasa un filtro de años
--   p_hide_flagged            oculta outside_declared y comuna_unmatched (ubicación dudosa o sin validar)
-- Si hay más coincidencias que p_limit se devuelven los de MAYOR inversión declarada y total_matching dice
-- cuántos había: el front debe avisar que la vista está recortada.
-- La revisión humana NO reemplaza el punto: viene aparte (review_*).
-- -----------------------------------------------------------------------------
create or replace function public.get_seia_projects(
  p_west double precision, p_south double precision, p_east double precision, p_north double precision,
  p_typology text[] default null, p_status text[] default null, p_source_keys text[] default null,
  p_year_from int default null, p_year_to int default null,
  p_hide_flagged boolean default false, p_limit int default 3000)
returns table (
  id bigint, source_key text, kind text, external_id text, name text,
  typology_letter text, typology_name text, status_declared text,
  submitted_at date, qualified_at date, investment_usd numeric,
  lon double precision, lat double precision,
  geo_check_status text, review_decision text, review_lon double precision, review_lat double precision,
  total_matching bigint)
language plpgsql stable security invoker set search_path = public as $$
begin
  if p_west is null or p_south is null or p_east is null or p_north is null
     or p_west >= p_east or p_south >= p_north
     or p_west < -180 or p_east > 180 or p_south < -90 or p_north > 90 then
    raise exception 'recuadro inválido (west %, south %, east %, north %)', p_west, p_south, p_east, p_north;
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'p_limit debe estar entre 1 y 10000';
  end if;

  return query
  with m as (
    select v.*, count(*) over () as total
      from public.seia_projects_current_v v
     where v.geom && ST_MakeEnvelope(p_west, p_south, p_east, p_north, 4326)
       and (p_typology is null
            or lower(btrim(rtrim(btrim(v.typology_letter), '.'))) = any (select lower(btrim(rtrim(btrim(t), '.'))) from unnest(p_typology) t))
       and (p_status is null or v.status_declared = any (p_status))
       and (p_source_keys is null or v.source_key = any (p_source_keys))
       and (p_year_from is null or extract(year from v.submitted_at) >= p_year_from)
       and (p_year_to is null or extract(year from v.submitted_at) <= p_year_to)
       and (not p_hide_flagged or v.geo_check_status not in ('outside_declared', 'comuna_unmatched'))
  )
  select m.id, m.source_key, m.kind, m.external_id, m.name,
         m.typology_letter, m.typology_name, m.status_declared,
         m.submitted_at, m.qualified_at, m.investment_usd,
         ST_X(m.geom), ST_Y(m.geom),
         m.geo_check_status, m.review_decision,
         case when m.review_proposed_geom is not null then ST_X(m.review_proposed_geom) end,
         case when m.review_proposed_geom is not null then ST_Y(m.review_proposed_geom) end,
         m.total
    from m
   order by m.investment_usd desc nulls last, m.id
   limit p_limit;
end $$;

-- -----------------------------------------------------------------------------
-- Valores reales para los filtros y calidad de ubicación. Cuenta SOLO lo vigente.
-- -----------------------------------------------------------------------------
create or replace function public.get_seia_facets(p_source_keys text[] default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  with v as (
    select * from public.seia_projects_current_v where p_source_keys is null or source_key = any (p_source_keys)
  )
  select jsonb_build_object(
    'total',      (select count(*) from v),
    'with_point', (select count(*) from v where geom is not null),
    'by_source',  coalesce((select jsonb_object_agg(source_key, n) from (select source_key, count(*) n from v group by 1) t), '{}'::jsonb),
    'geo_status', coalesce((select jsonb_object_agg(geo_check_status, n) from (select geo_check_status, count(*) n from v group by 1) t), '{}'::jsonb),
    'typologies', coalesce((select jsonb_agg(jsonb_build_object('letter', typology_letter, 'name', typology_name, 'n', n)
                                             order by typology_letter nulls last, typology_name)
                              from (select typology_letter, typology_name, count(*) n from v group by 1, 2) t), '[]'::jsonb),
    'statuses',   coalesce((select jsonb_agg(jsonb_build_object('value', status_declared, 'n', n) order by n desc)
                              from (select status_declared, count(*) n from v group by 1) t), '[]'::jsonb),
    'year_min',   (select min(extract(year from submitted_at))::int from v),
    'year_max',   (select max(extract(year from submitted_at))::int from v)
  );
$$;

-- -----------------------------------------------------------------------------
-- Ficha de un expediente: campos tal como los informa el servicio + de qué captura salió + revisiones.
-- Devuelve NULL si no hay un proyecto VIGENTE con esa fuente y expediente.
-- -----------------------------------------------------------------------------
create or replace function public.get_seia_project(p_source_key text, p_external_id text)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'project', jsonb_build_object(
      'id', p.id, 'source_key', d.source_key, 'kind', upper(right(d.source_key, 3)),
      'external_id', p.external_id, 'name', p.name,
      'submission_form_declared', p.submission_form_declared,
      'typology_letter', p.typology_letter, 'typology_name', p.typology_name,
      'region_declared', p.region_declared, 'comunas_declared', p.comunas_declared,
      'comuna_cuts', to_jsonb(p.comuna_cuts), 'comunas_unresolved', to_jsonb(p.comunas_unresolved),
      'titular', p.titular, 'status_declared', p.status_declared,
      'submitted_at', p.submitted_at, 'qualified_at', p.qualified_at, 'investment_usd', p.investment_usd,
      'expediente_url', p.expediente_url,
      'lon', case when p.geom is not null then ST_X(p.geom) end,
      'lat', case when p.geom is not null then ST_Y(p.geom) end,
      'geo_check_status', coalesce(gc.status, 'pending'), 'geo_check_distance_m', gc.distance_m,
      'geo_check_detail', gc.detail),
    'raw', p.raw,
    'source', jsonb_build_object(
      'name', d.name, 'publisher', d.publisher, 'landing_url', d.landing_url, 'attribution', d.attribution,
      'verification_status', d.verification_status, 'scope_note', d.scope_note),
    'snapshot', jsonb_build_object(
      'id', s.id, 'origin_url', s.origin_url, 'captured_at', s.captured_at, 'declared_date', s.declared_date,
      'sha256', s.sha256),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
               'decision', g.decision, 'note', g.note, 'reviewed_at', g.reviewed_at, 'reviewed_by', g.reviewed_by,
               'proposed_lon', case when g.proposed_geom is not null then ST_X(g.proposed_geom) end,
               'proposed_lat', case when g.proposed_geom is not null then ST_Y(g.proposed_geom) end)
             order by g.reviewed_at desc, g.id desc)
        from public.seia_project_geo_reviews g
       where g.source_id = p.source_id and g.external_id = p.external_id), '[]'::jsonb))
    from public.seia_projects p
    join public.seia_current_snapshot cs on cs.snapshot_id = p.snapshot_id
    join public.data_sources d on d.id = p.source_id
    join public.source_snapshots s on s.id = p.snapshot_id
    left join public.seia_project_geo_checks gc on gc.project_id = p.id
   where d.source_key = p_source_key and p.external_id = p_external_id;
$$;

revoke all on function public.get_seia_projects(double precision, double precision, double precision, double precision,
                                                text[], text[], text[], int, int, boolean, int),
                       public.get_seia_facets(text[]), public.get_seia_project(text, text) from public, anon;
grant execute on function public.get_seia_projects(double precision, double precision, double precision, double precision,
                                                   text[], text[], text[], int, int, boolean, int),
                          public.get_seia_facets(text[]), public.get_seia_project(text, text) to authenticated;

insert into public._migration_log (sprint, notes) values ('seia_projects_read_v1', 'done');
