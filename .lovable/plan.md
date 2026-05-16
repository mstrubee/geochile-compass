## Cambios solicitados

### 1. Ocultar la ventana de "Análisis territorial"
Archivo: `src/components/panels/AnalysisPanel.tsx` (+ `src/pages/Index.tsx`).
- El botón "X" del panel ya existe pero la ventana se vuelve a abrir automáticamente al seleccionar/crear isócrona. Hacer que `onClose` realmente persista el estado "cerrado": no reabrir el panel hasta que el usuario lo invoque explícitamente (botón flotante o doble-click sobre la isócrona en el sidebar).
- Verificar el flujo en `Index.tsx` que setea `panelOpen=true` y desacoplarlo de la selección de isócrona.

### 2. Mostrar parque + ranking de marcas en "Análisis territorial"
Archivo: `src/components/panels/AnalysisPanel.tsx`.
- Reutilizar el hook existente `useParqueIsochroneStats` (ya hecho para el `IsochroneReportDialog`).
- Añadir una nueva sección "Parque automotor" dentro del panel lateral con:
  - KPIs: vehículos estimados, edad media, P25/P75.
  - Tabla Top 10 marcas (marca, count, %).
- Solo se renderiza si la capa "Parque automotor" está activa (`enabled` del hook).
- Pasar la feature de la banda activa (`isochrone.features[tab]`) al hook.

### 3. Permitir crear isócrona con el heatmap cargado
Archivo: `src/components/map/ParqueHeatmapLayer.tsx` (+ pasar prop desde `MapView.tsx` → `ParqueHeatmapHost`).
- Problema actual: los hexágonos GeoJSON capturan el click (popup) e impiden que el click llegue al mapa cuando `isoMode` está activo.
- Solución: aceptar prop `interactive` (derivada de `!isoMode`). Cuando `isoMode` esté activo:
  - Aplicar `interactive: false` en el style → los clicks pasan al mapa y se crea la isócrona normalmente.
  - No bindear popup/tooltip ni eventos hover.
- `MapView.tsx`: `ParqueHeatmapHost` recibe `isoMode` y se lo pasa al layer.

### 4. Información del heatmap solo con click derecho
Archivo: `src/components/map/ParqueHeatmapLayer.tsx`.
- Eliminar `bindTooltip` (sin preview al hover).
- Eliminar el highlight de contorno negro al `mouseover`.
- Reemplazar el `bindPopup` automático por un handler de `contextmenu`:
  - Al click derecho sobre un hexágono: `L.popup().setLatLng(e.latlng).setContent(popupHtml).openOn(map)`.
  - Usar `L.DomEvent.preventDefault(e.originalEvent)` para evitar el menú nativo del navegador.
- El contenido del popup (vehículos, edad P25/Med/P75, top marcas) se mantiene igual.

## Detalles técnicos

- El `ContextMenuHandler` global en `MapView.tsx` debe seguir funcionando: el contextmenu sobre un hex se consume en el layer (`L.DomEvent.stop`) para evitar disparar el menú del mapa.
- `interactive: false` se aplica vía la función `style` (Leaflet lo respeta dentro de `pathOptions`).
- Para #1, mantener el botón flotante (flecha) que abre el panel — solo cambiar el comportamiento de "cerrado" para que sea sticky por sesión.

## Fuera de alcance

- No tocar otras capas (manzanas, GSE, microzonas, POIs, comunas).
- No cambiar el formato del GeoJSON ni el script `inject-parque-features`.
- No modificar `IsochroneReportDialog` (ya tiene la sección de parque).
