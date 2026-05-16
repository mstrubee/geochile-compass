## Plan

Unificar las "Capas personalizadas" (grupos territoriales + Parque automotor) con el estilo de las capas territoriales estándar (`LayerItem`): punto de color + nombre + contador + `IOSSwitch`. Se mantienen los íconos actuales (llave para grupos, auto para Parque automotor).

**Archivos**

1. `src/components/layout/Sidebar.tsx` — `ParqueLayerToggle`
   - Reemplazar `Checkbox` por `IOSSwitch`.
   - Layout idéntico a `LayerItem`: ícono `Car` (mantener) + label "Parque automotor" + contador (cuando esté disponible; por ahora omitirlo o mostrar "—") + `IOSSwitch` a la derecha.
   - Mantener clases (`mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 ...`).

2. `src/components/layout/TerritorialGroupsSection.tsx`
   - **Cabecera de grupo**: chevron de expand + ícono `Wrench` (mantener) + nombre + contador `visibleCount/total` + `IOSSwitch` (en vez de `Checkbox`). El switch refleja `allOn`; click alterna todas las sub-capas. El expand/collapse sigue accesible por clic en el área del nombre.
   - **Sub-capas**: punto de color + nombre + `feature_count` + `IOSSwitch` (en vez de `Checkbox`). Mismo layout que `LayerItem`.
   - Importar/usar el mismo `IOSSwitch` (lo movemos a un helper compartido o duplicamos la mini-implementación local).

3. Sin cambios en lógica de visibilidad, hooks, o backend.

**Resultado**: las filas de Capas personalizadas se ven idénticas a "Densidad población" y demás, pero conservan los íconos distintivos.