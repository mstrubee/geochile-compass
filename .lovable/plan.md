## Plan

1. **Eliminar el duplicado de capas personalizadas**
   - Quitar la sección/grupo de `Capas personalizadas` llamado **Parque Automotriz** del render del sidebar.
   - Mantener visible solo el toggle dedicado **Parque automotor** con ícono de auto.
   - No borrar nada todavía en la base: la query devolvió estos grupos:
     - `Parque Automotriz` (`4127272b-7ee0-4952-9e10-513d7421f1ed`)
     - `SERV. AUTOMOTRICES` (`ea9433a6-16a7-48d7-b0bf-443f684f233d`)

2. **Arreglar el estado del toggle “Parque automotor”**
   - Reemplazar `useParqueLayer` por un estado compartido vía `useSyncExternalStore`/evento global o contexto, porque hoy cada componente que llama al hook tiene su propio `useState` aislado.
   - Así el click en el sidebar actualizará inmediatamente al host del mapa que monta/desmonta `ParqueHeatmapLayer`.

3. **Hacer el desmontaje del heatmap robusto**
   - Mantener el enfoque imperativo con Leaflet, pero asegurar que al cambiar `visible=false` se remuevan todas las capas/canvas creadas por Parque Automotor.
   - Usar identificación propia de pane/canvas o clase CSS interna para limpiar cualquier remanente sin afectar otras capas del mapa.

4. **Validación**
   - Probar activar/desactivar varias veces desde el toggle dedicado.
   - Confirmar que el heatmap aparece al activar y desaparece inmediatamente al apagar, sin recargar.
   - Verificar que el grupo `Parque Automotriz` ya no aparece en `Capas personalizadas` y que no se toca `SERV. AUTOMOTRICES`.