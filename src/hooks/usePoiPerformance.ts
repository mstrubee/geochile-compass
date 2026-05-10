import { useCallback, useEffect, useState } from "react";
import {
  fetchPoiPerformance,
  fetchPerformanceForFolder,
  triggerComputeBatch,
  type ComputeBatchResult,
} from "@/services/poiPerformanceService";
import type { PoiPerformanceAnalysis } from "@/types/analysis";

/**
 * Hook para el análisis de un POI específico.
 * - perf: datos cacheados (poi_performance_analysis row)
 * - reload: vuelve a leer desde BD (después de un recompute)
 */
export const usePoiPerformance = (poiId: string | null) => {
  const [perf, setPerf] = useState<PoiPerformanceAnalysis | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!poiId) {
      setPerf(null);
      return;
    }
    setLoading(true);
    try {
      const r = await fetchPoiPerformance(poiId);
      setPerf(r);
    } finally {
      setLoading(false);
    }
  }, [poiId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { perf, loading, reload };
};

/**
 * Hook para el listado de toda la carpeta.
 */
export const useFolderPerformance = (folderId: string | null) => {
  const [list, setList] = useState<PoiPerformanceAnalysis[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!folderId) {
      setList([]);
      return;
    }
    setLoading(true);
    try {
      setList(await fetchPerformanceForFolder(folderId));
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { list, loading, reload };
};

/**
 * Hook para disparar la batch de recálculo.
 */
export const useComputePerformanceBatch = () => {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ComputeBatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (folderId: string, targetYear?: number) => {
    setRunning(true);
    setError(null);
    try {
      const r = await triggerComputeBatch(folderId, targetYear);
      setResult(r);
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      throw e;
    } finally {
      setRunning(false);
    }
  }, []);

  return { running, result, error, run };
};
