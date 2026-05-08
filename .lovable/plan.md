# Mejorar conversión HTML (Leaflet/Folium) → GeoJSON

## Problema

El HTML original es un mapa **Leaflet** generado tipo Folium/branca. Los grupos que el usuario ve en el control de capas ("Zonas", "Tiendas Ap/Ag", "Talleres: Con Contacto (3079)", "Talleres: Actividad: …", etc.) están definidos así:

```js
var feature_group_abc = L.featureGroup({}).addTo(map);
var marker_xyz = L.marker([lat, lng], {...}).addTo(feature_group_abc);
var circle_marker_xyz = L.circleMarker([lat, lng], {...}).addTo(feature_group_abc);
var geo_json_xyz = L.geoJson({...}, {...}).addTo(feature_group_abc);

L.control.layers(
  { "cartodbpositron": tile_layer_xxx },
  {
    "Zonas": feature_group_abc,
    "Tiendas Ap/Ag": feature_group_def,
    "Talleres: Con Contacto (3079)": marker_cluster_ghi,
    ...
  }
).addTo(map);
```

El parser actual sólo reconoce KML `<Folder>/<Placemark>` o arrays JS `var x = [{lat,lng}]`. Como el HTML no contiene ninguno, cae al fallback de arrays JS, no encuentra grupos reales, y termina creando capas mal nombradas (nombres de variable) o vacías. Por eso la cobertura no coincide con lo que ves al abrir el HTML.

## Solución

Añadir un nuevo modo de parseo `parseLeafletHtml` que se ejecute **antes** del fallback de arrays JS, con esta lógica:

### 1. Mapear variable → nombre legible
Buscar el bloque `L.control.layers(base, overlays).addTo(...)` y construir un Map `varName → displayName` desde el segundo argumento (el objeto de overlays). Aceptar también el patrón Folium donde se crea el control y luego se hace `control.addOverlay(group, "Nombre")`.

### 2. Mapear variable → tipo de contenedor
Detectar declaraciones de:
- `var X = L.featureGroup(...)`
- `var X = L.layerGroup(...)`
- `var X = L.markerClusterGroup(...)` (plugin común en Folium)
- `var X = L.geoJson(data, opts)` cuando se usa directamente como overlay

Sólo nos interesan los que aparecen en el mapa de overlays.

### 3. Asociar cada feature a su grupo
Recorrer el HTML buscando todas las llamadas con `.addTo(<varName>)`:
- `L.marker([lat, lng], opts).addTo(group)` → Point
- `L.circleMarker([lat, lng], opts).addTo(group)` → Point (con properties.radius/color)
- `L.circle([lat, lng], {radius}).addTo(group)` → Point + properties.radius
- `L.polygon([[lat,lng],...]).addTo(group)` → Polygon
- `L.polyline([[lat,lng],...]).addTo(group)` → LineString
- `L.rectangle([[lat,lng],[lat,lng]]).addTo(group)` → Polygon
- `L.geoJson(<data>, opts).addTo(group)` → expandir cada feature del GeoJSON inline

### 4. GeoJSON inline
Para `L.geoJson(<json>, ...)`: localizar el primer argumento (objeto JSON balanceado por llaves) y parsearlo. Cada feature se inserta en el grupo correspondiente preservando geometry/properties.

### 5. Popups → nombre y propiedades
Capturar `.bindPopup("...")` o `.bindTooltip("...")` posterior a la creación del marker y usarlo como `name`/property `popup` cuando no haya nombre explícito.

### 6. Nombre de capa = displayName
La capa final usa el nombre del control de capas (ej. "Talleres: Con Contacto (3079)"). Si una variable no aparece en el control (caso raro), se omite o se usa el var name como fallback.

### 7. Orden de detección
```
parseSource(html):
  1. parseLeafletHtml(html)   ← nuevo, intenta primero
  2. si no encontró capas → parseKmlFolders(html)  (actual)
  3. si tampoco → parseJsArrays(html)             (actual fallback)
```

### 8. Robustez
- Coordenadas Leaflet son `[lat, lng]` (NO `[lng, lat]` como GeoJSON). Convertir correctamente al construir geometrías GeoJSON.
- Tolerar saltos de línea, comentarios y minificación parcial.
- Para encontrar el objeto pasado a `L.control.layers` y a `L.geoJson`, implementar un parser de llaves balanceadas que respete strings con comillas y escapes (regex puro no es suficiente).
- Limitar tamaño máximo del HTML procesado (ya hay archivos grandes; mantener streaming/chunks no es necesario, pero validar memoria).

## Archivos a modificar

- `supabase/functions/scan-territorial-html/index.ts` — añadir `parseLeafletHtml`, integrar en `parseSource`, exportar.
- `supabase/functions/ingest-territorial-html/index.ts` — replicar el cambio (o, mejor, factorizar el parser a un módulo compartido `supabase/functions/_shared/territorial-parser.ts` e importarlo en ambas).

## Verificación

1. Pedir al usuario el HTML de muestra (o usar uno ya almacenado en `territorial_source_files`) y re-escanearlo desde AdminCapas.
2. Confirmar que el resumen de capas (`layers_summary`) lista exactamente los grupos del control de capas con sus conteos (3079, 25045, 8114, 6735, 1252, 1107, 1018, etc.).
3. Tras ingestar, verificar en el mapa que cada grupo se enciende/apaga y muestra el polígono o los puntos correctos.
