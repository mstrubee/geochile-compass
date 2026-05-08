# Acelerar carga de capas territoriales

## Diagnóstico

- Hay ~46k features en total y una sola capa concentra 25k puntos.
- `useTerritorialFeatures` pagina secuencialmente de a 1000 filas con `.range()` haciendo N round-trips (≥25 para esa capa).
- En cada fetch trae `geometry` y `properties` aunque la mayoría sean puntos que sólo necesitan `lat/lng/name`.
- Cada vez que se activa/desactiva una capa, el hook re-pide TODOS los `layerIds` desde cero (no hay caché por capa).
- El heatmap y el render de markers se recalculan sobre el array completo en cada cambio.

## Cambios propuestos

### 1. `src/hooks/useTerritorialLayers.ts` — `useTerritorialFeatures`
- Cachear features por `layer_id` en un `Map` a nivel módulo (y/o `useRef`) para que activar/desactivar una capa ya cargada sea instantáneo.
- Pedir sólo las capas que faltan en caché (diff entre `layerIds` y claves cacheadas).
- Para cada capa faltante:
  - Primero leer `feature_count` desde `territorial_layers` (ya existe en `layers`) para saber cuántas páginas pedir.
  - Disparar las páginas en paralelo con `Promise.all` (chunks de 1000) en vez de secuencial.
  - Seleccionar columnas livianas: `id, layer_id, name, lat, lng` por defecto. Sólo traer `geometry` cuando la capa contenga features no-Point (heurística: si todos los registros tienen `lat/lng` no se necesita geometry). Como atajo seguro: traer `geometry` sólo si la capa tiene < N features (umbral configurable, ej. 2000) o si alguna fila no tiene `lat/lng`. Para capas grandes de puntos, omitir `geometry` y `properties` (no se usan en el render actual).
- Exponer estado `loading` por capa para que la UI pueda mostrar feedback (opcional, si encaja).

### 2. `src/components/map/TerritorialLayersLayer.tsx`
- Memoizar la grilla del heatmap por (set de `layerIds` visibles + cantidad de features) para evitar recomputar en renders no relacionados.
- Mantener el `LayerGroup` por `layer_id` y reusarlo cuando la capa ya estaba pintada (no remove+add si no cambió). Hoy se hace `old.remove()` y se reconstruye en cada cambio.
- Render incremental: cuando llega una capa nueva, sólo añadir su grupo; cuando se oculta, sólo remover el suyo.

### 3. (Opcional, si hace falta) índice DB
- Verificar que exista índice `territorial_features (layer_id)`. Si no, agregarlo en una migración para que las queries paginadas escaneen rápido.

## Fuera de alcance

- Cambiar el modelo de datos o mover a tiles vectoriales.
- Filtrado por viewport (bbox) — se puede evaluar después si 25k puntos siguen siendo pesados de pintar.
- Cambios al heatmap visual (colores, pesos, radios).

## Detalles técnicos

- Tamaño de página actual: 1000 (límite por defecto de Supabase). Mantener 1000 y paralelizar páginas calculando rangos `[0,999], [1000,1999], …` a partir de `feature_count`.
- Caché in-module: `const cache = new Map<string, TerritorialFeature[]>()` fuera del hook para sobrevivir a remounts dentro de la sesión.
- Invalidar caché cuando `useTerritorialLayers.refresh()` se llame (exponer un `clearTerritorialFeaturesCache()`).
