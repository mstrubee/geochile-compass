# Sync de POIs robusto y confiable

## Diagnóstico

El delta sync funciona "la mayoría de las veces", pero tiene varios puntos donde puede dejar el caché desincronizado de forma silenciosa. Los identifiqué leyendo `useSavedPois.ts`:

1. **Límite duro de 5.000 filas en el delta** (`syncDelta` usa `.limit(5000)` sin paginar). Si en una sesión cambian más filas que eso, el resto se pierde hasta el siguiente full refresh (24 h).
2. **No hay detección de hard-deletes**. Si un POI se borra definitivamente desde otra sesión (purga manual o cron `purge_deleted_pois` a los 30 días), el caché local lo sigue mostrando indefinidamente.
3. **No hay verificación de integridad**. Nunca comparamos "cuántas filas tengo en caché" vs "cuántas hay en BD". Cualquier divergencia (página fallida, mutación perdida, race) queda invisible.
4. **Race conditions en mutaciones optimistas**. Varias mutaciones (`update`, `remove`, `restore`...) hacen `setPois(prev => { setTrashedPois(trash => { persistCache(...); ... }); ... })` — anidar setters provoca que React (en StrictMode o bajo concurrencia) ejecute el updater dos veces, escribiendo cachés inconsistentes.
5. **`syncDelta` puede pisar mutaciones recientes**. Si el usuario crea un POI mientras un `syncDelta` está en vuelo, el sync trae el POI desde BD y lo prepende, pero el `setPois` optimista del addMany pudo haber corrido entremedio → duplicados o pérdidas.
6. **El bootstrap dispara delta inmediatamente**. Si el cache tiene `lastSyncAt` corrupto (ej. en el futuro por reloj desincronizado), el delta nunca trae nada hasta el TTL.

Estos seis puntos juntos producen exactamente el comportamiento que describes: a veces faltan POIs, a veces aparecen al recargar, sin patrón claro.

## Estrategia

Pasamos de "delta optimista y rezamos" a **"delta + verificación de integridad ligera + auto-corrección"**:

1. **Integridad por conteo + checksum** después de cada delta. Si no coinciden con el servidor → fallback automático a fullRefresh, sin que el usuario tenga que hacer nada.
2. **Paginación del delta** (sin límite duro).
3. **Detectar hard-deletes** comparando IDs locales vs IDs presentes en BD (vía un endpoint liviano que solo trae `id`).
4. **Eliminar setters anidados** y mover toda la persistencia del caché a un `useEffect` que reacciona a cambios en `pois`/`trashedPois`. Una sola escritura por cambio, sin condiciones de carrera.
5. **Cola serializada de syncs**: si llega un `syncDelta` mientras hay otro en curso, encolar (no correr en paralelo). Mutaciones tienen prioridad y bloquean el siguiente sync hasta que terminen.

## Cambios concretos

### Backend (1 migración chica)

Crear función SQL `public.poi_sync_summary(p_user_id uuid)` que devuelve:
- `count` = nº de filas (activas + papelera) del usuario
- `max_updated_at` = mayor `updated_at` visible
- `checksum` = `md5(string_agg(id::text, ',' ORDER BY id))` truncado

Es una sola query barata (índice ya existe sobre `user_id`). La frontend la llama después de cada delta para verificar.

### Frontend

**`src/services/poiCache.ts`**
- Añadir `getCacheChecksum(pois, trashed)` que computa el mismo checksum (md5 de IDs ordenados) en cliente, para comparar contra el del servidor.

**`src/hooks/useSavedPois.ts`** — refactor de `syncDelta` y persistencia:

1. Reemplazar el `setPois(prev => { setTrashedPois(...) })` anidado por dos `setX` consecutivos + un `useEffect([pois, trashedPois, user])` que persiste al caché. Una sola fuente de escritura.
2. Paginar el delta con `range()` igual que `fullRefresh` (sin `limit(5000)`).
3. Después de aplicar el delta, llamar a `poi_sync_summary` y comparar:
   - Si `count` o `checksum` divergen → log + `fullRefresh()` automático.
   - Si coinciden → confirmar `lastSyncAt = max_updated_at` del servidor (no del cliente; evita drift de reloj).
4. Cola simple con `useRef<Promise|null>` para serializar syncs. Mutaciones setean un flag "dirty pending" para que el siguiente sync espere la confirmación de BD.
5. En el bootstrap, si `lastSyncAt > now()` (reloj raro) o si la diferencia de count caché vs servidor es > 0 → forzar fullRefresh.

**Lo que NO cambia**
- Estructura del caché en IndexedDB (mismas keys, retro-compatible).
- API pública del hook (`pois`, `trashedPois`, `refresh`, `forceFullRefresh`, mutaciones) — sin cambios para los consumidores.
- TTL de 24 h del caché — se mantiene como red de seguridad.

## Resultado esperado

- Carga inicial sigue siendo instantánea (lectura IndexedDB, < 200 ms).
- Después del delta hay 1 query extra (`poi_sync_summary`) súper barata; si todo coincide → listo.
- Si algo divergió (hard-delete remoto, mutación perdida, página fallida) → fullRefresh transparente, el usuario ve los datos correctos sin tener que hacer nada.
- Sin límites artificiales: maneja N POIs (paginación real).
- Sin race conditions de cache: una sola ruta de escritura.

## Notas técnicas

- El checksum es md5(IDs ordenados), no md5 del payload entero. Detecta inserciones/borrados pero no edits — eso ya lo cubre `max_updated_at`. Combinados detectan cualquier divergencia estructural.
- La función SQL es `STABLE SECURITY DEFINER` con filtro `WHERE user_id = auth.uid()` (no recibe el uid como parámetro, lo toma de `auth.uid()` para evitar suplantación).
- Si el usuario tiene 50.000 POIs, el checksum tarda < 50 ms en Postgres y la transferencia es 32 bytes. Escalable.
