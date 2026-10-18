import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { COMMUNES, type Commune } from "@/data/communes";
import { fetchLayerProvenance } from "@/services/permitsService";
import { EMPTY_POBLACION, loadPoblacionIndex, poblacionOf } from "@/services/poblacionService";
import { POBLACION_DATASET, type PoblacionIndex } from "@/types/poblacion";

const STALE = 5 * 60_000;

/** Población censada 2024 por comuna. Mientras carga o si falla, `index.status` lo dice y todo valor es «sin dato». */
export const usePoblacionIndex = () => {
  const q = useQuery({ queryKey: ["poblacion", "censo2024"], queryFn: loadPoblacionIndex, staleTime: STALE, retry: 1 });
  const index: PoblacionIndex = q.data ?? EMPTY_POBLACION;
  return { index, isLoading: q.isLoading, popOf: (name: string, cut?: string | null) => poblacionOf(index, { name, cut }) };
};

/**
 * COMMUNES con `pop` SIEMPRE del Censo 2024 (0 = sin dato, como ya lo interpretan los componentes). La densidad se recalcula con esa población y el área
 * declarada de la comuna (área sin fuente verificada: ver «Datos sin fuente» del PR); no queda ninguna cifra de población en el código.
 */
export const useCommunesWithPopulation = (): Commune[] => {
  const { index } = usePoblacionIndex();
  return useMemo(
    () => COMMUNES.map((c) => {
      const pop = poblacionOf(index, { name: c.name }) ?? 0;
      return { ...c, pop, density: pop > 0 && c.area > 0 ? pop / c.area : 0 };
    }),
    [index],
  );
};

/** Ficha de procedencia (fuente, licencia, período y fecha de publicación) de la población censada. */
export const usePoblacionProvenance = (enabled = true) =>
  useQuery({ queryKey: ["poblacion", "provenance"], queryFn: () => fetchLayerProvenance(POBLACION_DATASET), enabled, staleTime: STALE, retry: 1 });
