-- Caché de geocodificación (dirección de texto → lat/lng). Evita volver a
-- pagar/consultar el proveedor externo cuando la misma dirección aparece
-- de nuevo en una exportación futura (las sábanas de direcciones se repiten
-- mucho entre corridas mensuales).
create table if not exists public.geocode_cache (
  address_key text primary key, -- normalizado: lower/trim de "calle numero, comuna, chile"
  query_text text not null,      -- texto exacto enviado al geocodificador
  lat double precision,
  lng double precision,
  found boolean not null default false,
  confidence text,               -- exact/high/medium/low según el proveedor
  provider text not null default 'mapbox',
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.geocode_cache enable row level security;

drop policy if exists "geocode_cache_admin_all" on public.geocode_cache;
create policy "geocode_cache_admin_all" on public.geocode_cache
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

grant select, insert, update, delete on public.geocode_cache to authenticated;
grant all on public.geocode_cache to service_role;

drop trigger if exists update_geocode_cache_updated_at on public.geocode_cache;
create trigger update_geocode_cache_updated_at before update on public.geocode_cache
  for each row execute function public.update_updated_at_column();

-- Slot del secret en el panel admin "API Keys y Secrets".
insert into public.app_secrets (key, description) values
  ('MAPBOX_ACCESS_TOKEN', 'Token de Mapbox para geocodificar direcciones (calle+numero+comuna → lat/lng) — mapbox.com/account/access-tokens')
on conflict (key) do nothing;
