## Diagnóstico

La sesión de auth ahora funciona correctamente (`/token` 200, `/user` 200, JWT del usuario presente). El problema actual es distinto:

- El cliente está llamando `pois?updated_at=gt.1970-01-01T00:00:00.000Z&order=updated_at.asc&limit=250`.
- Postgres responde **500 con `57014: canceling statement due to statement timeout`**.
- `syncDeltaImpl` captura el error y aborta sin reintentar con `fullRefresh`.
- Resultado: estado queda en `[]` y la UI muestra “Aún no hay POIs”.

Causa raíz: `lastSyncAt` quedó persistido en caché como **epoch (1970)**. Esto ocurre porque cuando un `fullRefresh` corre en condiciones degradadas (sin sesión real, antes del fix de auth) y devuelve 0 filas con `summary` null, el código calcula:

```
stamp = summary?.max_updated_at ?? reduce(..., new Date(0).toISOString())
```

→ se guarda epoch como `lastSyncAt`. En el próximo arranque, `syncDelta` pide *todas* las filas del usuario ordenadas por `updated_at asc` (5.708 POIs con RLS), lo que excede el statement timeout del servidor.

Además, aunque `syncDelta` falle, no hay fallback a `fullRefresh`, así que la UI nunca recupera los datos.

## Plan

1. **No persistir nunca un `lastSyncAt` inválido**
   - En `fullRefreshImpl`, si `summary?.max_updated_at` es null y no hay filas reales, dejar `lastSyncAtRef.current = null` en lugar de epoch.
   - Esto evita que un arranque degradado contamine el caché para siempre.

2. **Sanitizar `lastSyncAt` al cargar caché**
   - En el bootstrap de `useSavedPois`, si `cached.lastSyncAt` es null, epoch (≤ año 2000), o muy antiguo (> 7 días), descartarlo y forzar `fullRefresh` en vez de `syncDelta`.
   - Tratamiento idéntico cuando el reloj está al futuro (ya existe).

3. **Fallback de `syncDelta` a `fullRefresh` ante errores de servidor**
   - Cuando el page query del delta devuelve error (timeout, 500, red), en vez de sólo loguear y volver, programar un `fullRefresh` (respetando el rate limit de 30s ya existente).
   - Así, aunque un delta grande falle, la UI converge en lugar de quedarse vacía.

4. **Acotar el tamaño del delta**
   - Si `since` corresponde a más de ~24h atrás, preferir directamente `fullRefresh` (paginado por `created_at desc` con índice natural) en vez de `syncDelta` (que ordena por `updated_at asc` sobre toda la historia del usuario).
   - Reduce drásticamente el riesgo de timeout cuando el caché quedó muy desactualizado.

5. **Reset puntual del `lastSyncAt` corrupto del usuario actual**
   - Como parte del fix, si al hidratar detectamos `lastSyncAt = epoch`, escribir null en el caché (`setLastSyncAt(uid, null)`) para sanear el storage local del usuario afectado en su próximo arranque.

## Verificación

- Tras el cambio, el primer arranque de un usuario con caché contaminado debe disparar `fullRefresh` y mostrar los 5.708 POIs sin pedir el delta epoch.
- Confirmar en network que ya no aparece `updated_at=gt.1970-...` y que los pages de `fullRefresh` (`order=created_at.desc`) responden 200.
- Confirmar que el contador del Sidecar refleja los POIs activos y que las carpetas siguen visibles.

## Detalles técnicos

- Archivo principal: `src/hooks/useSavedPois.ts` (bootstrap effect, `fullRefreshImpl`, `syncDeltaImpl`).
- Helper a usar de `src/services/poiCache.ts`: `setLastSyncAt(uid, null)` para limpiar el valor corrupto.
- No requiere cambios de SQL, RLS ni edge functions.
