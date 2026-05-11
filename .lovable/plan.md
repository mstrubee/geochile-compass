## Objetivo

Agregar al menú contextual (click derecho) de cada carpeta POI en el Sidebar la opción **"Exportar dataset (CSV)…"**, que descarga en un único archivo los POIs de esa carpeta con sus features territoriales y sus métricas de ventas — equivalente a lo que hoy se hace manualmente entrando al backend.

## Comportamiento esperado

1. Click derecho sobre una carpeta POI → nuevo ítem "Exportar dataset (CSV)…" (justo debajo de "Guardar como KMZ").
2. Al seleccionarlo:
   - Toast "Generando dataset…".
   - Lee desde el backend, sólo para los POIs activos de esa carpeta (incluyendo subcarpetas):
     - `pois`: id, name, lat, lng, address (de `properties`), folder path.
     - `poi_attributes`: pares `attr_key → attr_value` (estáticos).
     - `poi_features_cache.features`: un campo por feature (`pop_total`, `income_avg`, `nse_low_pct`, `traffic_idx`, etc.).
     - `poi_metrics`: una columna por `metric_key + período` en formato `ventas_YYYY-MM`.
   - Construye CSV en formato **wide** (una fila por POI) con columnas en orden estable:
     1. `poi_id, name, folder, lat, lng, address`
     2. atributos estáticos del schema (orden de `static_columns`)
     3. features (`feat_*`) en orden alfabético
     4. métricas por período (`<metric_key>_<YYYY-MM>`) ordenadas cronológicamente
   - Descarga el archivo: `dataset_<folder-slug>_<YYYYMMDD>.csv`.
3. Toast de éxito con número de POIs y columnas exportadas, o de error si falla.

## Cambios técnicos

- **Nuevo:** `src/services/exportFolderDataset.ts`
  - `exportFolderDataset(folder, allFolders, allPois, schema?)` 
  - Recorre subcarpetas con `descendantsOfFolder` (igual que ya hace `exportFolderAsKmz`).
  - Hace tres queries paginadas (`poi_attributes`, `poi_features_cache`, `poi_metrics`) filtradas por `poi_id IN (...)` (en lotes de ~500 ids para no exceder URL).
  - Pivot en memoria.
  - Escapa CSV correctamente (comillas, comas, saltos de línea, BOM UTF-8 para Excel).
  - Usa `URL.createObjectURL` + `<a download>` para disparar descarga.

- **Editado:** `src/components/layout/Sidebar.tsx`
  - Inmediatamente después del `ContextMenuItem` de "Guardar como KMZ" (línea ~1942), agregar nuevo `ContextMenuItem` "Exportar dataset (CSV)…" con icono `FileDown` (ya hay `Download`/`FileText` importados; reutilizar `FileText`).
  - Llama a `exportFolderDataset(f, poiFolders, savedPois, poiFolderSchemas.find(s => s.folder_id === f.id))`.

## Notas

- No requiere migraciones SQL ni cambios de RLS: las tablas `poi_features_cache`, `poi_metrics`, `poi_attributes` ya son legibles para usuarios autenticados.
- Sin dependencias nuevas (CSV armado a mano).
- Disponible para todos los usuarios (no se restringe a admin), ya que la idea es facilitar la descarga del dataset cuando exista. Si una carpeta no tiene features/metrics, el CSV igual incluye los POIs con las columnas presentes.
