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
const rateLimitUntil = new Map<string, number>();
let globalRateLimitUntil = 0;

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
      if (!force && globalRateLimitUntil > Date.now()) {
        const seconds = Math.max(1, Math.ceil((globalRateLimitUntil - Date.now()) / 1000));
        const cached = cache.get(key);
        setState({
          summary: cached ?? null,
          loading: false,
          error: `Gemini está temporalmente en cuota. Reintenta en ~${seconds}s.`,
        });
        return;
      }
      const blockedUntil = rateLimitUntil.get(key) ?? 0;
      if (!force && blockedUntil > Date.now()) {
        const seconds = Math.max(1, Math.ceil((blockedUntil - Date.now()) / 1000));
        setState({
          summary: cache.get(key) ?? null,
          loading: false,
          error: `Gemini está temporalmente en cuota. Reintenta en ~${seconds}s.`,
        });
        return;
      }
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
        const payload = data as { summary?: string; error?: string; fallback?: boolean; retryAfterMs?: number };
        if (payload?.error) {
          if (payload.error === "RATE_LIMITED") {
            const retryMs = Math.max(1000, payload.retryAfterMs ?? 30000);
            rateLimitUntil.set(key, Date.now() + retryMs);
            globalRateLimitUntil = Date.now() + retryMs;
            if (payload.summary) {
              cache.set(key, payload.summary);
              setState({
                summary: payload.summary,
                loading: false,
                error: `Gemini quedó sin cuota; mostrando un resumen de contingencia. Reintenta en ~${Math.ceil(retryMs / 1000)}s.`,
              });
              return;
            }
          }
          const msg =
            payload.error === "SERVICE_UNAVAILABLE"
              ? "El modelo Gemini está temporalmente saturado. Intenta nuevamente en unos minutos."
              : payload.error === "RATE_LIMITED"
                ? `Se alcanzó la cuota de Gemini. Intenta nuevamente en ~${Math.ceil((payload.retryAfterMs ?? 30000) / 1000)}s.`
                : payload.error;
          if (payload.summary) cache.set(key, payload.summary);
          setState({ summary: null, loading: false, error: msg });
          return;
        }
        rateLimitUntil.delete(key);
        globalRateLimitUntil = 0;
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
      setState((prev) =>
        prev.summary === null && prev.loading === false && prev.error === null
          ? prev
          : { summary: null, loading: false, error: null },
      );
      return;
    }
    fetchSummary(analysis, false);
  }, [enabled, analysis, fetchSummary]);

  const regenerate = useCallback(() => {
    if (analysis) fetchSummary(analysis, true);
  }, [analysis, fetchSummary]);

  return { ...state, regenerate };
};
