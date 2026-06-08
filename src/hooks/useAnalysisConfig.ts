import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchAnalysisSettings,
  upsertAnalysisSettings,
  bumpConfigVersion,
  fetchComplementRules,
  upsertComplementRule,
  deleteComplementRule,
  compileRules,
  DEFAULT_ANALYSIS_SETTINGS,
  type CompiledRule,
} from "@/services/analysisSettingsService";
import {
  loadUfMap,
  syncUfValues,
  computeUfCoverage,
  invalidateUfCache,
  type UfMap,
} from "@/services/ufService";
import type { AnalysisSettings, ComplementWeightRule } from "@/types/analysis";

/* ------------------ analysis_settings ------------------ */

export const useAnalysisSettings = (folderId: string | null) => {
  // Inicializar con defaults si hay folderId — evita el estado null transitorio
  // que bloquea la UI mientras se carga de Supabase.
  const [settings, setSettings] = useState<AnalysisSettings | null>(
    () => folderId ? DEFAULT_ANALYSIS_SETTINGS(folderId) : null,
  );
  const [loading, setLoading] = useState(false);
  const [savedInDb, setSavedInDb] = useState(false); // true si existe fila real en BD
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!folderId) {
      setSettings(null);
      setSavedInDb(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const s = await fetchAnalysisSettings(folderId);
      setSettings(s);
      // Si la configuración devuelta tiene config_version > 1 o fue persistida,
      // asumimos que existe en BD (heurística: los defaults tienen version=1).
      setSavedInDb(s.config_version > 1 || s.updated_by !== null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // Mantener defaults en caso de error — no bloquear la UI.
      if (folderId) setSettings(DEFAULT_ANALYSIS_SETTINGS(folderId));
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  // Cuando cambia folderId, actualizar defaults inmediatamente
  useEffect(() => {
    if (folderId) setSettings(DEFAULT_ANALYSIS_SETTINGS(folderId));
    else setSettings(null);
  }, [folderId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (patch: Partial<AnalysisSettings>) => {
      if (!folderId) return;
      const next = await upsertAnalysisSettings({ folder_id: folderId, ...patch });
      setSettings(next);
      return next;
    },
    [folderId],
  );

  const bump = useCallback(async () => {
    if (!folderId) return;
    const v = await bumpConfigVersion(folderId);
    await refresh();
    return v;
  }, [folderId, refresh]);

  return { settings, loading, error, refresh, save, bump };
};

/* ------------------ UF ------------------ */

export const useUfMap = () => {
  const [ufMap, setUfMap] = useState<UfMap>(new Map());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const m = await loadUfMap(force);
      setUfMap(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Dispara la edge function de sync, después refresca el cache local.
   */
  const sync = useCallback(
    async (fromYear?: number, toYear?: number) => {
      setSyncing(true);
      setError(null);
      try {
        const r = await syncUfValues(fromYear, toYear);
        invalidateUfCache();
        await refresh(true);
        return r;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      } finally {
        setSyncing(false);
      }
    },
    [refresh],
  );

  /**
   * Dado un rango de períodos esperados, devuelve cobertura y faltantes.
   */
  const coverage = useCallback(
    (periods: string[]) => computeUfCoverage(periods, ufMap),
    [ufMap],
  );

  return { ufMap, loading, syncing, error, refresh, sync, coverage };
};

/* ------------------ complement rules ------------------ */

export const useComplementRules = (folderId: string | null) => {
  const [rules, setRules] = useState<ComplementWeightRule[]>([]);
  const [compiled, setCompiled] = useState<CompiledRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchComplementRules(folderId);
      setRules(list);
      setCompiled(compileRules(list));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upsert = useCallback(
    async (r: Partial<ComplementWeightRule> & { pattern: string; weight: number }) => {
      const saved = await upsertComplementRule(r);
      await refresh();
      return saved;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteComplementRule(id);
      await refresh();
    },
    [refresh],
  );

  return { rules, compiled, loading, error, refresh, upsert, remove };
};
