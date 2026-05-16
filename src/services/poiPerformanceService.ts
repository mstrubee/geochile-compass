import { supabase } from "@/integrations/supabase/client";
import type { PoiPerformanceAnalysis } from "@/types/analysis";

/**
 * Servicio cliente para el análisis de performance (Fase 3).
 * - fetchPoiPerformance: lee la fila cacheada para un POI.
 * - fetchPerformanceForFolder: lee todas las filas de una carpeta.
 * - triggerComputeBatch: invoca la edge function que entrena el modelo
 *   Ridge sobre todos los POIs y persiste resultados.
 */

export const fetchPoiPerformance = async (
  poiId: string,
): Promise<PoiPerformanceAnalysis | null> => {
  const { data, error } = await supabase
    .from("poi_performance_analysis")
    .select("*")
    .eq("poi_id", poiId)
    .maybeSingle();
  if (error) {
    console.warn("[fetchPoiPerformance]", error.message);
    return null;
  }
  return (data ?? null) as unknown as PoiPerformanceAnalysis | null;
};

export const fetchPerformanceForFolder = async (
  folderId: string,
): Promise<PoiPerformanceAnalysis[]> => {
  const { data, error } = await supabase
    .from("poi_performance_analysis")
    .select("*")
    .eq("folder_id", folderId);
  if (error) {
    console.warn("[fetchPerformanceForFolder]", error.message);
    return [];
  }
  return (data ?? []) as unknown as PoiPerformanceAnalysis[];
};

export interface ComputeBatchModelInfo {
  r2: number;
  cv_rmse: number;
  alpha: number;
  n_train: number;
  features_used: { key: string; label: string }[];
}

export interface ComputeBatchResult {
  success: boolean;
  n_pois_processed: number;
  model_a: ComputeBatchModelInfo;
  model_b: ComputeBatchModelInfo | null;
  n_pois_with_score: number;
}

export const triggerComputeBatch = async (
  folderId: string,
  targetYear?: number,
): Promise<ComputeBatchResult> => {
  const { data, error } = await supabase.functions.invoke("compute-performance-batch", {
    body: { folder_id: folderId, target_year: targetYear },
  });
  if (error) throw error;
  if (data && (data as { error?: string }).error) {
    throw new Error((data as { error: string }).error);
  }
  return data as ComputeBatchResult;
};
