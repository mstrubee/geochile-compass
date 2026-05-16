## Plan

Ocultar la Leyenda cuando no hay ninguna capa territorial activa que justifique mostrarla.

**Cambio único en `src/components/ui-overlays/Legend.tsx`**

- Hoy el componente siempre renderiza el contenedor: si `!showAny`, muestra el placeholder "Leyenda · Demografía · NSE · Tráfico · Densidad · Activa una capa para filtrar".
- Reemplazar ese fallback por `return null` cuando `!showAny` (es decir: ninguna de `layers.nse`, `layers.traffic`, `layers.manzanas`, `chileCommunesActive` está activa).
- Resultado: la tarjeta aparece sólo cuando se prende NSE, Tráfico, Manzanas o Comunas de Chile.

No se cambia el cableado en `Index.tsx` ni se tocan otras capas/lógica.