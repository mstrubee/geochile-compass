-- Isócrona mayor para comunas pequeñas.
--
-- En comunas de baja población una isócrona corta captura muy poca gente, lo
-- que subestima el área de influencia real del local. Estas dos columnas
-- permiten configurar por carpeta un umbral de población y los minutos a usar
-- bajo ese umbral.
--
-- El default (umbral 0) deja la función desactivada, así que el comportamiento
-- existente no cambia hasta que alguien la configure.

alter table public.analysis_settings
  add column if not exists small_commune_pop_threshold integer not null default 0,
  add column if not exists iso_minutes_small_commune   integer not null default 10;

comment on column public.analysis_settings.small_commune_pop_threshold is
  'Comunas con poblacion <= a este valor usan iso_minutes_small_commune. 0 = desactivado.';
comment on column public.analysis_settings.iso_minutes_small_commune is
  'Minutos de isocrona para comunas bajo el umbral de poblacion.';
