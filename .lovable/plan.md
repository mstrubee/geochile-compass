# Plan: Edición avanzada de POIs + creación desde el mapa

## 1. Reutilizar un único diálogo: `PoiEditorDialog`

Refactorizar `src/components/panels/CreatePoiDialog.tsx` → renombrarlo / generalizarlo a **`PoiEditorDialog.tsx`** con un prop `mode: "create" | "edit"`.

Campos que tendrá (en los tres flujos: crear desde carpeta, crear desde click derecho en mapa, editar POI existente):

- **Nombre** (obligatorio)
- **Descripción**
- **Categoría**
- **Color** (paleta + preview)
- **Icono** — texto/URL editable; **preview siempre visible** mostrando el marker tal y como se verá en el mapa (imagen si es URL/data:image, o círculo de color en caso contrario). Por defecto se hereda del icono predominante de los hermanos del folder destino.
- **Carpeta destino** — `Select` desplegable que lista todas las carpetas del usuario (jerárquico, ej: `Clientes / Santiago / Centro`) + opción "Sin carpeta". Al cambiar la carpeta, el icono/color heredados se recalculan en vivo a partir de los nuevos hermanos.
- **Latitud / Longitud** — inputs numéricos editables + botón **"Elegir en el mapa"** que cierra temporalmente el diálogo y activa un modo "picker" (el siguiente click en el mapa rellena lat/lng y reabre el diálogo).
- **Ventas** (`sales`, opcional) — input numérico con label "Ventas (opcional)". Se guarda dentro de `properties.sales` (number) ya que la columna `sales` no existe en BD y no añadiremos columnas nuevas para no romper migraciones.

Callbacks: `onSubmit(payload)` único; el padre decide si es insert o update.

## 2. Creación desde click derecho en el mapa

En `src/components/map/MapView.tsx`:

- Añadir prop `onMapContextMenu?: (c: { lat; lng }) => void`.
- Nuevo handler `ContextMenuHandler` con `useMapEvents({ contextmenu })` que llama al callback (con `L.DomEvent.preventDefault`).

En `src/pages/Index.tsx`:

- Estado `poiEditor: { mode: "create" | "edit"; defaultLat?; defaultLng?; defaultFolderId?; poi?: SavedPoi } | null`.
- `onMapContextMenu` → abre `PoiEditorDialog` en modo `create` con lat/lng del click y `folder_id = null` por defecto (el usuario elige la carpeta en el desplegable).
- Eliminar el `CreatePoiDialog` interno del Sidebar y centralizar el render de `PoiEditorDialog` en `Index.tsx`, controlado por `poiEditor`.
- El Sidebar dispara `onCreatePoiRequest(folder)` (abre editor en modo create con esa carpeta preseleccionada) y `onEditPoiRequest(poi)` (abre editor en modo edit).

## 3. Picker de coordenadas desde el editor

En `Index.tsx`:

- Estado `coordPickerActive: boolean`.
- Cuando el usuario pulsa **"Elegir en el mapa"** dentro del editor: el diálogo se cierra (sin perder los datos del formulario, que viven en `poiEditor.draft`), `coordPickerActive = true`, el cursor del mapa cambia (clase CSS `cursor-crosshair` en el contenedor) y se muestra un toast "Haz click en el mapa para fijar la posición".
- En `MapView`, mientras `coordPickerActive`, el siguiente `click` se redirige a `onPickCoord(lat, lng)`; el padre actualiza `poiEditor.draft.lat/lng` y reabre el diálogo.
- El picker funciona independiente del modo isócrona/microzona: si alguno está activo, el picker tiene prioridad mientras esté activo.

## 4. Editar POI existente (click derecho en POI del Sidebar)

- Añadir entrada **"Editar propiedades…"** en el `ContextMenuItem` del POI en `Sidebar.tsx` (junto a "Cambiar nombre").
- Llama a `onEditPoi(poi)` → `Index.tsx` abre `PoiEditorDialog` en modo `edit` con todos los valores precargados.
- Submit en modo edit: `updatePoi(poi.id, { name, description, category, color, folder_id })` + para icono y `properties.sales` necesitamos extender `PoiUpdate` y permitir update de esas columnas.

### Extensión mínima de tipos

En `src/types/pois.ts`:

```ts
export interface PoiUpdate {
  name?: string;
  description?: string | null;
  category?: string | null;
  color?: string | null;
  icon?: string | null;          // NUEVO
  folder_id?: string | null;
  properties?: Record<string, unknown>; // NUEVO (para guardar sales)
}
```

`useSavedPois.update` ya hace `supabase.from("pois").update(patch)`, soportará los nuevos campos sin cambios.

## 5. Preview de icono (componente reutilizable)

Nuevo `src/components/panels/PoiIconPreview.tsx`:

- Recibe `{ icon, color, size }`.
- Si `icon` es una URL/data:image válida → `<img>` 32×32 con la misma lógica `isImageUrl` que `SavedPoisLayer`.
- Si no → círculo SVG con `fill={color}` y borde blanco (como `circleMarker`).
- Se usa en `PoiEditorDialog` junto al campo de icono y junto al selector de color, actualizándose en vivo.

## 6. Herencia de icono al cambiar carpeta destino

Mover la lógica de "icono/color predominante de los hermanos" desde el Sidebar al **propio `PoiEditorDialog`**:

- `useMemo` que, dado `folder_id` actual del form + lista completa `savedPois`, calcula el icono y color más frecuentes entre los POIs con ese `folder_id`.
- Cuando el usuario cambia la carpeta en el desplegable y el campo `icon` aún tiene el valor heredado anterior (no fue tocado manualmente), se reemplaza por el nuevo heredado. Si el usuario lo editó manualmente, no se sobreescribe.
- Para esto, el diálogo recibe como props `allPois: SavedPoi[]` y `folders: PoiFolder[]`.

## 7. Cableado en `Index.tsx`

- Pasar `pois` y `folders` al nuevo `PoiEditorDialog`.
- `getMapCenter` se sigue usando como fallback (modo create sin click previo).
- Pasar `onMapContextMenu` y `onPickCoord` a `MapView`.
- Eliminar el render del antiguo `CreatePoiDialog` desde el Sidebar (línea ~1902 actual); el Sidebar solo emite `onCreatePoiRequest(folder)` y `onEditPoiRequest(poi)`.

## Archivos afectados

- ✏️ `src/components/panels/CreatePoiDialog.tsx` → rename/refactor a `PoiEditorDialog.tsx` (modo create/edit, selector de carpeta, ventas, preview, botón "Elegir en mapa")
- 🆕 `src/components/panels/PoiIconPreview.tsx`
- ✏️ `src/types/pois.ts` (ampliar `PoiUpdate` con `icon` y `properties`)
- ✏️ `src/components/map/MapView.tsx` (`contextmenu` + modo picker de coordenadas)
- ✏️ `src/pages/Index.tsx` (estado central del editor, picker, callbacks)
- ✏️ `src/components/layout/Sidebar.tsx` (quitar render local del diálogo, añadir "Editar propiedades…" en context menu de POI, delegar al padre)

## Notas

- **Ventas** se guarda en `properties.sales` (número). No requiere migración; si más adelante se quiere consultar agregadamente, se puede crear un índice `((properties->>'sales'))` en una migración futura.
- El `SavedPoisLayer` actualmente no muestra `properties` en el popup; opcionalmente se puede añadir una línea "Ventas: $X" cuando exista — lo incluyo como mejora menor en el mismo PR.
