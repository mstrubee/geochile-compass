## Diagnóstico

El CSV exportado vino incompleto porque `exportFolderDataset.ts` ignora el **límite de 1000 filas por defecto** de Supabase / PostgREST.

Con la carpeta Autoplanet:
- 64 POIs con métricas × 89 períodos = **5.696 filas** en `poi_metrics`.
- El código actual hace `.in("poi_id", chunk)` con `chunk = 400 ids`, sin paginación interna.
- Resultado: cada query devuelve **máximo 1000 filas** y se descartan silenciosamente las restantes (~4.700 valores de ventas perdidos).

El mismo bug afecta potencialmente a `poi_attributes` (varios atributos por POI) y a `poi_features_cache` (varias filas por POI si hay múltiples isócronas / RM vs regiones), aunque ahí el volumen suele caber bajo 1000.

## Cambios

**Editar `src/services/exportFolderDataset.ts`:**

1. Agregar helper `fetchAllRows(table, columns, ids)` que para cada chunk de POIs pagine con `.range(from, from + PAGE - 1)` (PAGE = 1000) hasta que la query devuelva menos filas que el tamaño de página.
2. Reducir `CHUNK` a 200 ids por seguridad (URL más corta y menos páginas por chunk).
3. Reemplazar las tres llamadas (`poi_attributes`, `poi_features_cache`, `poi_metrics`) por la nueva versión paginada.
4. Agregar un `console.info` con el conteo final de filas leídas por tabla, para verificar en consola que se traen las 5.696 esperadas.
5. Mantener el toast de éxito existente (ya muestra `rows` y `columns`).

**Sin cambios** en SQL, RLS, tipos, ni en `Sidebar.tsx`. Sin nuevas dependencias.

## Verificación

Tras el fix, exportar la carpeta Autoplanet debería producir un CSV con:
- 68 filas (POIs activos de la carpeta).
- 64 de esas filas con valores no vacíos en columnas `ventas_2019-01` … `ventas_2026-04` (~88 columnas reales + 1 espuria del bug del parser que ya identificamos previamente).
