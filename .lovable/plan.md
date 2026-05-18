## Diagnóstico

Los POIs desaparecen del sidebar después de "un rato" sin tocar nada. Recargar la página los recupera. La causa raíz está en el ciclo auth + bootstrap:

1. `useAuth` (`src/hooks/useAuth.tsx:38-43`) escucha `onAuthStateChange`. Supabase emite `TOKEN_REFRESHED` cada ~1 h y dispara `setUser(s?.user ?? null)` con un **nuevo objeto `User`** (referencia distinta, mismo `id`).
2. En `useSavedPois.ts:431-448` el effect de bootstrap depende de `[user, authLoading, loadFolderCounts]`. Como `user` cambió de referencia, el effect corre de nuevo y ejecuta:
   ```ts
   setPois([]); setTrashedPois([]);
   poisRef.current = []; trashedRef.current = [];
   lastSyncAtRef.current = null;
   ```
   → los POIs ya cargados de las carpetas abiertas desaparecen de la UI.
3. En `Index.tsx:388-399` `loadedPoiFolderIds` **no** se resetea, así que `loadPoiFoldersOnce` cree que las carpetas ya están cargadas y no vuelve a pedirlas. Sólo `loadFolderCounts` corre, por eso los contadores siguen bien pero las listas quedan vacías.
4. Recargar la página re-bootstrappea desde caché (IndexedDB) y todo vuelve.

Esto coincide con el síntoma "después de un rato" (≈ el intervalo de refresh de Supabase) y con que recargar lo arregla.

## Fix propuesto

### 1. `src/hooks/useSavedPois.ts` — no resetear si el `user.id` no cambió

En el effect de bootstrap (≈ línea 431-448), comparar contra `userIdRef.current`:

- Si `user?.id === userIdRef.current` → no tocar `pois`/`trashedPois`/`lastSyncAtRef`. Opcionalmente disparar un `void syncDelta()` para traer cambios remotos posteriores al refresh.
- Si cambió el `user.id` (login real, logout, switch de cuenta) → mantener el comportamiento actual de limpieza.
- Mismo criterio para el caso `!user`: sólo limpiar si antes había un user distinto.

### 2. `src/pages/Index.tsx` — resetear `loadedPoiFolderIds` cuando se limpia el estado

Para que, en un cambio real de usuario, las carpetas abiertas se vuelvan a pedir. Una forma simple: vaciar `loadedPoiFolderIds` cuando `user?.id` cambie. Esto evita futuras inconsistencias aunque el fix #1 ya cubre el caso TOKEN_REFRESHED.

### 3. (Opcional, defensivo) Cache anti-clear duplicado

En el effect de persistencia (`useSavedPois.ts:88-109`) ya hay guard contra escribir snapshot vacío encima del caché bueno. Con el fix #1 ya no se dispararía el setPois([]) espurio, pero el guard sigue siendo útil — no se toca.

## Verificación

- Cargar la app, abrir una o varias carpetas, ver POIs en sidebar.
- En DevTools, simular `TOKEN_REFRESHED` (o esperar ~1 h, o forzar `supabase.auth.refreshSession()` desde consola).
- Confirmar que los POIs visibles en el sidebar **no** desaparecen.
- Confirmar que login/logout real sigue limpiando el estado correctamente.

## Fuera de alcance

- No se toca el sync delta, el caché en IndexedDB, ni la lógica de mutaciones.
- No se cambia `useAuth` (su comportamiento de re-emitir el user en cada evento es estándar de Supabase y otros consumidores podrían depender de eso).
