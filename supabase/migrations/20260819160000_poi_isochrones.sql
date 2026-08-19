-- Isócrona persistida por local.
--
-- Hasta ahora la isócrona de cada local se pedía a ORS al vuelo, una por vez,
-- cada vez que se recalculaban las features con canibalización fina: N locales
-- × sus vecinos cercanos = varios minutos de proceso y cientos de llamadas
-- externas, con resultados que podían diferir entre corridas.
--
-- Persistirlas resuelve tres cosas de una sola vez:
--   · la canibalización pasa a ser una intersección de geometrías ya guardadas,
--   · el recálculo de features deja de depender de ORS y de su rate limit,
--   · la isócrona de un local se puede mostrar en el mapa a demanda.
--
-- La clave es (poi_id, mode, minutes): un local puede tener la de 5 y la de 7
-- minutos, que es justo lo que necesita una red con locales en RM y en regiones.

create table if not exists public.poi_isochrones (
  id           uuid primary key default gen_random_uuid(),
  poi_id       uuid not null references public.pois(id) on delete cascade,
  mode         text not null default 'driving-car',
  minutes      integer not null,
  geometry     jsonb not null,
  -- Coordenadas del local al momento de generarla: si el POI se mueve, la
  -- isócrona guardada dejó de corresponder y hay que regenerarla. Sin esto la
  -- caché quedaría silenciosamente equivocada.
  origin_lat   double precision not null,
  origin_lng   double precision not null,
  computed_at  timestamptz not null default now(),
  unique (poi_id, mode, minutes)
);

create index if not exists idx_poi_isochrones_poi on public.poi_isochrones (poi_id);
create index if not exists idx_poi_isochrones_lookup
  on public.poi_isochrones (mode, minutes);

alter table public.poi_isochrones enable row level security;

-- Mismo criterio que `pois`: son datos de la red, no de un usuario. Lectura
-- para cualquier autenticado; escritura solo admin, porque generarlas cuesta
-- llamadas a ORS y no debe poder dispararlas cualquiera.
create policy "Authenticated can read poi isochrones"
  on public.poi_isochrones for select
  to authenticated
  using (true);

create policy "Admins manage poi isochrones"
  on public.poi_isochrones for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

comment on table public.poi_isochrones is
  'Isócrona persistida por local, por (mode, minutes). Fuente para canibalización, recálculo de features y visualización a demanda. Regenerar si el POI cambia de coordenadas (ver origin_lat/origin_lng).';
