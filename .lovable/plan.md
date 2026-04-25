## Objetivo

Cuando el usuario use cualquier flujo de búsqueda en el sidebar (Texto, Rango, Comparar), dibujar en el mapa el **perímetro real** de la(s) comuna(s) involucrada(s), tomado de `/comunas.geojson`. El resto de comunas no se dibuja.

## Cómo se logra el match nombre ↔ polígono

`COMMUNES` (en `src/data/communes.ts`) usa el nombre como id. El geojson trae `codigo_comuna` y se cruza con `/codigos_territoriales.csv` (col 4 = código, col 5 = nombre). Construiré un mapa **`nombreNormalizado → Feature`** reutilizando `normalizeCommuneName` (ya usado en `CommuneSearch.tsx`) para hacer el lookup robusto frente a tildes/mayúsculas.

## Cambios

### 1. Nuevo hook `src/hooks/useComunasGeoIndex.ts`
- Carga una sola vez (singleton con `useRef` a nivel módulo) `/comunas.geojson` y `/codigos_territoriales.csv`.
- Devuelve `{ getFeatureByName(name): Feature | null, ready: boolean }`.
- Reutiliza la lógica de fetch/parse que hoy vive en `ChileCommunesLayer.tsx` para no duplicar descargas (~11 MB).

### 2. Nuevo componente `src/components/map/CommuneOutlineLayer.tsx`
- Props: `names: string[]` (nombres de comunas a delinear) y `highlightName?: string | null`.
- Usa el hook anterior, mapea los `names` a sus features y los renderiza en un único `<GeoJSON />`.
- Estilo: borde teal grueso (`hsl(199 89% 60%)`, weight 2.5, fill transparente). El `highlightName` se dibuja con weight 4 + fill suave.
- Cuando `names` cambia, ajusta `map.fitBounds` al conjunto si son varias, o deja que el `flyTo` existente maneje el caso de una sola.

### 3. Estado global en `src/pages/Index.tsx`
Añadir:
```ts
const [outlinedCommunes, setOutlinedCommunes] = useState<string[]>([]);
const [highlightedCommune, setHighlightedCommune] = useState<string | null>(null);
```
Wiring:
- `handleFlyToCommune(c)` → `setOutlinedCommunes([c.name]); setHighlightedCommune(c.name);` (cubre tab Texto y clicks en diálogos de Rango/Comparar).
- En `CommuneSearchResultsDialog`, al abrirse con resultados de Rango → `setOutlinedCommunes(results.map(r => r.name))`. Al hacer click en una fila → además `setHighlightedCommune(name)`.
- En `CommuneCompareDialog` (lista del comparador) → `setOutlinedCommunes(compareList.map(c => c.name))` mientras esté abierto.
- Botón "Limpiar perímetros" sutil en el `CoordsBar` o un auto-clear al cerrar los diálogos (propongo auto-clear al cerrar resultados/compare; los del tab Texto persisten hasta el próximo fly-to).

### 4. `src/components/map/MapView.tsx`
Montar `<CommuneOutlineLayer names={outlinedCommunes} highlightName={highlightedCommune} />` por encima de los círculos de `CommuneLayer` y por debajo de `IsochroneLayer`.

### 5. Refactor menor en `ChileCommunesLayer.tsx`
Migrarlo a usar el mismo hook `useComunasGeoIndex` para evitar dos fetches del archivo de 11 MB cuando ambos elementos coexistan.

## Notas
- No se instalan dependencias.
- El geojson se descarga **solo cuando** el usuario dispara la primera búsqueda/fly-to o activa la capa "Comunas de Chile" (lo que ocurra primero), gracias al singleton perezoso.
- Si una comuna del listado `COMMUNES` no aparece en el geojson (mismatch de nombre), se loguea un `console.warn` con los no encontrados para depurar, pero no rompe el render.
