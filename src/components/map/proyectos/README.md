# Capas de puntos por dataset (`ProyectosHost`)

`ProyectosHost` pinta las hojas del árbol marcadas en `thematic_layers` con `renderer = 'points_projects'` que estén encendidas,
**un componente por dataset** (`thematic_layers.dataset`). Hoy hay uno: `seia_projects` (SEIA). Diseño: `docs/permisos-edificacion/DISENO.md`,
«Parte 4 – SEIA».

## Cómo agregar otro dataset (p. ej. INE) sin editar `ProyectosHost`

1. **Hoja en el árbol**: una migración propia inserta en `territorial_layers` (carpeta «Edificación y expansión urbana», por slug
   `edificacion_expansion`) y en `thematic_layers` con `renderer = 'points_projects'` y su `dataset`. Ver
   `supabase/migrations/20261021120200_seia_projects_layer_node.sql` como modelo.
2. **Componente**: recibe `{ layer }` (la fila de `thematic_layers`, con `default_params`) y pinta lo suyo dentro del `MapContainer`
   (capa Leaflet, consultas, estado). Su panel va con `<ProyectosPanelPortal>` para apilarse en el dock común (abajo a la izquierda)
   en vez de superponerse a otros.
3. **Registro**: un archivo `proyectos/datasets/<nombre>.tsx` con

   ```tsx
   import type { ProyectosDataset } from "../types";
   export default { dataset: "ine_permits", Layer: MiComponente } satisfies ProyectosDataset;
   ```

   `registry.ts` lo descubre solo (`import.meta.glob`). Un archivo nuevo no puede entrar en conflicto de merge con el del SEIA.

Reglas: un dataset que falla al dibujarse no tumba el mapa (se avisa en el dock); un `dataset` sin componente muestra un aviso; si dos
archivos declaran el mismo `dataset` se conserva el primero (orden alfabético de ruta) y se registra un error en consola.
**Cada dataset tiene sus propias tablas, RPC, hooks y servicio**: no hay un modelo común de «proyecto».
