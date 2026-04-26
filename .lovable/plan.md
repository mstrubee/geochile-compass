
## Resumen de cambios

Trabajaré sobre el árbol de POIs del **Sidebar** (`src/components/layout/Sidebar.tsx`), añadiré utilidades de export KMZ, un diálogo modal para crear POIs y extenderé `useSavedPois` con `addOne`. **No** se requieren cambios en la base de datos.

---

### 1. Visibilidad jerárquica del checkbox (padre-hijo, no hermanos)

**Problema actual** (`togglePoiFolderVisibility`, líneas 376-391): al ocultar/mostrar una carpeta sólo se propaga **hacia abajo** (descendientes). El checkbox del padre no refleja el estado de los hijos, y al encender un hijo el padre no se enciende.

**Comportamiento nuevo (estilo Google Earth):**
- Al **marcar** el checkbox de una subcarpeta → se quita la ocultación de **toda su cadena de ancestros** (padre, abuelo, etc.) hasta la raíz, **sin tocar a los hermanos**.
- Al **desmarcar** una subcarpeta → sólo se afecta esa rama (y sus descendientes), los ancestros se mantienen.
- El checkbox del padre se renderiza en **3 estados**:
  - `checked` → todos los descendientes visibles
  - `unchecked` → la carpeta está oculta
  - `indeterminate` → la carpeta visible pero hay descendientes ocultos (el componente `Checkbox` de Radix ya soporta `checked="indeterminate"`)

Implementación:
- Reescribir `togglePoiFolderVisibility(id)` para:
  1. Calcular descendientes (igual que hoy).
  2. Si `willShow`: quitar `id` y descendientes de `hidden`, **además** quitar todos los ancestros (subiendo por `parent_id` hasta `null`).
  3. Si `willHide`: añadir `id` y descendientes (no tocar ancestros).
- Añadir helper `computeFolderCheckState(id): "checked" | "unchecked" | "indeterminate"` basado en si la carpeta está en `hidden` y si algún descendiente lo está.
- Pasar `checked={state === "indeterminate" ? "indeterminate" : state === "checked"}` al `<Checkbox>` de cada carpeta (línea 1300).

---

### 2. Menú contextual de POI (clic derecho sobre un POI)

Hoy (líneas 1270-1278) sólo tiene **Cortar** y **Mover a papelera**. Lo extenderé a:

- **Copiar** → `setClipboard({ kind: "poi", id, name, mode: "copy" })` (extiendo el tipo del clipboard con `mode: "cut" | "copy"`).
- **Cortar** → ya existe (le añado `mode: "cut"`).
- **Pegar** → ya existe en el menú de carpetas; en el menú de POI permitiré pegar en la carpeta del POI clickeado. En `handlePaste`, si `mode === "copy"` y `kind === "poi"`, llamo `addOne` con los campos del POI original (lookup en `pois` por id) en lugar de `onMovePois`. Si `mode === "copy"` y `kind === "folder"`, mostraré toast “Copiar carpeta no disponible aún” (lo dejo fuera del scope para no inflar; o, alternativa, lo implemento recursivamente — ver pregunta abajo).
- **Cambiar nombre** → `window.prompt` + `update(id, { name })` del hook `useSavedPois`.
- **Guardar como KMZ** → genera y descarga un `.kmz` con un único Placemark (ver sección 4).

---

### 3. Menú contextual de carpeta (clic derecho sobre una carpeta)

Hoy tiene: Cortar, Pegar, Renombrar, Crear subcarpeta, Cargar KMZ, Subir un nivel, Mover a papelera. Añadiré:

- **Cambiar/Editar nombre** → ya existe ("Renombrar carpeta…", línea 1337). Confirmo que funciona; nada nuevo aquí salvo verificar el label.
- **Crear un POI…** → nueva opción. Abre un nuevo diálogo `CreatePoiDialog` con campos:
  - Nombre, descripción, color (paleta), categoría (texto libre), lat, lng (números editables; precarga el centro del mapa actual).
  - Al guardar: llama a `addOne(payload, folderId)` que añadiré al hook.
  - **Icono heredado de los hermanos**: en el `useMemo` del diálogo, calculo `siblingIcon` = el `icon` más frecuente entre `pois` con `folder_id === f.id` (y similarmente `siblingColor` como default). Se aplican como defaults editables.
- **Guardar como KMZ (con todo su contenido)** → genera un KMZ que contiene la carpeta + subcarpetas + POIs preservando el orden y la jerarquía (ver sección 4).

---

### 4. Export KMZ

Crearé `src/utils/kmzExport.ts` con:

- `poiToPlacemarkXml(poi)`: emite un `<Placemark>` con `<name>`, `<description>`, `<Point><coordinates>lng,lat</coordinates></Point>`, y `<Style>` con `<IconStyle><color>` derivado de `poi.color`.
- `folderToKmlXml(folder, allFolders, allPois)`: emite recursivamente `<Folder><name>...</name>` con subcarpetas y POIs anidados.
- `buildKmlDocument(rootContent, name)`: envuelve en el preámbulo `<?xml ...?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>...</Document></kml>`.
- `downloadKmz(filename, kmlString)`: usa `JSZip` (ya en deps) para crear `doc.kml` dentro del zip y dispara la descarga vía `URL.createObjectURL` + `<a download>`.

Funciones públicas:
- `exportPoiAsKmz(poi)` → un único Placemark.
- `exportFolderAsKmz(folder, folders, pois)` → árbol completo (sólo descendientes activos, ignorando `deleted_at`).

Escapo correctamente `&`, `<`, `>` en `name`/`description` con un helper `escapeXml`.

---

### 5. Diálogo nuevo: `src/components/panels/CreatePoiDialog.tsx`

Componente controlado por `open`/`onOpenChange`, recibe `folder`, `siblingIcon`, `siblingColor`, `defaultLatLng`, y `onCreate(payload)`.

- Usa los componentes `ui/dialog`, `ui/input`, `ui/label`, `ui/textarea`, `ui/button`.
- Validación: nombre requerido, lat/lng numéricos válidos.
- Al confirmar, llama `onCreate` y cierra.

En `Sidebar.tsx` añado el estado `createPoiTarget: PoiFolder | null` y renderizo el diálogo en el árbol.

---

### 6. Hook `useSavedPois`: añadir `addOne`

En `src/hooks/useSavedPois.ts`, añadir:
```ts
const addOne = useCallback(async (item: PoiInsert) => {
  return addMany([item], item.folder_id ?? null);
}, [addMany]);
```
Y exportarlo en el return. Lo cableo al `Sidebar` por una nueva prop opcional `onCreatePoi?: (payload: PoiInsert) => Promise<void>` que `Index.tsx` conecta.

---

### 7. Cableado en `src/pages/Index.tsx`

- Pasar `addOne` del hook como `onCreatePoi` al `<Sidebar>`.
- Pasar el centro actual del mapa (ya disponible en el state del Index) como `defaultLatLng` o exponerlo a través de una ref/callback `getMapCenter()`.

---

## Archivos a tocar

| Archivo | Cambio |
|---|---|
| `src/components/layout/Sidebar.tsx` | Visibilidad jerárquica + 3-state checkbox; menú contextual extendido (POI y carpeta); state para `CreatePoiDialog`; clipboard con `mode` |
| `src/hooks/useSavedPois.ts` | Añadir `addOne` |
| `src/utils/kmzExport.ts` | **Nuevo** — generación KML/KMZ y descarga |
| `src/components/panels/CreatePoiDialog.tsx` | **Nuevo** — modal de creación de POI |
| `src/pages/Index.tsx` | Cablear `onCreatePoi` y `getMapCenter` |

---

## Pregunta antes de implementar

**Copiar carpeta** (no estaba explícito en tu pedido, sí lo estaba para POI). ¿Quieres que **Copiar** del menú contextual de carpetas duplique recursivamente la carpeta + subcarpetas + POIs en el destino del Pegar? Si no lo confirmas, dejo Copiar sólo para POIs y la carpeta seguirá teniendo sólo Cortar (como hoy).
