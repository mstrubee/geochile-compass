import type { ComponentType } from "react";
import type { ThematicLayerRow } from "@/types/permits";

/** Lo que recibe el componente de un dataset: la hoja del árbol que lo activó (con sus `default_params`). */
export interface ProyectosDatasetProps {
  layer: ThematicLayerRow;
}

/**
 * Un dataset de puntos. Se registra con `export default { dataset, Layer } satisfies ProyectosDataset` en un archivo
 * `proyectos/datasets/<nombre>.tsx`; ProyectosHost lo descubre solo (ver proyectos/README.md). `dataset` es el valor de
 * `thematic_layers.dataset` de su hoja, con `renderer = 'points_projects'`.
 */
export interface ProyectosDataset {
  dataset: string;
  Layer: ComponentType<ProyectosDatasetProps>;
}
