## Aplicar el parser v2 de Claude

Claude entregó tres archivos: las dos implementaciones reescritas del parser (browser + edge function) y una suite de tests Deno. Todos resuelven los problemas pendientes:

- Patrón encadenado `L.marker(...).bindPopup(...).addTo(grupo)` (Folium clásico)
- Subgrupos transitivos `L.featureGroup.subGroup(parent, ...)` con resolución hasta el nombre visible
- Alias `var a = b;`
- `.addTo` separado en otra sentencia
- `ctrl.overlays = {...}`, `L.control.layers(base, overlays)`, `addOverlay(...)`
- Protección contra ciclos en el grafo de grupos
- Sólo emite features cuyo padre transitivamente sea un grupo real (markers añadidos directo al map se ignoran)

### Cambios a aplicar

1. **Reemplazar `src/utils/htmlToGeoJson.ts`** con la versión v2 de Claude (594 líneas). Mantiene la cadena de fallbacks 1→5 (KML folders, JS arrays, FC embebida, Leaflet agrupado, Leaflet genérico, `<script application/json>`), pero el bloque 4a usa el nuevo `parseLeafletGrouped` basado en índice de variables + resolución transitiva. Exporta el mismo `htmlToGeoJson` y `downloadGeoJson` — sin breaking changes para `AdminCapas.tsx`.

2. **Reemplazar `supabase/functions/_shared/territorial-parser.ts`** con la versión v2 de Claude (610 líneas). Mismo enfoque que el browser pero devuelve `ScannedLayer[]`. Mantiene exports `parseHtml`, `parseGeoJson`, `parseSource` — sin breaking changes para las edge functions `scan-territorial-html` e `ingest-territorial-html`.

3. **Crear `supabase/functions/_shared/territorial-parser.test.ts`** con la suite de tests Deno de Claude (177 líneas, 9 escenarios). Cubre los casos críticos: chained `.addTo`, subgrupos transitivos, 3 niveles anidados, `.addTo` separado, popup encadenado, alias, marker al map (skip), ciclos, `ctrl.overlays = {...}`.

4. **Verificación** — Ejecutar los tests con `supabase--test_edge_functions` apuntando al archivo nuevo. Los 9 deben pasar antes de dar por terminada la tarea. Si alguno falla reportamos el detalle antes de seguir.

### Detalles técnicos

El núcleo del v2 es:

```text
buildLfVarIndex(html)        → Map<var, {kind, ctor, firstArg, parentVar, aliasOf, popup}>
                                kind ∈ {geometry, group, alias, unknown}
buildLfOverlayMap(html)      → Map<groupVar, displayName>
resolveLfGroup(start, ...)   → recorre parentVar/aliasOf con seen-set hasta
                               encontrar overlay match; devuelve display + path + hasGroup
parseLeafletGrouped(html)    → para cada var con kind=geometry y parentVar,
                               resuelve grupo y emite Feature con groupPath en properties
```

Sin tocar `AdminCapas.tsx`, edge functions, ni nada de UI. Es un swap directo de internos.

### Archivos

- Editar: `src/utils/htmlToGeoJson.ts`
- Editar: `supabase/functions/_shared/territorial-parser.ts`
- Crear: `supabase/functions/_shared/territorial-parser.test.ts`
