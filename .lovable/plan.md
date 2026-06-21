## Problema

El cambio anterior creó un pane dedicado `savedPoisPane` con `zIndex: 650` para que los POIs guardados (incluido Autoplanet) quedaran sobre los POIs comerciales y capturaran el click. Tras ese cambio los markers dejaron de verse.

Causas probables del pane custom de Leaflet:
1. Los panes creados con `map.createPane()` heredan `pointer-events: none` de `.leaflet-pane`, por lo que el contenido no es visible/clickeable hasta que se fija explícitamente.
2. Los `L.circleMarker` necesitan un renderer (SVG/Canvas) en ese mismo pane; al pasar solo `pane:` sin renderer dedicado, en algunos casos no se dibuja el círculo.
3. Para `L.marker` con `iconUrl`, el icono se inserta en el pane indicado pero si el pane no tiene `pointer-events`/posicionamiento correctos no aparece encima del tile.

## Cambios

Archivo: `src/components/map/SavedPoisLayer.tsx`

1. Al crear el pane `savedPoisPane`, además de `zIndex = 650` fijar `pointerEvents = "auto"`.
2. Crear un renderer SVG anclado a ese pane y pasarlo explícitamente a los `L.circleMarker` (`renderer: svgRenderer`), manteniendo `pane: SAVED_POI_PANE` en `L.marker`.
3. Mantener el `stopPropagation` en el click para que, una vez encima de los comerciales, el evento no se propague.

## Verificación

- Recargar el preview y confirmar que los POIs de Autoplanet/Agroplanet se ven en el mapa.
- Click sobre un POI de Autoplanet abre `PoiDetailDialog` con ventas y atributos cargados.
- Los POIs comerciales detrás siguen renderizándose y no roban el click cuando hay un POI guardado encima.
