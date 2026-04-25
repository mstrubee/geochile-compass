## 1. Mantener destacada la comuna al hacer hover

**Archivo:** `src/components/map/ChileCommunesLayer.tsx`

Hoy el `mouseover` aplica un estilo más grueso/iluminado y el `mouseout` lo revierte inmediatamente con `resetStyle`. Vamos a sostener el destacado:

- Guardar en un `useRef<Layer | null>` la última comuna *hovered* (`hoveredLayerRef`).
- En `mouseover`: si hay un layer previo distinto, llamar `geoJsonRef.current.resetStyle(prev)` y luego destacar el nuevo (mismo estilo actual: `weight: 2`, `color: hsl(199 89% 70%)`, `fillOpacity: 0.75`, `bringToFront()`). Guardar el nuevo en el ref.
- Eliminar el `mouseout` que resetea (o dejarlo solo para hacer `bringToBack` opcional, pero NO para revertir estilo).
- Cuando el mouse entre a otra comuna, la anterior se "des-destaca" automáticamente (sólo una a la vez).
- Al cambiar la `variable` (efecto que llama `setStyle(styleForFeature)`), también limpiar el ref para evitar que quede una comuna con estilo viejo.

Resultado: la última comuna sobre la que pasaste el mouse queda resaltada hasta que pases sobre otra.

## 2. Buscar por nombre debe centrar el PERÍMETRO, no abrir el popup demográfico

**Archivo:** `src/pages/Index.tsx` — función `handleFlyToCommune`

Cambios:
- **No** llamar `setPopupCommune(c.name)` (eso es lo que abre el "globo con la demografía").
- En lugar de `setFlyTarget({ ..., bbox: null })` (que hace zoom a un punto), calcular el bbox real del perímetro de la comuna usando el feature de `useComunasGeoIndex` y pasarlo como `bbox: [south, north, west, east]` al `flyTarget`. `MapView` ya sabe hacer `fitBounds` cuando hay bbox.
- Mantener `setOutlinedCommuneNames([c.name])` y `setHighlightedCommuneName(c.name)` para que el `CommuneOutlineLayer` pinte el perímetro grueso naranja.

Para obtener el bbox del feature:
- Importar el hook `useComunasGeoIndex` en `Index.tsx` (ya se usa indirectamente) o exponer un helper `getBboxByName(name)` desde el hook que use `L.geoJSON(feature).getBounds()` y devuelva `[south, north, west, east]`.
- Preferiblemente añadir `getBboxByName` al hook (más limpio que importar leaflet en Index).

Resultado: al elegir una sugerencia o presionar Enter en el tab "Texto", el mapa hace zoom al perímetro exacto de la comuna y la dibuja resaltada, **sin** abrir el popup demográfico.

También actualizar el texto de ayuda en `CommuneSearch.tsx` línea 183:
`"Enter centra el mapa y abre la demografía."` → `"Enter centra el perímetro de la comuna."`

## 3. Lista acumulada de búsquedas por nombre debajo del input

**Archivo:** `src/components/layout/CommuneSearch.tsx` (tab "Texto") + `src/pages/Index.tsx`

Hoy al elegir una comuna en el tab "Texto" se vuela el mapa y se borra el input, pero no queda registro. Nueva UX:

**Estado nuevo en `CommuneSearch`** (tab Texto):
- `searchedList: Commune[]` — comunas buscadas en esta sesión, sin duplicados, orden de adición.

**Comportamiento:**
- `pickSuggestion(c)`:
  - Llama `onFlyToCommune(c)` (igual que hoy → centra perímetro, ver tarea #2).
  - Añade `c` a `searchedList` si no está ya.
  - Limpia el input.
- Renderizar debajo del input/sugerencias una sección "Comunas buscadas" con:
  - Cada comuna como un chip (similar al que ya existe en el tab Comparar) con su nombre y una `X` para quitarla individualmente.
  - Click en el chip → vuelve a centrar el perímetro de esa comuna (`onFlyToCommune`).
  - Botón "Limpiar" al final que vacía toda la lista.
- **Tecla ESC** sobre el input limpia toda la lista (`searchedList = []`) además de cerrar sugerencias. Añadir un caso `e.key === "Escape"` en `handleTextKey`.

**Sincronización con el mapa (perímetros):**
- Cuando `searchedList` cambia, hay que actualizar `outlinedCommuneNames` en `Index.tsx` para que TODOS los perímetros de la lista se dibujen, no sólo el último.
- Para eso, añadir una prop nueva al `CommuneSearch`: `onSearchedListChange: (list: Commune[]) => void`.
- En `Index.tsx`:
  - Nuevo estado `searchedCommunes: Commune[]` (espejo desde `CommuneSearch`).
  - Cuando cambia, hacer `setOutlinedCommuneNames(searchedCommunes.map(c => c.name))`.
  - `handleFlyToCommune` ya no fija `outlinedCommuneNames` directamente (lo gestiona `searchedCommunes` cuando viene del tab Texto). Pero sigue siendo usado por otros flujos (resultados de comparación, etc.), así que mantenemos el `setOutlinedCommuneNames([c.name])` solo cuando NO viene de la búsqueda. Solución simple: dejar `handleFlyToCommune` solo centrando + highlight, y mover el `setOutlinedCommuneNames` a los call sites que correspondan (búsqueda → lista; click en compare row → solo esa).

**Resultado:**
- El usuario busca "Maipú" → centra el perímetro, lo dibuja, y aparece chip "Maipú ✕" debajo.
- Busca "Las Condes" → centra "Las Condes", dibuja AMBOS perímetros, chips: "Maipú ✕" "Las Condes ✕".
- Click en chip "Maipú" → re-centra Maipú.
- Click en ✕ de un chip → quita esa comuna y su perímetro.
- Click en "Limpiar" o tecla ESC en el input → vacía todo y borra todos los perímetros.

## Archivos a editar

- `src/components/map/ChileCommunesLayer.tsx` — hover persistente
- `src/hooks/useComunasGeoIndex.ts` — nuevo helper `getBboxByName(name)`
- `src/pages/Index.tsx` — `handleFlyToCommune` (sin popup, con bbox real), nuevo estado `searchedCommunes` que alimenta `outlinedCommuneNames`
- `src/components/layout/CommuneSearch.tsx` — lista acumulada, chips, ESC, prop `onSearchedListChange`