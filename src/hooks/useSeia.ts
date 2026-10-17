import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchSeiaFacets, fetchSeiaProject, fetchSeiaProjects, fetchSeiaProvenance } from "@/services/seiaService";
import type { Bbox, SeiaFilters } from "@/types/seia";

/** Valores reales para los filtros y calidad de ubicación. */
export const useSeiaFacets = (sourceKeys: string[] | null, enabled = true) =>
  useQuery({ queryKey: ["seia", "facets", sourceKeys], queryFn: () => fetchSeiaFacets(sourceKeys), enabled, staleTime: 5 * 60_000, retry: 1 });

/** Fuente, captura y frescura. */
export const useSeiaProvenance = (enabled = true) =>
  useQuery({ queryKey: ["seia", "provenance"], queryFn: fetchSeiaProvenance, enabled, staleTime: 60_000, retry: 1 });

/** Proyectos del recuadro. Mantiene los puntos anteriores mientras llegan los nuevos (el mapa no parpadea al mover). */
export const useSeiaProjects = (bbox: Bbox | null, filters: SeiaFilters | null, enabled = true) =>
  useQuery({
    queryKey: ["seia", "projects", bbox, filters],
    queryFn: () => fetchSeiaProjects(bbox as Bbox, filters as SeiaFilters),
    enabled: enabled && bbox != null && filters != null,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    retry: 1,
  });

export const useSeiaProject = (sel: { source_key: string; external_id: string } | null) =>
  useQuery({
    queryKey: ["seia", "project", sel?.source_key, sel?.external_id],
    queryFn: () => fetchSeiaProject((sel as { source_key: string }).source_key, (sel as { external_id: string }).external_id),
    enabled: sel != null,
    staleTime: 60_000,
    retry: 1,
  });
