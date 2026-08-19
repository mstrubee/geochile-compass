-- Índice para el recorte por bbox de las features territoriales.
--
-- Los hooks de análisis pasaron a pedir solo las features dentro del bbox de la
-- isócrona (de 67.664 a ~1.000 por consulta). Con solo `idx_..._layer` eso
-- resolvía por índice de layer_id y filtraba lat/lng en memoria: 463 ms y
-- 24.258 filas descartadas para devolver 787, en UNA capa de 128.
--
-- El orden importa: layer_id primero porque es igualdad exacta, después lat/lng
-- que son rangos.
create index if not exists idx_territorial_features_layer_latlng
  on public.territorial_features (layer_id, lat, lng);
