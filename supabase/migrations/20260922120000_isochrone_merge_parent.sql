-- Fusión de isócronas: una isócrona "hija" aporta su área a la "madre" para
-- el análisis (territorio, GSE, proyección de venta corren sobre la unión).
-- `on delete set null` en vez de cascade: borrar la madre no debe borrar las
-- hijas, solo las deja huérfanas (vuelven a ser isócronas independientes).
alter table saved_isochrones
  add column if not exists parent_isochrone_id uuid references saved_isochrones(id) on delete set null;

create index if not exists idx_saved_isochrones_parent
  on saved_isochrones(parent_isochrone_id)
  where parent_isochrone_id is not null;
