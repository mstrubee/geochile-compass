import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchLayerProvenance } from "@/services/permitsService";
import { fetchCasenRegion, fetchIsapreComuna, fetchIsapreResumen, fetchIsapreSinAlta } from "@/services/previsionService";
import type { HealthAltaDef } from "@/types/health";
import { CASEN_DATASET, ISAPRE_DATASET, type IsapreFilters } from "@/types/prevision";

const STALE = 60_000;

export const useIsapreComuna = (filters: IsapreFilters, enabled: boolean) =>
  useQuery({ queryKey: ["prevision", "isapre-comuna", filters], queryFn: () => fetchIsapreComuna(filters), enabled, staleTime: STALE, retry: 1, placeholderData: keepPreviousData });

export const useIsapreResumen = (enabled: boolean) =>
  useQuery({ queryKey: ["prevision", "isapre-resumen"], queryFn: fetchIsapreResumen, enabled, staleTime: 5 * STALE, retry: 1 });

/** 1b-1. Sin reintentos: si la base se niega (conjunto demasiado acotado) el motivo se muestra tal cual. */
export const useIsapreSinAlta = (alta: HealthAltaDef, minTramo: number, enabled: boolean) =>
  useQuery({ queryKey: ["prevision", "isapre-sin-alta", alta, minTramo], queryFn: () => fetchIsapreSinAlta(alta, minTramo), enabled, staleTime: 5 * STALE, retry: 0 });

export const useCasenRegion = (enabled: boolean) =>
  useQuery({ queryKey: ["prevision", "casen-region"], queryFn: fetchCasenRegion, enabled, staleTime: 5 * STALE, retry: 1 });

export const useIsapreProvenance = (enabled: boolean) =>
  useQuery({ queryKey: ["prevision", "isapre-provenance"], queryFn: () => fetchLayerProvenance(ISAPRE_DATASET), enabled, staleTime: STALE, retry: 1 });

export const useCasenProvenance = (enabled: boolean) =>
  useQuery({ queryKey: ["prevision", "casen-provenance"], queryFn: () => fetchLayerProvenance(CASEN_DATASET), enabled, staleTime: STALE, retry: 1 });
