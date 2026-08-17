-- Castigo del formato Express, configurable por carpeta.
--
-- El formato Express vende menos que un local estándar. La superficie todavía
-- no es una variable del modelo, así que se corrige por fuera con un valor
-- fijo. Estaba escrito en el código como -20%; acá queda como definición
-- comercial, ajustable sin tocar la aplicación.

alter table public.analysis_settings
  add column if not exists express_adjust_pct numeric;

comment on column public.analysis_settings.express_adjust_pct is
  'Ajuste fijo (en %) que aplica el boton "Local Express" sobre la proyeccion de venta. Negativo = castigo. NULL = usar el valor por defecto de la app (-20).';
