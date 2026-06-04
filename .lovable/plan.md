## Cambios

**1. `src/components/map/CommercialHeatLayer.tsx`**
- Línea 106 y 112: castear `pts`/`RawPoint[]` a `L.HeatLatLngTuple[]` (leaflet.heat acepta `[lat,lng]` en runtime pero los types exigen el tercer elemento).

**2. `src/utils/gastoEndogeno.ts`**
- Mapear `NseLabel` (`"ABC1"|"C2"|"C3"|"D"|"E"`) a un score numérico (5..1) antes del promedio ponderado en `estimateDistByNse`.

**3. Migración SQL Gasto Endógeno**
- Esperar a que el usuario pegue el SQL y aplicarlo con la herramienta de migración (requiere aprobación).
