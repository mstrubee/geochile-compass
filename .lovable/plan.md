## Resumen
Agregar a cada isócrona en la barra lateral dos acciones nuevas: **Análisis** (abre el panel de análisis) y **Guardar**, con un sistema de almacenamiento por carpetas (crear, renombrar, mover, eliminar) que recuerda el/los POI(s) usados como origen.

## UX

En cada fila de isócrona del Sidebar, junto a los íconos actuales (centrar/eliminar):

```
[●] Vehículo · 5/10′  [switch]  [📊 Análisis]  [💾 Guardar]  [🎯 Centrar]  [🗑]
```

- **Análisis** → abre el `AnalysisPanel` con esa isócrona seleccionada (ya existe la lógica, solo es un botón explícito).
- **Guardar** → abre un mini-diálogo para nombrar la isócrona y elegir carpeta destino (o crear una nueva).

Nueva sección colapsable en el sidebar **"Isócronas guardadas"** (similar a POIs guardados):
- Árbol de carpetas con drag & drop, clic derecho con: Renombrar, Eliminar, Nueva subcarpeta, Crear isócrona aquí.
- Cada isócrona guardada muestra: nombre, modo, minutos, switch de visibilidad, centrar, análisis, editar (nombre/carpeta), eliminar.
- Al activar la visibilidad → se re-dibuja en el mapa (mismas features GeoJSON que la original).
- Si la isócrona se generó desde un POI guardado, se enlaza al POI (clic → centra el POI).

## Cambios en código

### Backend (migración)
Dos tablas nuevas con RLS por `user_id`:

- **`isochrone_folders`**: `id, user_id, name, parent_id, color, created_at, updated_at, deleted_at`. Trigger anti-ciclo (mismo patrón que `poi_folders`).
- **`saved_isochrones`**: `id, user_id, folder_id, name, mode, minutes (int[]), center_lat, center_lng, color, features (jsonb GeoJSON), source_poi_id (uuid null), source_lat, source_lng, created_at, updated_at, deleted_at`.

Políticas RLS estándar (owner CRUD), trigger `update_updated_at_column`.

### Frontend
- `src/types/savedIsochrones.ts` — tipos `SavedIsochrone`, `IsochroneFolder`, payloads.
- `src/hooks/useSavedIsochrones.ts` — CRUD + caché offline (mismo patrón que `useSavedPois`/`poiCache`).
- `src/hooks/useIsochroneFolders.ts` — CRUD carpetas.
- `src/components/panels/SaveIsochroneDialog.tsx` — diálogo nombre + selector de carpeta + "nueva carpeta".
- `src/components/layout/Sidebar.tsx`:
  - Botones "Análisis" y "Guardar" en cada fila de isócrona activa (líneas ~1043-1081).
  - Nueva sección "Isócronas guardadas" con árbol y context-menu reutilizando estilos.
- `src/pages/Index.tsx`:
  - Wiring: `onOpenIsochroneAnalysis(id)`, `onSaveIsochrone(iso)`, props para guardadas.
  - Permitir cargar una `SavedIsochrone` al estado `isochrones` (visible) para renderizar en `IsochroneLayer` sin tocar la BD.

### Notas técnicas
- Las features GeoJSON se almacenan tal cual en `jsonb` (tamaño típico < 50 KB por isócrona).
- `source_poi_id` es opcional: la isócrona puede venir de un clic libre. Si viene de un POI, se guarda la referencia (sin FK estricta para tolerar POI eliminado).
- Reutilizar `AnalysisPanel` existente — el botón "Análisis" solo dispara `setSelectedIsoId(id); setPanelOpen(true)`.

## Fuera de alcance
- Compartir isócronas entre usuarios.
- Versionado/histórico.
- Recalcular automáticamente al cambiar el POI de origen.
