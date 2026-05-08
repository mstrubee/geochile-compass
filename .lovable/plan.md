## Análisis al crear una isócrona

Cuando se crea una isócrona, abrir/poblar el panel lateral derecho (`AnalysisPanel`) con datos calculados a partir del polígono de la isócrona seleccionada.

### Datos a mostrar

1. **Capas territoriales personalizadas**
   - Conteo total de puntos dentro del polígono.
   - Desglose por grupo territorial (Salud, Educación, etc.) y por capa.

2. **Demografía comunal**
   - Listado de comunas que intersectan la isócrona con porcentaje de área cubierta de cada una.
   - Población, densidad, ingreso promedio y NSE comunal (datos INE) por comuna.

3. **Habitantes y hogares estimados dentro de la isócrona**
   - Si hay manzanas (Censo / GSE) cubriendo la zona → suma directa de `pop` y `hh` de manzanas intersectadas (proporcional al área intersectada).
   - Fallback comuna: `pob_comuna * (area_iso ∩ area_comuna) / area_comuna` y hogares vía tamaño medio de hogar (pob/hogares comunal).

4. **Ingreso total de hogares dentro de la isócrona**
   - Para cada comuna intersectada: `hogares_estimados_en_iso * ingreso_promedio_comuna`.
   - Suma global + ingreso promedio ponderado por hogares.

### Arquitectura

```text
src/
  utils/
    isochroneAnalysis.ts         (NUEVO)  ← cálculo puro
  hooks/
    useIsochroneAnalysis.ts      (NUEVO)  ← orquesta inputs (manzanas, comunas, INE, capas territoriales)
  components/panels/
    AnalysisPanel.tsx            (REWRITE) recibe isócrona seleccionada + análisis
  pages/
    Index.tsx                    (EDIT)   selección de isócrona activa, abre panel al crear
```

### `utils/isochroneAnalysis.ts`

Funciones puras (ya tenemos `@turf/area`, `booleanIntersects`, `intersect` se añade vía `@turf/intersect` ya disponible en deps de turf):

- `countTerritorialPointsInPolygon(polygon, features, layers, groups)` → `{ total, byGroup: [{group, count, byLayer:[{layer,count}]}] }`
- `communeBreakdown(polygon, comunasFC, ineIndex)` → array `{ commune, areaShare, pop, hh, ingreso, nse, popInIso, hhInIso, incomeInIso }`
- `manzanaBreakdown(polygon, manzanaFC)` → `{ pop, hh, manzanaCount }` (reutiliza lógica existente de `computeMicrozoneStats`, agregando proporción de área intersectada).
- `aggregate(...)` → totales globales: población, hogares, ingreso total, ingreso promedio por hogar.

Estrategia de estimación:
- Preferir manzanas si cubren ≥X% del área de la isócrona; en zonas sin manzana usar fallback comunal proporcional.

### `hooks/useIsochroneAnalysis.ts`

Inputs:
- `isochrone: Isochrone | null` (toma la banda mayor: polígono más amplio)
- Datos ya cargados en `Index.tsx`: `manzanaData` (densidad), `userLayers` no aplica (estos son territoriales DB), `territorialFeatures` + `territorialLayers` + `territorialGroups` (vienen de `useTerritorialLayers` + visibilidad), `comunasGeoIndex` (`useComunasGeoIndex` con `ine`).

Output: `IsochroneAnalysis | null` memoizado.

### `AnalysisPanel.tsx`

Reescribir el contenido (mantener look & feel, header con tabs por banda de minutos):
- Tab por banda (5 / 7 / 10 min etc., dinámico desde `isochrone.minutes`).
- Tarjetas: Personas, Hogares, Ingreso total, Ingreso promedio/hogar, Área km², Densidad.
- Sección "Capas territoriales": lista por grupo con conteos.
- Sección "Comunas cubiertas": tabla con %, pob, NSE.
- Sección NSE: distribución ponderada (de manzanas si hay, si no comunal).
- Botones export CSV/JSON con datos reales.

### `Index.tsx`

- Estado nuevo `selectedIsochroneId`. Al crear isócrona (en handler existente) → setearla y abrir panel (`setPanelOpen(true)`).
- Pasar a `AnalysisPanel` la isócrona seleccionada y el análisis del hook.
- Permitir cambiar selección desde la sidebar (al click en una isócrona ya existente — usar el actual `setFitIsoId` también para seleccionar).

### Detalles técnicos

- Usar `@turf/intersect` para áreas comuna ∩ isócrona; degradar a `booleanIntersects` + área aproximada si falla.
- El hook dispara cálculo solo cuando cambia `selectedIsochroneId` o sus inputs principales (debounce no necesario).
- Manzanas: si no hay viewport cargado para la zona, mostrar aviso "Activa la capa de manzanas para mayor precisión" y usar fallback comunal.
- Exportar CSV/JSON: serializar el objeto `IsochroneAnalysis`.

### Fuera de alcance

- No se modifica el cálculo de la isócrona ni el edge function.
- No se persisten análisis en DB; son client-side.
