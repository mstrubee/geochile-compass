
## Plan: Búsqueda de comunas en el Sidebar

Agrego un buscador de comunas dentro del Sidebar con dos modos: **por texto** (centra mapa + abre popup) y **por rango/mínimo de población** (abre ventana con tabla, exportable y ordenable).

---

### 1. Nuevo componente `src/components/layout/CommuneSearch.tsx`

Bloque dentro del Sidebar con dos pestañas (Tabs) o dos secciones colapsables:

**Modo "Texto":**
- `Input` con autocompletado contra `COMMUNES` (match insensible a mayúsculas/acentos, reusando `normalizeKey` que ya existe en `communeDataService.ts` — lo exporto).
- Lista desplegable de hasta 8 sugerencias (estilo `Command` de cmdk, ya disponible en `src/components/ui/command.tsx`).
- Al hacer Enter o click en una sugerencia → llama callback `onFlyToCommune(commune)`.

**Modo "Rango de población":**
- Dos `Input type="number"`: "Mínimo" y "Máximo" (máximo opcional → solo mínimo).
- Botón "Buscar" → filtra `COMMUNES` por `pop >= min && (max == null || pop <= max)` y abre el dialog de resultados.

---

### 2. Nuevo componente `src/components/panels/CommuneSearchResultsDialog.tsx`

`Dialog` (shadcn) con tabla de resultados:

**Columnas:** Comuna, Población, Hogares, NSE (mostrado como etiqueta `ABC1/C2/C3/D/E` vía `NSE_LABELS`), Densidad, Área, Tráfico, Latitud.

**Ordenamiento:** Header de cada columna clickeable (toggle asc/desc). Además un selector dedicado:
- Norte → Sur (asc por `lat` descendente, ya que Chile va de norte=lat menos negativa a sur=más negativa) y Sur → Norte.
- Alfabético A–Z / Z–A.
- Por GSE (orden ABC1 → E o E → ABC1, mapeando vía `nse` numérico).
- Por cualquier criterio numérico asc/desc (click en header).

**Acciones:**
- Botón "Exportar a Excel" → reutiliza `xlsx` (ya instalado por `communeDataService`). Genera archivo con las mismas columnas que el export global pero solo de los resultados filtrados. Lo añado como helper `exportCommunesSubsetToExcel(rows, filename)` en `communeDataService.ts`.
- Click en una fila → cierra el dialog y centra el mapa en esa comuna (mismo flujo que el modo texto).

Notas:
- Si no hay resultados, mensaje vacío amable.
- Si una comuna no tiene datos demográficos (`pop === 0`), se muestra igual con guiones, pero se excluye automáticamente cuando el filtro mínimo > 0 (porque su `pop` es 0).

---

### 3. Integración en `src/components/layout/Sidebar.tsx`

- Importar `CommuneSearch` y montarlo arriba de la sección "Capas territoriales" (o dentro de una nueva `SidebarSection` titulada "Buscar comuna").
- Recibe dos props nuevas desde `Index.tsx`:
  - `onFlyToCommune(commune)` — para centrar y abrir popup.
  - `onOpenRangeResults(results)` — para abrir el dialog de rangos.

---

### 4. Cambios en `src/pages/Index.tsx`

- Estado nuevo: `rangeResults: Commune[] | null` y `rangeDialogOpen: boolean`.
- Estado nuevo: `popupCommune: string | null` (nombre de la comuna cuyo popup queremos abrir tras volar).
- Handler `handleFlyToCommune(c)`:
  1. Activa la capa `layers.communes = true` si está desactivada (para que el `CircleMarker` sea visible).
  2. `setFlyTarget({ id: Date.now(), lat: c.lat, lng: c.lng, bbox: null })` — reusa el mecanismo existente.
  3. `setPopupCommune(c.name)` — para que el `CommuneLayer` abra su popup.
- Pasa `popupCommune` (y un `onPopupOpened` para limpiarlo) al `MapView` → `CommuneLayer`.

---

### 5. Cambios en `src/components/map/CommuneLayer.tsx`

- Acepta props `openPopupFor?: string | null` y `onPopupOpened?: () => void`.
- Mantengo un `Map<string, L.CircleMarker>` con refs (vía `ref` callback en `CircleMarker`).
- `useEffect` que cuando `openPopupFor` cambia, llama `marker.openPopup()` sobre el ref correspondiente y luego invoca `onPopupOpened()` (con un pequeño `setTimeout` para asegurar que el `flyTo` ya posicionó el mapa, ~900 ms ya que el flyTo dura 0.8s).

---

### 6. Helper expuesto en `communeDataService.ts`

Agregar y exportar:
- `normalizeCommuneName(name)` — wrapper público de `normalizeKey` para usarlo desde el buscador.
- `exportCommunesSubsetToExcel(rows: Commune[], filename?: string)` — misma estructura que `exportCommunesToExcel` pero recibe el subset.

---

### Detalles UX
- El buscador está siempre visible, no requiere que la capa "Demografía comunal" esté activada — se activa automáticamente cuando seleccionas una comuna.
- El input de texto soporta navegación con flechas ↑↓ y Enter para seleccionar la sugerencia resaltada (gracias a `cmdk`).
- El dialog de resultados es responsivo, con scroll vertical si hay muchas comunas y muestra el conteo total ("123 comunas encontradas").

---

### Archivos a modificar / crear
- **Crear:** `src/components/layout/CommuneSearch.tsx`
- **Crear:** `src/components/panels/CommuneSearchResultsDialog.tsx`
- **Modificar:** `src/components/layout/Sidebar.tsx` (montar componente + 2 props)
- **Modificar:** `src/pages/Index.tsx` (estado + handlers + props al MapView)
- **Modificar:** `src/components/map/MapView.tsx` (pasar props al CommuneLayer)
- **Modificar:** `src/components/map/CommuneLayer.tsx` (refs + apertura programática de popup)
- **Modificar:** `src/services/communeDataService.ts` (exportar helpers)

Sin nuevas dependencias — `cmdk`, `xlsx`, `Dialog` y `Tabs` ya están instalados.
