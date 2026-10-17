import { SeiaDataset } from "../seia/SeiaDataset";
import { SEIA_DATASET } from "@/utils/seiaFilters";
import type { ProyectosDataset } from "../types";

/** Registro del dataset «seia_projects» (hoja «Proyectos SEIA», `thematic_layers.dataset`). */
export default { dataset: SEIA_DATASET, Layer: SeiaDataset } satisfies ProyectosDataset;
