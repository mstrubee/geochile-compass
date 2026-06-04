## Causa raíz

El GeoJSON contiene tokens `NaN` literales (no estándar JSON). Generado por Python con `json.dumps(..., allow_nan=True)`. `JSON.parse` los rechaza en todos los navegadores: `Unexpected identifier "NaN"`. La instrumentación del fix anterior confirma esto.

## Plan (A + B)

### A) Sanitización defensiva en cliente

Editar `src/components/map/CrimeLayer.tsx` → función `loadData`, justo antes del `JSON.parse(text)`:

```ts
// Sanitizar tokens no estándar (NaN, Infinity, -Infinity) → null
const safeText = text.replace(/\b(-?Infinity|NaN)\b/g, "null");
data = JSON.parse(safeText) as GeoJSON.FeatureCollection;
```

Cuesta ~50ms sobre 6MB, una sola vez por sesión (después queda en `_cache`). Esto blinda contra el archivo actual y cualquier regeneración descuidada futura.

### B) Limpiar el archivo en el bucket

1. Descargar el GeoJSON del bucket `geodata` a `/tmp/crime.geojson` vía `curl`.
2. Ejecutar script Python para reemplazar `NaN`/`Infinity`/`-Infinity` por `null` y validar con `json.loads` que el resultado es JSON estándar.
3. Re-subir a `geodata/crime_risk_chile.geojson` con `--data-binary` + service role key, `upsert: true`, content-type `application/json`.
4. Verificar con `curl | python -c "import json,sys; json.loads(sys.stdin.read())"` que la versión servida ya parsea limpio.

### Validación final

- `tsc --noEmit` pasa.
- En el preview, activar capa Riesgo Delictivo → consola muestra `✅ cargado desde https://tcmyidycqdrrtwuaovbk.supabase.co/...  — 346 comunas` y se ven los polígonos coloreados.

No se tocan otros archivos ni la migration del bucket.
