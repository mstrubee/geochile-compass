import { useQuery } from "@tanstack/react-query";
import {
  fetchLayerProvenance, fetchPermitChoropleth, fetchPermitSeries, fetchThematicLayers,
} from "@/services/permitsService";
import type { PermitDestination, PermitMetric, PermitSelection } from "@/types/permits";

export const THEMATIC_LAYERS_KEY = ["thematic-layers"] as const;

/** Capas temáticas del árbol. Falla en silencio (devuelve []) si la migración aún no está aplicada. */
export const useThematicLayers = () =>
  useQuery({ queryKey: THEMATIC_LAYERS_KEY, queryFn: fetchThematicLayers, staleTime: 5 * 60_000, retry: false });

/** Fuente(s), último período y frescura de lo que alimenta la capa. */
export const useLayerProvenance = (enabled: boolean) =>
  useQuery({ queryKey: ["permits", "provenance"], queryFn: () => fetchLayerProvenance(), enabled, staleTime: 60_000, retry: 1 });

export const usePermitChoropleth = (selection: PermitSelection | null, enabled: boolean) =>
  useQuery({
    queryKey: ["permits", "choropleth", selection],
    queryFn: () => fetchPermitChoropleth(selection as PermitSelection),
    enabled: enabled && selection != null,
    staleTime: 60_000,
    retry: 1,
  });

export const usePermitSeries = (
  cut: string | null, granularity: "year" | "month", metric: PermitMetric, destination: PermitDestination,
) =>
  useQuery({
    queryKey: ["permits", "series", cut, granularity, metric, destination],
    queryFn: () => fetchPermitSeries(cut as string, granularity, metric, destination),
    enabled: cut != null,
    staleTime: 60_000,
    retry: 1,
  });
