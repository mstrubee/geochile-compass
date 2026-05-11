## Diagnóstico

Hay dos causas probables del comportamiento errático:

1. **Sync de POI con estado stale:** `syncDeltaImpl` usa `pois` y `trashedPois` capturados por closure. Durante bootstrap se hace `setPois(cached.pois)` y acto seguido se dispara `syncDelta()`, pero esa función puede seguir viendo `pois=[]`, generando logs como `server=8454 local=0` y refreshes innecesarios.
2. **Sidecar/árbol inestable:** la visibilidad de carpetas parte ocultando automáticamente todas las carpetas nuevas, y el árbol de carpetas POI arranca sólo con `__root__` expandido. Al llegar carpetas/POIs en fases distintas desde caché + backend, puede parecer que faltan POI o que el Sidecar “cambia solo”.

## Plan de implementación

### 1. Hacer el sync de POI independiente de closures stale
- Mantener refs sincronizadas para `pois` y `trashedPois`.
- Hacer que `syncDeltaImpl` lea siempre desde esas refs, no desde el render anterior.
- En bootstrap, después de hidratar caché, pasar explícitamente el snapshot cacheado al delta o refrescar desde el estado real.
- Ajustar la verificación de integridad para comparar contra el snapshot vigente y evitar falsos `local=0` / `local=500`.

### 2. Evitar refreshes completos falsos y carreras
- Cuando no hay cambios delta, verificar contra el estado actual real.
- Si un `fullRefresh` acaba de ocurrir, no disparar otro por un mismatch producido por estado transitorio.
- Mantener la serialización, pero simplificar el camino de bootstrap para que no mezcle caché vacío con estado ya cargado.

### 3. Corregir comportamiento visible de POI en mapa
- Cambiar el valor inicial de `hiddenPoiFolders` para que **no oculte carpetas por defecto**.
- Eliminar el efecto que auto-oculta carpetas nuevas al cargarse desde caché/backend.
- Mantener el control manual de visibilidad por carpeta: si el usuario desmarca una carpeta, se sigue ocultando esa rama.

### 4. Estabilizar el árbol POI del Sidecar
- Auto-expandir carpetas raíz cuando llegan por primera vez, sin cerrar manualmente las que el usuario ya abrió/cerró.
- Preservar `__root__` para “Sin carpeta”.
- Evitar que la llegada tardía de carpetas desde backend haga parecer que los POI desaparecen.

### 5. Verificación
- Revisar que los logs de integridad ya no muestren `server=8454 local=0` durante carga normal.
- Validar que el contador del Sidecar y los POI en mapa usen la lista completa (`pois`) sin límite artificial.
- Confirmar que el toggle “Mostrar en mapa” y los checkbox por carpeta sigan funcionando.