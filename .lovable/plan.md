## Diagnóstico

El archivo `mapa_talleres_tiendas 1.html` se subió y escaneó, pero el parser no detectó capas (`layers_summary: []`). Resultado: 0 capas y 0 puntos. El parser actual solo entiende KML embebido y arrays JS planos `{lat,lng}`, y tu HTML usa otro formato.

## Plan

Decidiste convertir a GeoJSON/KML antes de subir. Voy a:

1. **Mejorar el botón "HTML → GeoJSON"** ya existente en `/admin/capas`:
   - Hacerlo más robusto extendiendo `htmlToGeoJson` para también detectar:
     - GeoJSON embebido en `<script>` (busca `FeatureCollection` / `"type":"Feature"` y lo extrae).
     - Arrays de coordenadas en llamadas `L.marker([lat,lng])`, `L.polygon([...])`, `L.polyline([...])` de Leaflet.
     - JSON dentro de `<script type="application/json">`.
   - Si no detecta nada, mostrar un mensaje claro indicando que el HTML no es soportado.

2. **Mostrar resumen tras la conversión**: en lugar de descargar a ciegas, abrir un toast con el conteo por carpeta/capa y permitir descargar.

3. **Documentar el flujo en la UI**: agregar un texto corto debajo del botón aclarando "Si tu HTML no es reconocido al subirlo, conviértelo primero a GeoJSON con este botón y luego súbelo como GeoJSON."

## Fuera de alcance

- No tocaré la edge function `scan-territorial-html` (ya soporta GeoJSON nativo, que es el formato resultante).
- No borraré el archivo HTML actual ya subido (puedes eliminarlo manualmente si querés).
