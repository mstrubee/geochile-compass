-- Velocidades de desplazamiento para estimar el tiempo en auto a los locales
-- de la red desde una isócrona.
--
-- El ruteador entrega la distancia real por calle y cuánto de esa ruta es
-- autopista; el tiempo se calcula acá con estas velocidades en vez de con el
-- modelo del ruteador, que supone tránsito libre y queda optimista para una
-- decisión de inversión.

alter table public.analysis_settings
  add column if not exists drive_speed_urban_kmh numeric,
  add column if not exists drive_speed_highway_kmh numeric;

comment on column public.analysis_settings.drive_speed_urban_kmh is
  'Velocidad supuesta en zona urbana (km/h) para el tiempo en auto del informe. NULL = valor por defecto de la app.';
comment on column public.analysis_settings.drive_speed_highway_kmh is
  'Velocidad supuesta en autopista (km/h) para el tiempo en auto del informe. NULL = valor por defecto de la app.';
