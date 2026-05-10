## Causa raíz

En `supabase/functions/compute-performance-batch/index.ts`, la query a `poi_metrics` (líneas ~380-383) no pagina:

```ts
const { data: metricRows } = await supabase
  .from("poi_metrics")
  .select("poi_id, metric_key, period, value")
  .in("poi_id", poiIds);
```

Supabase aplica límite default de 1000 filas. Hay 5696 filas reales → 4696 se pierden. Como las filas se truncan en orden arbitrario del planner, la mayoría de los 64 POIs queda con <10 meses y son descartados del entrenamiento (regla `< 10 meses → drop`). Resultado: solo 10 POIs entrenan, R²=2%.

## Fix

Paginar la lectura de `poi_metrics` en chunks de 1000 hasta agotar resultados. Mismo patrón que ya usa `useSavedPois`.

```ts
const PAGE = 1000;
const metricRows: any[] = [];
let from = 0;
while (true) {
  const { data, error } = await supabase
    .from("poi_metrics")
    .select("poi_id, metric_key, period, value")
    .in("poi_id", poiIds)
    .order("period", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) throw error;
  if (!data || data.length === 0) break;
  metricRows.push(...data);
  if (data.length < PAGE) break;
  from += PAGE;
}
```

Defensivamente paginar también la lectura de `uf_values` por si crece (hoy son 90 filas, pero el patrón debe ser consistente).

Agregar al log de diagnóstico: `Filas métricas cargadas (paginado): N en M páginas` para confirmar que el fix funciona en la próxima corrida.

## Validación esperada después del fix

- "Filas métricas cargadas" debería pasar de 1000 → ~5696
- "POIs con < 10 meses de target" debería caer cerca de 0
- "POIs aptos para entrenamiento" debería subir a ~60+
- R² debería subir significativamente (escenario B real: si sigue bajo después de esto, ahí sí es señal de que los features territoriales no explican ventas de AutoPlanet y pasamos a análisis de residuos)

## Archivos

- `supabase/functions/compute-performance-batch/index.ts` — paginar lecturas y mejorar log

## Después del deploy

Re-correr el batch desde el panel y mandar el bloque "[performance-batch] Diagnóstico:" actualizado.
