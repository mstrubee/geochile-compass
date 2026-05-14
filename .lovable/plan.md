## Diagnóstico

El popup demográfico (Población, Hogares, Área, Densidad, NSE, Ingreso, Tráfico) lo dibuja `CommuneLayer.tsx` a partir de la lista hardcoded `COMMUNES` (`src/data/communes.ts`).

Esa lista contiene los 346 nombres de comunas de Chile, pero **solo las ~52 de la RM tienen datos reales**. Las 294 restantes están como placeholder (`pop: 0`, `nse: 3`, etc.). En el popup, la condición `hasData = c.pop > 0` cae al ramal "Sin datos demográficos detallados.", por eso fuera de la RM no se ve nada.

`ChileCommunesLayer` (la capa coroplética) ya lee correctamente el CSV INE para todas las comunas — el problema es solo el popup de los círculos.

Como el CSV `public/ine_communes.csv` ahora trae las 346 comunas con `poblacion`, `superficie_km2`, `ingreso_promedio` y `nse`, podemos hidratar el popup con esos datos.

## Cambios

### 1. `src/components/map/CommuneLayer.tsx`
- Cargar el índice INE con `loadIneIndex()` (mismo servicio que ya usa el resto de la app).
- Construir una lista enriquecida fusionando `COMMUNES` con `ine.byName` (clave: nombre normalizado):
  - `pop` → `ineStats.poblacion ?? c.pop`
  - `area` → `ineStats.superficie_km2 ?? c.area`
  - `density` → `ineStats.densidad ?? c.density`
  - `nse` → mapear etiqueta `"ABC1"|"C2"|"C3"|"D"|"E"` al numérico 1–5 si el original venía vacío
  - `hh` → si era 0, estimar `Math.round(pop / 3.3)` (tamaño hogar promedio Chile, INE)
  - `ingreso` → nuevo campo opcional `incomeOverride` para usar `ineStats.ingreso` directamente en el popup en vez de la tabla `NSE_INCOME` (que solo asocia rangos por NSE)
- En `CommunePopup`, sustituir `NSE_INCOME[c.nse]` por `c.incomeOverride ?? NSE_INCOME[c.nse]`.
- Para campos sin fuente (Tráfico fuera de la RM), mostrar `"—"` en lugar de `0/100`.
- `hasData` pasa a ser `c.pop > 0` igual que ahora — pero después del merge ya será verdadero para las 346.

### 2. `src/data/communes.ts`
- Añadir el campo opcional `incomeOverride?: number` a la interfaz `Commune` (no rompe nada).

### 3. (Opcional) Pequeño helper
Crear `src/data/communesEnriched.ts` o dejar el merge inline en `CommuneLayer` con `useMemo` + estado para esperar la carga asíncrona del CSV. Mientras carga (~50ms), seguir mostrando los datos hardcoded.

## Notas técnicas

- `loadIneIndex()` ya está en cache de módulo, así que el costo es nulo si otra capa lo cargó antes.
- El radio del círculo (`radiusForPop`) seguirá funcionando bien porque la población real es siempre > 0.
- No se toca la capa coroplética (`ChileCommunesLayer`), ni `gseService`, ni el script de manzanas.

## Verificación

1. Abrir el mapa, hacer zoom-out a Chile.
2. Click en un círculo de Arica, Concepción, Punta Arenas → debe mostrar Población, Área, Densidad, NSE e Ingreso del CSV.
3. Click en Las Condes/Vitacura → mismos datos, ahora con NSE corregido (ABC1) e ingreso real del CSV.
4. Confirmar que el popup ya no muestra "Sin datos demográficos detallados." en ninguna comuna.
