# Arreglar el contador "Mostrar en mapa 0" y la activación de POIs en el mapa

## Diagnóstico

El elemento seleccionado (`Sidebar.tsx` línea 1754–1763) renderiza:

```tsx
<span className="font-mono text-[10px] text-text-muted">{savedPois.length}</span>
```

Con el lazy-load actual, `savedPois` arranca **vacío** hasta que el usuario abre una carpeta. Por eso el botón muestra siempre `0` aunque el usuario tenga miles de POIs en BD.

El conteo **real ya está disponible** en la prop `poiFolderCounts` (RPC `poi_counts_by_folder()` que se carga al montar el hook). El sidebar lo usa para los conteos por carpeta en `totalCounts` (línea 728), pero **no** para el botón maestro.

Sobre "no se muestran en mapa": el wiring ya es correcto — `handleHiddenPoiFoldersChange` (Index.tsx 319–345) detecta carpetas activadas, llama a `loadPoiFoldersOnce` y hace `setSavedPoisVisible(true)` automáticamente. Una vez corregido el contador, el usuario verá que al encender una carpeta el número sube y los markers aparecen. Si tras el fix algún caso sigue fallando, lo aislamos con un repro concreto.

## Cambios

### `src/components/layout/Sidebar.tsx` (única modificación)

1. Calcular un total derivado del RPC en lugar de `savedPois.length`:

   ```tsx
   const totalPoisServer = useMemo(() => {
     if (!poiFolderCounts || poiFolderCounts.size === 0) return savedPois.length;
     let n = 0;
     poiFolderCounts.forEach((v) => { n += v; });
     // Si hay mutaciones locales optimistas que aún no se reflejan en el RPC,
     // tomamos el mayor de los dos para no parpadear hacia abajo.
     return Math.max(n, savedPois.length);
   }, [poiFolderCounts, savedPois.length]);
   ```

2. Reemplazar línea 1761:

   ```tsx
   <span className="font-mono text-[10px] text-text-muted">{totalPoisServer}</span>
   ```

## Verificación

1. Recargar app sin abrir ninguna carpeta → el botón "Mostrar en mapa" muestra el total real (ej. `6391`), no `0`.
2. Network: solo `poi_counts_by_folder` se dispara al inicio, no `/pois`.
3. Activar una carpeta → markers aparecen en el mapa (ya funciona vía auto-enable de `savedPoisVisible`); contador del botón se mantiene correcto.
4. Crear/borrar un POI → `loadFolderCounts()` se reejecuta en `trackMutation.finally` y el total se actualiza.
