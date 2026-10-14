-- =============================================================================
-- Árbol de capas — Fase 1, parte 3/3: columna PostGIS en territorial_features
-- =============================================================================
-- La geometría vive hoy en JSONB (`geometry`). Se agrega `geom` (PostGIS) con
-- índice GIST para poder filtrar por polígono/bbox en la base en vez de traer
-- las features al navegador. `geometry` NO se toca: sigue siendo la fuente y
-- todo el código actual lo sigue leyendo igual; `geom` es derivada y la
-- mantiene un trigger.
--
-- PostGIS 3.3.7 ya está instalado (esquema public). Al 2026-10-14 las 67.664
-- features son Point, así que el backfill es trivial.
-- =============================================================================

select pg_advisory_xact_lock(hashtext('layer_nodes_v1'));
set local statement_timeout = '5min';

insert into public._migration_log (sprint, notes) values ('layer_nodes_v1_geom', 'start');

create extension if not exists postgis;

alter table public.territorial_features
  add column if not exists geom geometry(Geometry, 4326);

-- GeoJSON (jsonb) -> geometry 2D válida, o NULL si no se puede interpretar.
--   ST_MakeValid : repara polígonos auto-intersectados, anillos sin cerrar, etc.
--   ST_Force2D   : la columna no admite Z/M (muchos KMZ de Google Earth traen altitud).
-- Nunca lanza: una geometría mala no debe impedir guardar la feature.
create or replace function public.geojson_to_geom(g jsonb)
returns geometry
language plpgsql immutable parallel safe set search_path = public as $$
begin
  if g is null or jsonb_typeof(g) <> 'object' then return null; end if;
  return ST_Force2D(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(g::text), 4326)));
exception when others then
  return null;
end $$;

-- Vía rápida para el caso casi universal (Point bien formado): sin bloque
-- EXCEPTION, o sea sin una subtransacción por fila. La función segura de arriba
-- abre una por llamada y 67 mil filas tardaban ~65 s, cerca del límite de 100 s
-- de la API de administración. Devuelve NULL para todo lo que no sea un Point
-- inequívoco; ahí manda la función segura. Las guardas van en un CASE para que
-- ningún cast se evalúe antes de comprobar el tipo; length(...) < 30 evita el
-- desborde de float8.
create or replace function public._geojson_point_fast(g jsonb)
returns geometry
language sql immutable parallel safe set search_path = public as $$
  select case
    when g ->> 'type' = 'Point'
     and jsonb_typeof(g -> 'coordinates') = 'array'
     and jsonb_array_length(g -> 'coordinates') >= 2
     and jsonb_typeof(g -> 'coordinates' -> 0) = 'number'
     and jsonb_typeof(g -> 'coordinates' -> 1) = 'number'
     and length(g -> 'coordinates' ->> 0) < 30
     and length(g -> 'coordinates' ->> 1) < 30
    then ST_SetSRID(ST_MakePoint((g -> 'coordinates' ->> 0)::float8, (g -> 'coordinates' ->> 1)::float8), 4326)
  end;
$$;

create or replace function public.territorial_features_set_geom()
returns trigger language plpgsql set search_path = public as $$
begin
  -- coalesce evalúa el segundo argumento solo si el primero es NULL
  new.geom := coalesce(public._geojson_point_fast(new.geometry), public.geojson_to_geom(new.geometry));
  return new;
end $$;

drop trigger if exists trg_territorial_features_set_geom on public.territorial_features;
create trigger trg_territorial_features_set_geom
  before insert or update of geometry on public.territorial_features
  for each row execute function public.territorial_features_set_geom();

-- Backfill: un solo UPDATE. Solo toca filas sin geom, así que re-ejecutarlo es
-- seguro. Cada UPDATE reescribe la fila entera (versión nueva + WAL), por eso no
-- se repite sin necesidad: la base de este proyecto tiene un disco chico.
update public.territorial_features
   set geom = coalesce(public._geojson_point_fast(geometry), public.geojson_to_geom(geometry))
 where geom is null;

-- Auditoría: ninguna feature con geometría JSON debe quedar sin geom.
do $$
declare v_null int; v_total int; v_bad_srid int;
begin
  select count(*) into v_total from public.territorial_features;
  select count(*) into v_null  from public.territorial_features where geom is null and geometry is not null;
  select count(*) into v_bad_srid from public.territorial_features where geom is not null and ST_SRID(geom) <> 4326;
  if v_null > 0 then
    raise exception 'Guardrail: % de % features quedaron sin geom (geometría ilegible)', v_null, v_total;
  end if;
  if v_bad_srid > 0 then
    raise exception 'Guardrail: % features con SRID distinto de 4326', v_bad_srid;
  end if;
end $$;

create index if not exists idx_territorial_features_geom
  on public.territorial_features using gist (geom);

revoke all on function public.geojson_to_geom(jsonb), public._geojson_point_fast(jsonb) from public, anon;
grant execute on function public.geojson_to_geom(jsonb), public._geojson_point_fast(jsonb) to authenticated, service_role;

insert into public._migration_log (sprint, notes) values ('layer_nodes_v1_geom', 'done');
