-- Rampa de maduración personalizable por carpeta.
--
-- Por defecto la curva se deriva de los locales de la red con apertura
-- observada. Esta columna permite al admin fijarla a mano cuando conoce mejor
-- el negocio que la muestra disponible (hoy son pocos locales con apertura
-- dentro de la ventana de datos).
--
-- Formato: fracciones del nivel EN RÉGIMEN por año de vida, empezando por el
-- año de apertura. Ej: [0.49, 0.63, 1] = abre al 49%, segundo año 63%, tercero
-- ya en régimen. NULL = derivar de los datos.

alter table public.analysis_settings
  add column if not exists maturation_ramp jsonb;

comment on column public.analysis_settings.maturation_ramp is
  'Rampa de maduracion personalizada: fracciones del nivel en regimen por anio de vida, ej [0.49,0.63,1]. NULL = derivar de los locales con apertura observada.';
