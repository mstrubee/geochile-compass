import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  fetchIneCoverage, fetchIneCrfByComuna, fetchIneCrfCoverage, fetchIneCrfPolygons, fetchInePermitPoints, fetchIneVsMinvu, fetchSeiaProjects, fetchSeiaSummary,
} from "@/services/projectsService";
import { fetchLayerProvenance } from "@/services/permitsService";
import type { Bounds, InePermitFilters, SeiaFilters } from "@/types/projects";

const STALE = 60_000;

export const useDatasetProvenance = (dataset: string, enabled: boolean) =>
  useQuery({ queryKey: ["projects", "provenance", dataset], queryFn: () => fetchLayerProvenance(dataset), enabled, staleTime: STALE, retry: 1 });

export const useIneCoverage = (enabled: boolean) =>
  useQuery({ queryKey: ["projects", "ine-pe-coverage"], queryFn: fetchIneCoverage, enabled, staleTime: 5 * STALE, retry: 1 });
export const useIneVsMinvu = (enabled: boolean) =>
  useQuery({ queryKey: ["projects", "ine-pe-vs-minvu"], queryFn: fetchIneVsMinvu, enabled, staleTime: 5 * STALE, retry: 1 });

export const useInePermitPoints = (bounds: Bounds | null, zoom: number, filters: InePermitFilters, enabled: boolean) =>
  useQuery({
    queryKey: ["projects", "ine-pe-points", bounds, Math.round(zoom), filters],
    queryFn: () => fetchInePermitPoints(bounds as Bounds, zoom, filters),
    enabled: enabled && bounds != null, staleTime: STALE, retry: 1, placeholderData: keepPreviousData,
  });

export const useIneCrfPolygons = (bounds: Bounds | null, years: number[] | null, enabled: boolean) =>
  useQuery({
    queryKey: ["projects", "ine-crf-polygons", bounds, years],
    queryFn: () => fetchIneCrfPolygons(bounds as Bounds, years),
    enabled: enabled && bounds != null, staleTime: STALE, retry: 1, placeholderData: keepPreviousData,
  });
export const useIneCrfByComuna = (years: number[] | null, enabled: boolean) =>
  useQuery({ queryKey: ["projects", "ine-crf-by-comuna", years], queryFn: () => fetchIneCrfByComuna(years), enabled, staleTime: STALE, retry: 1 });
export const useIneCrfCoverage = (enabled: boolean) =>
  useQuery({ queryKey: ["projects", "ine-crf-coverage"], queryFn: fetchIneCrfCoverage, enabled, staleTime: 5 * STALE, retry: 1 });

export const useSeiaProjects = (bounds: Bounds | null, filters: SeiaFilters, enabled: boolean) =>
  useQuery({
    queryKey: ["projects", "seia", bounds, filters],
    queryFn: () => fetchSeiaProjects(bounds as Bounds, filters),
    enabled: enabled && bounds != null, staleTime: STALE, retry: 1, placeholderData: keepPreviousData,
  });
export const useSeiaSummary = (enabled: boolean) =>
  useQuery({ queryKey: ["projects", "seia-summary"], queryFn: fetchSeiaSummary, enabled, staleTime: 5 * STALE, retry: 1 });
