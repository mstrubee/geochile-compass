import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SavedPoi, PoiFolder } from "@/types/pois";
import type { AnalysisSettings, ComplementWeightRule } from "@/types/analysis";
import {
  buildFeaturePayload,
  type FeaturePayload,
} from "@/services/poiFeaturePayloadBuilder";

/**
 * usePoiFeaturesBatch
 * -------------------
 * Orquesta el cálculo de features territoriales para TODOS los POIs de una
 * carpeta (chain). Por cada POI:
 *   1. Resuelve si es RM o regiones (define minutos de isócrona).
 *   2. Pide isócrona al edge `isochrone`.
 *   3. Si canibalización fina activa: pide isócronas de competidores internos
 *      cercanos (lo más caro — depende del nº de peers).
 *   4. Arma payload con manzanas/celdas + competidores + complementarios.
 *   5. POST al edge `compute-poi-features` que persiste en cache.
 *
 * Throttle: ORS limita a 40 req/min para isócronas. Conservativo: 1.5s
 * entre llamadas. Para 150 locales tarda ~6 min sin canibalización fina y
 * mucho más con (ya que cada local pide isócronas de sus peers cercanos).
 *
 * Si el cálculo se interrumpe, los POIs ya completados quedan en caché.
 * Re-correr desde cero lo recalcula todo. Hay opción de "skip cached" para
 * no recomputar los que ya tienen un caché con el mismo config_version.
 */

const ORS_THROTTLE_MS = 1500; // ORS free tier ≈ 40/min — dejamos colchón

interface RunOptions {
  folder: PoiFolder;
  pois: SavedPoi[];
  settings: AnalysisSettings;
  rules: ComplementWeightRule[];
  /** POIs de carpetas marcadas como competencia externa. */
  externalCompetitors: SavedPoi[];
  /** POIs de otras carpetas (= complementarios candidatos). */
  otherPois: SavedPoi[];
  /** Features de capas personalizadas (separadas en competencia / complementarias). */
  externalCompetitorLayerFeatures: Array<{ id: string; lng: number; lat: number; name: string; category?: string }>;
  complementaryLayerFeatures: Array<{ id: string; lng: number; lat: number; name: string; category?: string }>;
  /** Si true, salta los POIs que ya tengan caché con el config_version actual. */
  skipCached?: boolean;
}

export type BatchPhase = "idle" | "running" | "done" | "error" | "cancelled";

interface RowState {
  poiId: string;
  poiName: string;
  status: "pending" | "running" | "ok" | "error" | "skipped";
  message?: string;
  features?: Record<string, number>;
  durationMs?: number;
}

export const usePoiFeaturesBatch = () => {
  const [phase, setPhase] = useState<BatchPhase>("idle");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [globalError, setGlobalError] = useState<string | null>(null);
  const cancelRef = useRef<boolean>(false);

  const updateRow = useCallback((poiId: string, patch: Partial<RowState>) => {
    setRows((prev) => ({
      ...prev,
      [poiId]: { ...prev[poiId], ...patch },
    }));
  }, []);

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const cancel = useCallback(() => {
    cancelRef.current = true;
    setPhase("cancelled");
  }, []);

  const reset = useCallback(() => {
    cancelRef.current = false;
    setPhase("idle");
    setRows({});
    setProgress({ done: 0, total: 0 });
    setGlobalError(null);
  }, []);

  const run = useCallback(
    async (opts: RunOptions) => {
      cancelRef.current = false;
      setPhase("running");
      setGlobalError(null);

      // Initialize rows
      const initial: Record<string, RowState> = {};
      for (const p of opts.pois) {
        initial[p.id] = { poiId: p.id, poiName: p.name, status: "pending" };
      }
      setRows(initial);
      setProgress({ done: 0, total: opts.pois.length });

      // Token y URL
      const { data: sessionData } = await supabase.auth.getSession();
      const bearer = sessionData?.session?.access_token;
      const supabaseUrl = (supabase as unknown as { supabaseUrl: string }).supabaseUrl;
      const supabaseAnonKey = (supabase as unknown as { supabaseKey: string }).supabaseKey;
      if (!bearer) {
        setGlobalError("No autenticado");
        setPhase("error");
        return;
      }

      // Cargar caché existente para skipCached
      let cached: Set<string> = new Set();
      if (opts.skipCached) {
        const { data: cachedRows } = await supabase
          .from("poi_features_cache")
          .select("poi_id, config_version")
          .eq("folder_id", opts.folder.id);
        for (const r of (cachedRows ?? []) as Array<{ poi_id: string; config_version: number }>) {
          if (r.config_version === opts.settings.config_version) cached.add(r.poi_id);
        }
      }

      // Pre-cargar atributos (Zona, Comuna si existe) de todos los POIs en una
      // sola query. Estos POIs no traen "Comuna" en properties — pero sí tienen
      // "Zona" (RM1, RM2, etc.) que usamos como fallback de detección RM.
      const zonaByPoi = new Map<string, string>();
      const comunaByPoi = new Map<string, string>();
      try {
        const poiIds = opts.pois.map((p) => p.id);
        if (poiIds.length > 0) {
          const { data: attrs } = await supabase
            .from("poi_attributes")
            .select("poi_id, attr_key, attr_value")
            .in("poi_id", poiIds);
          for (const a of (attrs ?? []) as Array<{ poi_id: string; attr_key: string; attr_value: string | null }>) {
            if (!a.attr_value) continue;
            const k = a.attr_key.toLowerCase().trim();
            if (k === "zona") zonaByPoi.set(a.poi_id, a.attr_value);
            else if (k === "comuna") comunaByPoi.set(a.poi_id, a.attr_value);
          }
        }
      } catch (e) {
        // No es bloqueante: el reverse-geocode por lat/lng igual funciona.
        console.warn("[features] no se pudieron cargar poi_attributes:", e);
      }

      let done = 0;
      for (const poi of opts.pois) {
        if (cancelRef.current) break;
        const start = performance.now();

        if (cached.has(poi.id)) {
          updateRow(poi.id, { status: "skipped", message: "Ya en caché (versión actual)" });
          done++;
          setProgress({ done, total: opts.pois.length });
          continue;
        }

        updateRow(poi.id, { status: "running" });

        try {
          // Comuna desde properties O atributos. Si no hay, el builder hace
          // reverse-geocode por lat/lng (más confiable que properties).
          const comunaFromProps =
            ((poi.properties as Record<string, unknown> | null)?.["Comuna"] as string | undefined) ??
            ((poi.properties as Record<string, unknown> | null)?.["comuna"] as string | undefined) ??
            null;
          const comunaFromAttrs = comunaByPoi.get(poi.id) ?? null;
          const comunaHint = comunaFromProps ?? comunaFromAttrs ?? null;
          const zonaHint = zonaByPoi.get(poi.id) ?? null;

          // Construir payload (el builder resuelve internamente comuna+RM+isoMinutes)
          const payload: FeaturePayload = await buildFeaturePayload({
            poi,
            comuna: comunaHint, // hint; si null el builder reverse-geocode
            zonaFallback: zonaHint, // fallback "RM1"/"RM2" → RM si reverse falla
            isoMinutesRm: opts.settings.iso_minutes_rm,
            isoMinutesRegions: opts.settings.iso_minutes_regions,
            includeCompetitorIsos: opts.settings.use_fine_cannibalization,
            supabaseUrl,
            supabaseAnonKey,
            bearer,
            deps: {
              internalPeers: opts.pois,
              externalCompetitors: opts.externalCompetitors,
              otherPois: opts.otherPois,
              externalCompetitorLayerFeatures: opts.externalCompetitorLayerFeatures,
              complementaryLayerFeatures: opts.complementaryLayerFeatures,
              settings: opts.settings,
              rules: opts.rules,
            },
          });

          // Enviar a edge function
          const { data: resp, error } = await supabase.functions.invoke(
            "compute-poi-features",
            { body: payload },
          );
          if (error) throw error;
          const features = (resp as { features?: Record<string, number> })?.features ?? {};

          updateRow(poi.id, {
            status: "ok",
            features,
            durationMs: Math.round(performance.now() - start),
          });
        } catch (e) {
          updateRow(poi.id, {
            status: "error",
            message: e instanceof Error ? e.message : String(e),
            durationMs: Math.round(performance.now() - start),
          });
        }

        done++;
        setProgress({ done, total: opts.pois.length });

        // Throttle ORS
        if (!cancelRef.current) await wait(ORS_THROTTLE_MS);
      }

      if (cancelRef.current) {
        setPhase("cancelled");
      } else {
        setPhase("done");
      }
    },
    [updateRow],
  );

  return {
    phase,
    rows,
    progress,
    globalError,
    run,
    cancel,
    reset,
  };
};
