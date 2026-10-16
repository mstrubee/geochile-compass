/**
 * Acceso a las RPC y tablas del módulo de permisos de edificación.
 *
 * Las RPC (`get_permit_choropleth`, `get_permit_series`, `get_layer_provenance`) y la tabla `thematic_layers`
 * las crean las migraciones 2 y 3 y todavía no están en `integrations/supabase/types.ts` (archivo generado:
 * se regenera al aplicar las migraciones). Hasta entonces se llaman con un cast explícito y localizado aquí.
 *
 * Despliegue seguro: si el front llega antes que la migración, `fetchThematicLayers` devuelve [] en vez de romper el mapa.
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  LayerProvenanceRow, PermitChoroplethRow, PermitDestination, PermitMetric, PermitSeriesRow, PermitSelection,
  ThematicLayerRow,
} from "@/types/permits";
import { sourceKeyFor } from "@/utils/permitsPeriods";

type RpcResult<T> = Promise<{ data: T | null; error: { message: string } | null }>;
const rpc = <T>(name: string, args: Record<string, unknown>): RpcResult<T> =>
  (supabase.rpc as unknown as (n: string, a: Record<string, unknown>) => RpcResult<T>)(name, args);

/** Hojas del árbol marcadas como capas temáticas. Nunca lanza: sin tabla (migración 3 pendiente) → []. */
export const fetchThematicLayers = async (): Promise<ThematicLayerRow[]> => {
  const q = (supabase as unknown as { from: (t: string) => { select: (c: string) => PromiseLike<{ data: ThematicLayerRow[] | null; error: { message: string } | null }> } })
    .from("thematic_layers")
    .select("layer_id, renderer, dataset, default_params");
  const { data, error } = await q;
  if (error) {
    console.warn("[permits] thematic_layers no disponible:", error.message);
    return [];
  }
  return data ?? [];
};

export const fetchLayerProvenance = async (dataset = "building_permits"): Promise<LayerProvenanceRow[]> => {
  const { data, error } = await rpc<LayerProvenanceRow[]>("get_layer_provenance", { p_dataset: dataset });
  if (error) throw new Error(error.message);
  return data ?? [];
};

/** Parámetros de `get_permit_choropleth` para una selección. El modo decide la fuente (año → anual; mes/acumulado → mensual). */
export const choroplethArgs = (s: PermitSelection) => ({
  p_source_key: sourceKeyFor(s.mode),
  p_granularity: s.mode,
  p_year: s.year,
  p_month: s.mode === "year" ? null : s.month,
  p_metric: s.metric,
  p_destination_class: s.destination,
});

export const fetchPermitChoropleth = async (s: PermitSelection): Promise<PermitChoroplethRow[]> => {
  const { data, error } = await rpc<PermitChoroplethRow[]>("get_permit_choropleth", choroplethArgs(s));
  if (error) throw new Error(error.message);
  return data ?? [];
};

export const fetchPermitSeries = async (
  cut: string, granularity: "year" | "month", metric: PermitMetric, destination: PermitDestination,
): Promise<PermitSeriesRow[]> => {
  const { data, error } = await rpc<PermitSeriesRow[]>("get_permit_series", {
    p_cut: cut,
    p_source_key: sourceKeyFor(granularity === "year" ? "year" : "month"),
    p_metric: metric,
    p_destination_class: destination,
    p_granularity: granularity,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
};
