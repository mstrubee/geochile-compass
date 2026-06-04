## Problema

Los POIs no se renderizan porque hay un loop "Maximum update depth exceeded" originado en `useIsochroneInsights.ts:40` → disparado desde `AnalysisPanel.tsx:127`. El loop satura React y deja el mapa sin actualizar.

## Causa raíz

1. `useComunasGeoIndex` retorna en cada render un objeto nuevo (`{ ready, fc, nombresPorCodigo: index?.nombresPorCodigo ?? {}, getFeatureByName, ... }`). El `?? {}` y los helpers re-creados rompen referencia.
2. `useIsochroneAnalysis` usa `comunas` como dependencia del `useMemo` final → recomputa `analysis` con nueva referencia en cada render.
3. `useIsochroneInsights(analysis, open)` tiene `analysis` en sus deps de `useEffect`; con cada cambio dispara `setState({ summary:null, loading:false, error:null })` (objeto literal nuevo) → re-render → nuevo `analysis` → loop.

## Cambios

1. **`src/hooks/useComunasGeoIndex.ts`** — Estabilizar el objeto retornado con `useMemo` (y memoizar los helpers con `useCallback`) para que su identidad solo cambie cuando `index` cambia realmente.

2. **`src/hooks/useIsochroneInsights.ts`** — En el `useEffect` de reset (cuando `!enabled || !analysis`), evitar `setState` si el state ya está en su valor inicial (comparar campo a campo) para cortar el ciclo aunque haya churn arriba.

3. **`src/hooks/useIsochroneAnalysis.ts`** — Reducir el dep `comunas` a sus partes estables (`comunas.fc`, `comunas.nombresPorCodigo`) en lugar del objeto completo, ya que el resto son helpers no usados dentro del `useMemo`.

## Verificación

- Recargar la app y confirmar que ya no aparece el warning "Maximum update depth exceeded".
- Confirmar que los POIs guardados vuelven a renderizarse en el mapa.
- Abrir el panel de análisis sobre una isócrona para verificar que `useIsochroneInsights` sigue funcionando normalmente.
