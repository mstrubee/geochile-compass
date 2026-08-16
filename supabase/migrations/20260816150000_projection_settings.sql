-- Ajustes de proyección recordados por isócrona guardada.
--
-- El ajuste manual, las tasas por año y la rampa son criterio del analista
-- sobre ESA ubicación: si se pierden al apagar la isócrona, hay que rehacerlos
-- de memoria cada vez.
--
-- NULL = valores por defecto (curva de maduración vigente, sin ajuste manual).

alter table public.saved_isochrones
  add column if not exists projection_settings jsonb;

comment on column public.saved_isochrones.projection_settings is
  'Ajustes de la proyeccion de venta hechos por el usuario (ajuste manual, tasas por anio, rampa). NULL = valores por defecto.';
