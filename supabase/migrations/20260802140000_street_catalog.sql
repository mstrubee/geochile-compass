-- Catálogo local de calles por comuna, usado por el AddressResolver (último
-- recurso de geocodificación: fuzzy matching contra las calles reales de la
-- comuna cuando el address-normalizer + Nominatim ya fallaron con todos los
-- candidatos). Se puebla una vez por comuna vía Overpass API (bulk query de
-- OpenStreetMap) y se reutiliza indefinidamente — las calles de una comuna
-- prácticamente no cambian, así que no tiene sentido volver a pedirle esto
-- a Overpass en cada dirección nueva que falle.
create table if not exists public.street_catalog (
  comuna text not null,
  calle text not null,
  source text not null default 'overpass',
  created_at timestamptz not null default now(),
  primary key (comuna, calle)
);

create index if not exists street_catalog_comuna_idx on public.street_catalog (comuna);

-- Registra que ya se intentó construir el catálogo de una comuna, aunque
-- Overpass no haya devuelto ninguna calle (comuna sin vías nombradas en
-- OSM) — evita volver a golpear Overpass por comunas ya intentadas.
create table if not exists public.street_catalog_status (
  comuna text primary key,
  street_count integer not null default 0,
  fetched_at timestamptz not null default now(),
  error text
);

alter table public.street_catalog enable row level security;
alter table public.street_catalog_status enable row level security;

drop policy if exists "street_catalog_admin_all" on public.street_catalog;
create policy "street_catalog_admin_all" on public.street_catalog
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists "street_catalog_status_admin_all" on public.street_catalog_status;
create policy "street_catalog_status_admin_all" on public.street_catalog_status
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

grant select, insert, update, delete on public.street_catalog to authenticated;
grant all on public.street_catalog to service_role;
grant select, insert, update, delete on public.street_catalog_status to authenticated;
grant all on public.street_catalog_status to service_role;
