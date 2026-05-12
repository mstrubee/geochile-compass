# Corregir: las carpetas de POIs muestran "0" y los POIs no aparecen al activarlas

## Diagnóstico

Hay **dos** problemas encadenados causados por el lazy-load:

### 1. Conteo de POIs en sidebar = 0
En `Sidebar.tsx` (línea 723) `totalCounts` se calcula a partir del array `savedPois` que el padre pasa. Como con el lazy-load `savedPois` arranca vacío, **todas las carpetas muestran 0** y el usuario no sabe cuántos POIs tiene cada una. Tampoco se ve diferencia entre una carpeta vacía y una sin cargar.

### 2. Al activar la carpeta, los POIs no se pintan en el mapa
`SavedPoisLayer` recibe `visible={savedPoisVisible}`, que arranca en `false`. Aunque `loadPoiFoldersOnce` traiga los datos correctamente, el master toggle apagado bloquea el render.

## Cambios propuestos

### A. Conteos reales independientes de la carga (problema 1)

1. **Nueva función SQL `poi_counts_by_folder()`** (migration):
   ```sql
   create or replace function public.poi_counts_by_folder()
   returns table(folder_id uuid, cnt bigint)
   language sql stable security definer set search_path = public as $$
     select folder_id, count(*)::bigint
       from public.pois
      where user_id = auth.uid() and deleted_at is null
      group by folder_id;
   $$;
   ```
   Devuelve `(folder_id, cnt)` solo para el usuario autenticado. Filas con `folder_id IS NULL` representan los huérfanos.

2. **`useSavedPois.ts`**: nuevo estado `folderCounts: Map<string|null, number>` y un `loadFolderCounts()` que llama al RPC. Se invoca una vez al montar (después de auth listo). Es una sola query agregada — barata.

3. **`Index.tsx`**: pasa `folderCounts` al `Sidebar`.

4. **`Sidebar.tsx`**:
   - Nueva prop `folderCounts?: Map<string|null, number>`.
   - En `totalCounts`, si una carpeta aún no fue cargada (no está en `loadedPoiFolderIds`) **o** está oculta, usar el valor del servidor (`folderCounts`) en vez del derivado de `savedPois`. Si ya fue cargada, usar el array (refleja mutaciones locales).

### B. Auto-activar "Mostrar en mapa" al encender una carpeta (problema 2)

En `Index.tsx`, dentro de `handleHiddenPoiFoldersChange`: si hay carpetas recién activadas y `savedPoisVisible === false`, hacer `setSavedPoisVisible(true)`.

### C. Refrescar conteos tras mutaciones

Tras `addMany`, `removeMany`, `restore`, `purgePermanently`, `clearAll` y movimientos entre carpetas, llamar a `loadFolderCounts()` para mantener la UI sincronizada.

## Archivos a modificar

- **Nueva migration**: crear función `poi_counts_by_folder()`.
- `src/hooks/useSavedPois.ts` — añadir `folderCounts` + `loadFolderCounts` + refresco tras mutaciones.
- `src/pages/Index.tsx` — auto-enable `savedPoisVisible` + pasar `folderCounts` al sidebar.
- `src/components/layout/Sidebar.tsx` — aceptar `folderCounts` y usarlo cuando la carpeta no está cargada.

## Verificación

1. Reload: sidebar muestra el número real de POIs por carpeta (ej. "245") sin haber consultado a `/pois`. En Network solo se ve la llamada al RPC `poi_counts_by_folder`.
2. Activar una carpeta: se dispara `/pois?folder_id=in.(...)`, los markers aparecen en el mapa automáticamente (sin tocar el toggle global).
3. Crear/borrar un POI: el conteo de la carpeta se actualiza.
4. Apagar la carpeta: markers desaparecen, conteo sigue mostrándose correctamente.
