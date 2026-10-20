import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchLayerProvenance } from "@/services/permitsService";
import { fetchHealthCapacity, fetchHealthComunaCounts, fetchHealthComunaTipos, fetchHealthEstablishments, fetchHealthSummary, fetchHealthTipos } from "@/services/healthService";
import { HEALTH_DATASET, type HealthFilters } from "@/types/health";
import type { Bounds } from "@/types/projects";

const STALE = 60_000;

export const useHealthPoints = (bounds: Bounds | null, filters: HealthFilters, enabled: boolean) =>
  useQuery({
    queryKey: ["health", "points", bounds, filters],
    queryFn: () => fetchHealthEstablishments(bounds as Bounds, filters),
    enabled: enabled && bounds != null, staleTime: STALE, retry: 1, placeholderData: keepPreviousData,
  });

export const useHealthComunaCounts = (filters: HealthFilters, enabled: boolean) =>
  useQuery({ queryKey: ["health", "comuna-counts", filters], queryFn: () => fetchHealthComunaCounts(filters), enabled, staleTime: STALE, retry: 1, placeholderData: keepPreviousData });

export const useHealthComunaTipos = (cut: string | null) =>
  useQuery({ queryKey: ["health", "comuna-tipos", cut], queryFn: () => fetchHealthComunaTipos(cut as string), enabled: cut != null, staleTime: STALE, retry: 1 });

export const useHealthSummary = (enabled: boolean) =>
  useQuery({ queryKey: ["health", "summary"], queryFn: fetchHealthSummary, enabled, staleTime: 5 * STALE, retry: 1 });

export const useHealthTipos = (enabled: boolean) =>
  useQuery({ queryKey: ["health", "tipos"], queryFn: fetchHealthTipos, enabled, staleTime: 5 * STALE, retry: 1 });

/** Fuente, captura y frescura de la capa de establecimientos (RPC genérica get_layer_provenance con el dataset de salud). */
export const useHealthProvenance = (enabled: boolean) =>
  useQuery({ queryKey: ["health", "provenance"], queryFn: () => fetchLayerProvenance(HEALTH_DATASET), enabled, staleTime: STALE, retry: 1 });

/** Capacidad de un hospital: se pide al abrir su ficha (popup), no con los puntos. */
export const useHealthCapacity = (code: string | null) =>
  useQuery({ queryKey: ["health", "capacity", code], queryFn: () => fetchHealthCapacity(code as string), enabled: code != null, staleTime: 5 * STALE, retry: 1 });
