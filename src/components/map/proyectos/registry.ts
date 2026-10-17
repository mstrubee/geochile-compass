import type { ProyectosDataset } from "./types";

type DatasetModule = { default?: ProyectosDataset };

export interface Registry {
  datasets: Map<string, ProyectosDataset>;
  /** Datasets declarados por más de un archivo: se conserva el primero (orden alfabético de ruta) y se avisa. */
  duplicates: string[];
}

/** Arma el registro a partir de módulos `datasets/*.tsx`. Separada de `import.meta.glob` para poder probarla. */
export const buildRegistry = (modules: Record<string, DatasetModule>): Registry => {
  const datasets = new Map<string, ProyectosDataset>();
  const duplicates: string[] = [];
  for (const path of Object.keys(modules).sort()) {
    const d = modules[path]?.default;
    if (!d || typeof d.dataset !== "string" || !d.dataset || typeof d.Layer !== "function") {
      console.error(`[proyectos] ${path} no exporta por defecto { dataset, Layer }: se ignora`);
      continue;
    }
    if (datasets.has(d.dataset)) {
      duplicates.push(d.dataset);
      console.error(`[proyectos] el dataset «${d.dataset}» está declarado dos veces (${path}): se conserva el primero`);
      continue;
    }
    datasets.set(d.dataset, d);
  }
  return { datasets, duplicates };
};

// Descubrimiento automático: agregar un dataset = agregar un archivo en ./datasets, sin editar ProyectosHost ni este archivo.
export const REGISTRY: Registry = buildRegistry(import.meta.glob<DatasetModule>("./datasets/*.tsx", { eager: true }));
