# Acelerar carga de POIs con caché local cache-first

## Diagnóstico

Hoy `useSavedPois` ya hidrata desde IndexedDB al instante, pero **siempre** dispara después un `refresh()` que pagina toda la tabla `pois` desde Supabase (≈5.700 filas en chunks de 250 → ~23 requests + enriquecimiento pesado en background). Eso es lo que se siente lento: aunque el mapa se pinta rápido del caché, la app queda en "loading" y los siguientes renders se bloquean cuando llegan los datos frescos.

El objetivo es invertir la prioridad: **el caché local es la fuente de verdad para mostrar**, y Supabase solo se usa para sincronizar cambios (delta), no para recargar todo cada vez.

## Estrategia

1. **Cache-first real**: si hay snapshot local válido, lo usamos y NO disparamos refresh completo. La UI nunca espera a Supabase para mostrar POIs.
2. **Sincronización delta** en background, usando `updated_at` y `deleted_at`:
   - Traer solo filas con `updated_at > lastSyncAt` (incluye nuevas, editadas, y soft-deleted recientes).
   - Mergear contra el caché: insertar nuevas, actualizar existentes, mover a papelera las que tengan `deleted_at`.
   - Detectar borrados duros con un conteo + checksum liviano cada N min (opcional, fase 2).
3. **Trigger en BD** para que `updated_at` se actualice automáticamente en cada UPDATE (hoy solo tiene default `now()` en INSERT, sin trigger → un edit no la mueve, lo que rompería el delta).
4. **Sync manual**: botón/acción "Recargar desde servidor" que fuerza el refresh completo actual (mantenemos la lógica vieja como fallback explícito).
5. **TTL del caché**: si `cachedAt` tiene > 24h o cambió el `user.id`, hacer refresh completo automáticamente la primera vez.
6. **Mutaciones locales optimistas**: las mutaciones (`addMany`, `update`, `remove`, etc.) ya actualizan el state; ahora también deben escribir el caché inmediatamente y avanzar `lastSyncAt`, en vez de programar un `refresh()` paginado.

## Cambios concretos

### Backend (1 migración chica)
- Crear trigger `BEFORE UPDATE` en `public.pois` que setee `NEW.updated_at = now()`. Reusar `public.update_updated_at_column()` que ya existe.
- (Opcional) Mismo trigger en `poi_folders` para consistencia.

### Frontend
- `src/services/poiCache.ts`:
  - Guardar `lastSyncAt` (max `updated_at` visto) además de `cachedAt`.
  - API nueva: `getLastSyncAt(userId)`, `setLastSyncAt(userId, iso)`, `mergePoiDelta(userId, changes)`.
- `src/hooks/useSavedPois.ts`:
  - Reemplazar el `refresh()` automático tras hidratar caché por `syncDelta()`:
    - Si no hay caché → refresh completo (igual que hoy).
    - Si hay caché → `select * from pois where user_id = ? and updated_at > lastSyncAt` (sin paginar a menos que el delta sea grande), aplicar merge, actualizar `lastSyncAt`.
  - Borrar el enriquecimiento en background "siempre": ahora solo enriquecemos los IDs que vienen en el delta o que aún no tienen `properties`/`description` cargados.
  - Mutaciones (`addMany`, `update`, `remove`, `moveMany`, `restore`): ya hacen update optimista del state → además escribir caché en ese momento y NO encadenar un `refresh()` completo. Solo `purgePermanently` y `clearAll` siguen forzando refresh.
  - Exponer `forceFullRefresh()` para el botón manual.

### UI mínima
- En el panel de POIs (donde hoy aparece "Recargar"/loading), añadir botón "Sincronizar con servidor" que llama a `forceFullRefresh()`. Sin cambios visuales mayores.

## Resultado esperado

- Apertura de la app: POIs visibles en < 200 ms (lectura IndexedDB), sin esperar Supabase.
- Sincronización en background: 1 request en lugar de ~23, normalmente con 0–N filas.
- Edits/inserts/borrados: instantáneos, persistidos al caché en el mismo tick.
- Recarga manual disponible cuando el usuario sospeche desincronía.

## Notas técnicas

- El delta no detecta "hard deletes" hechos fuera de la app (solo soft-deletes vía `deleted_at`). Para POIs eso es ok porque la app usa soft-delete + purga programada. Si hace falta, una segunda fase puede comparar `count(*)` con el tamaño del caché y forzar refresh si difieren.
- Tamaño del caché en IndexedDB: ~5.700 POIs ligeros + heavies cabe sin problema (idb-keyval no tiene límite práctico para esto).
- Hay que invalidar el caché si el `user.id` cambia (logout/login con otro usuario): ya está cubierto porque la key incluye `userId`.
