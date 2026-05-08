## Objetivo

Hacer que el panel "Análisis territorial" (`AnalysisPanel`) entregue una vista completa por banda de isócrona: cruce con GSE por manzana como fuente primaria de población y NSE, densidades extendidas, comparación contra promedios comunales/RM y un resumen narrativo generado automáticamente con Gemini (Lovable AI Gateway).

---

## 1. Cruce con GSE por manzana (fuente primaria)

**Archivos:** `src/utils/isochroneAnalysis.ts`, `src/hooks/useIsochroneAnalysis.ts`, `src/services/gseService.ts`, `src/components/panels/AnalysisPanel.tsx`.

- Nueva función `gseBreakdown(iso, gseFC)` en `isochroneAnalysis.ts` que recorre los polígonos GSE que intersectan la isócrona y, ponderando por área de intersección, calcula:
  - Distribución de población por clase GSE (ABC1/C1/C2/C3/D/E) y por quintil.
  - Promedios ponderados de `nse_score`, `educ`, `hacin`, `auto_score`.
  - Conteo de manzanas tocadas y `pop_estimada` (usando `nse_score`/densidad si la GSE no trae población; en caso contrario sumando con `share`).
- `useIsochroneAnalysis` carga GSE para el bbox de la isócrona vía `gseService.fetchGse` (zoom efectivo 13 para forzar mayor cobertura) en lugar de depender de la capa visible.
- Jerarquía de fuente para `pop`/`hh` en `computeIsochroneAnalysis`:
  1. GSE manzana si trae población (preferido).
  2. Manzanas Censo (lo actual).
  3. Prorrateo comunal (fallback).
- `IsochroneAnalysis.totals.source` agrega valor `"gse"`.

## 2. Densidades extendidas

En `isochroneAnalysis.ts` agregar a `totals` / nueva sección `density`:
- `popPerKm2`, `hhPerKm2`.
- `pointsPerKm2` total y por grupo territorial.
- `serviceCoverageIndex`: 0–100 normalizado por puntos/km² del área comparado con la mediana de las comunas cubiertas.
- En `AnalysisPanel`: fila adicional de Metric cards y barra horizontal con densidad por grupo.

## 3. Comparación vs. promedio comunal / RM

- Constantes RM (ingreso medio, NSE distrib., densidad) en `src/data/communes.ts` (o nuevo `src/data/rmAverages.ts`).
- En cada Metric card mostrar delta `±X%` vs. promedio ponderado de comunas cubiertas y vs. RM (chip pequeño bajo el valor, color verde/rojo).
- Nueva fila en tabla de comunas con "promedio cubierto".

## 4. Resumen narrativo con IA (Gemini, automático)

**Edge function:** `supabase/functions/isochrone-insights/index.ts` (nueva).
- Reusar patrón de `match-contracts` de LeaseFlow Pro: POST a `https://ai.gateway.lovable.dev/v1/chat/completions`, modelo `google/gemini-3-flash-preview`, header `Authorization: Bearer ${LOVABLE_API_KEY}`, manejo de 429/402.
- Recibe el objeto `IsochroneAnalysis` serializado + lista compacta de promedios RM. Devuelve `{ summary: string }` con 3–5 párrafos en markdown (perfil socioeconómico, fortalezas, alertas, recomendaciones).
- `verify_jwt = false` no requerido; mantener default y validar `auth.uid()` con el cliente Supabase para evitar abuso.

**Frontend:** nuevo hook `useIsochroneInsights(analysis)` que:
- Calcula clave de caché `isoId + bandMinutes + totals.source + pop` y guarda en `Map` en memoria.
- Dispara `supabase.functions.invoke("isochrone-insights", { body: payload })` automáticamente cuando el panel se abre y `analysis` está listo.
- Maneja loading/error/rate-limit con toasts consistentes (`Rate limits exceeded`, `Payment required`).

**UI en `AnalysisPanel`:** nueva sección "Resumen IA" arriba de "Capas territoriales" con skeleton mientras carga, render de markdown con `react-markdown` (ya instalado, si no se agrega), botón "Regenerar" para forzar refresh.

## 5. Export

- `exportCsv` y `exportJson` incluyen las nuevas secciones `gse`, `density`, `comparisons`, `aiSummary`.

---

## Detalles técnicos

- `react-markdown` se agrega solo si no está en `package.json`.
- No se modifica el modelo de datos en BD; toda la lógica de cruce vive en cliente y la edge function es stateless.
- Mantener todos los cálculos memoizados para no degradar performance al cambiar de banda.
- Los promedios RM se hardcodean a partir de `public/ine_communes.csv` (script `node scripts/build-rm-averages.mjs` opcional, o cálculo en build una vez).

## Fuera de alcance

- Cambios en el heatmap, en la carga de capas territoriales o en el modelo de la BD.
- Persistir resúmenes IA en Supabase (solo caché en memoria).
- Edición manual de los promedios RM por el usuario.
