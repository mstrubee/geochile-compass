Plan para corregirlo:

1. Cambiar el parser Leaflet/Folium para que detecte capas por pertenencia real al control de capas, no por geometría.
   - Reconocer construcciones encadenadas típicas de Folium como `var marker_x = L.marker(...).addTo(feature_group_x)` y `var polygon_x = L.polygon(...).addTo(feature_group_x)`.
   - Seguir relaciones transitivas: marcador → cluster/subgrupo → feature group → overlay del control.
   - Resolver `L.control.layers(...)`, `.overlays = {...}` y `.addOverlay(...)` como fuente de nombres visibles.
   - Normalizar nombres visibles del control quitando HTML/entidades, para conservar nombres como `Zonas`, `Tiendas Ap/Ag`, `Talleres: Con Contacto`.

2. Sincronizar la corrección en ambos caminos de AdminCapas.
   - `supabase/functions/_shared/territorial-parser.ts`: usado por “Subir y analizar”, “Procesar” y “Reprocesar archivo”.
   - `src/utils/htmlToGeoJson.ts`: usado por el botón “HTML → GeoJSON”.
   - Evitar que el fallback genere `Markers`, `Polygons` o `Lines` cuando sí existen overlays reales aunque el formato use `.addTo(...)` encadenado.

3. Añadir verificación local con fixtures mínimos de Folium/Leaflet.
   - Caso con `feature_group_zonas`, `feature_group_tiendas`, `feature_group_talleres` en `L.control.layers`.
   - Caso con markers/polygons encadenados directamente.
   - Caso con marker cluster o subgrupo intermedio.
   - Confirmar que el resumen devuelva capas reales y no `Markers`/`Polygons`.

4. Desplegar la función de backend actualizada y validar el flujo.
   - Reescanear desde AdminCapas debe mostrar las capas reales del control.
   - Reprocesar debe crear/actualizar `territorial_layers.name` con esos nombres reales dentro del grupo destino seleccionado.