## Objetivo

El mapa de calor debe reflejar la **densidad real considerando los grupos activos**: las zonas donde se concentran puntos de **varios grupos a la vez** deben aparecer más calientes que zonas con muchos puntos de un solo grupo.

## Comportamiento actual (problema)

Hoy, en `src/components/map/TerritorialLayersLayer.tsx`, todos los puntos visibles se vuelcan al heatmap con peso fijo `1`:

```ts
points.push([f.lat, f.lng, 1]);
```

Resultado: una zona con 50 puntos del mismo grupo se ve igual de "caliente" que una zona donde se cruzan 3 grupos distintos. No representa diversidad ni superposición.

## Comportamiento propuesto

Calcular un peso por punto que combine:

1. **Densidad local** del propio grupo (cuántos puntos del mismo grupo hay cerca).
2. **Diversidad de grupos** activos en esa zona (bonus por superposición).

### Algoritmo

1. Tomar todos los puntos visibles (igual que ahora).
2. Discretizar el espacio en una grilla (celdas ~ tamaño del `radius` del heatmap, en grados ≈ 0.002°, ajustable según zoom).
3. Para cada celda, contar:
   - `n_total`: total de puntos en la celda.
   - `n_groups`: cantidad de **grupos distintos activos** representados en la celda.
4. Peso por punto = `1 + (n_groups - 1) * BONUS` con `BONUS ≈ 0.75`.
   - 1 grupo presente → peso 1 (densidad normal).
   - 2 grupos → peso 1.75 por punto.
   - 3 grupos → peso 2.5, etc.
5. Pasar los puntos con su peso a `L.heatLayer`. Leaflet.heat ya suma pesos por radio, así que la densidad sigue contando, pero la superposición de grupos amplifica el calor.

### Detalle técnico

Cambios solo en `src/components/map/TerritorialLayersLayer.tsx`:

- Necesitamos `group_id` de cada feature. `useTerritorialFeatures` devuelve `f.layer_id`; mapear `layer_id → group_id` usando el prop `layers` (`TerritorialLayer.group_id`).
- Construir una `Map<cellKey, Set<groupId>>` y `Map<cellKey, number>` para conteo, en una sola pasada.
- Recorrer puntos otra vez aplicando el peso calculado.
- Mantener `gradient`, `radius`, `blur`, `minOpacity` actuales. Subir `max` implícito de leaflet.heat o pasar `max` explícito (ej. `max: 4`) para que el gradiente no se sature al primer grupo solapado.

No se tocan: lógica de visibilidad, checkbox del heatmap, render de marcadores individuales, ni otros archivos.

## Archivos afectados

- `src/components/map/TerritorialLayersLayer.tsx` (única edición).

## Fuera de alcance

- No se cambia el control del checkbox de heatmap.
- No se agrega un heatmap por grupo separado.
- No se introducen pesos configurables por usuario.
