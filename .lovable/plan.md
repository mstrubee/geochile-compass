## Problema

Actualmente, al activar "Mapa de calor", el heatmap se dibuja **encima** de los puntos individuales en lugar de reemplazarlos. Los círculos de las capas siguen visibles bajo el heatmap.

## Solución

En `src/components/map/TerritorialLayersLayer.tsx`, cuando `heatmap` está activo:

1. **No renderizar** los `circleMarker` / `geoJSON` por feature (saltar el bloque que crea `groupsRef` cuando `heatmap === true`).
2. **Limpiar** los `LayerGroup` existentes al activar heatmap, para que los puntos previos desaparezcan.
3. Al desactivar heatmap, el efecto existente vuelve a poblar los grupos normalmente.

Cambio mínimo: dentro del `useEffect` que crea los grupos por capa, añadir un early-return cuando `heatmap === true` (después de remover los grupos existentes), y agregar `heatmap` a las dependencias del efecto.

No se tocan UI, estilos, ni la lógica del heatmap (que ya funciona).

### Archivos a modificar

- `src/components/map/TerritorialLayersLayer.tsx` (un solo `useEffect`)
