import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { IsochroneAnalysis } from "@/utils/isochroneAnalysis";
import { RM_AVERAGES } from "@/data/rmAverages";

interface State {
  summary: string | null;
  loading: boolean;
  error: string | null;
}

const cache = new Map<string, string>();

const cacheKey = (a: IsochroneAnalysis) =>
  `${a.isoId}|${a.bandMinutes}|${a.totals.source}|${a.totals.pop}|${a.totals.hh}`;

export const useIsochroneInsights = (
  analysis: IsochroneAnalysis | null,
  enabled: boolean,
) => {
  const [state, setState] = useState<State>({ summary: null, loading: false, error: null });
  const reqIdRef = useRef(0);

  const fetchSummary = useCallback(
    async (a: IsochroneAnalysis, force = false) => {
      const key = cacheKey(a);
      if (!force) {
        const cached = cache.get(key);
        if (cached) {
          setState({ summary: cached, loading: false, error: null });
          return;
        }
      }
      const reqId = ++reqIdRef.current;
      setState({ summary: null, loading: true, error: null });
      try {
        const { data, error } = await supabase.functions.invoke("isochrone-insights", {
          body: { analysis: a, rmAverages: RM_AVERAGES },
        });
        if (reqId !== reqIdRef.current) return;
        if (error) throw new Error(error.message);
        const payload = data as { summary?: string; error?: string; fallback?: boolean };
        if (payload?.error) {
          const msg =
            payload.error === "SERVICE_UNAVAILABLE"
              ? "El modelo Gemini está temporalmente saturado. Intenta nuevamente en unos minutos."
              : payload.error === "Rate limit exceeded"
                ? "Se alcanzó el límite de uso de Gemini. Intenta más tarde."
                : payload.error;
          setState({ summary: null, loading: false, error: msg });
          return;
        }
        const summary = payload?.summary ?? "";
        cache.set(key, summary);
        setState({ summary, loading: false, error: null });
      } catch (e) {
        if (reqId !== reqIdRef.current) return;
        setState({
          summary: null,
          loading: false,
          error: e instanceof Error ? e.message : "Error generando resumen",
        });
      }
    },
    [],
  );

  useEffect(() => {
    if (!enabled || !analysis) {
      setState({ summary: null, loading: false, error: null });
      return;
    }
    fetchSummary(analysis, false);
  }, [enabled, analysis, fetchSummary]);

  const regenerate = useCallback(() => {
    if (analysis) fetchSummary(analysis, true);
  }, [analysis, fetchSummary]);

  return { ...state, regenerate };
};
