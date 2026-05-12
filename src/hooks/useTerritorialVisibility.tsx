import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface Ctx {
  visibleLayerIds: Set<string>;
  toggleLayer: (id: string) => void;
  setLayers: (ids: string[], visible: boolean) => void;
  ensureVisibleDefaults: (ids: string[]) => void;
  isVisible: (id: string) => boolean;
  heatmapEnabled: boolean;
  setHeatmapEnabled: (v: boolean) => void;
}

const TerritorialVisibilityContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "territorial_visible_v2";
const SEEN_LAYERS_KEY = `${STORAGE_KEY}_seen_layers`;
const HEATMAP_KEY = "territorial_heatmap_v1";

export const TerritorialVisibilityProvider = ({ children }: { children: ReactNode }) => {
  const [visibleLayerIds, setVisible] = useState<Set<string>>(() => {
    try {
      const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(visibleLayerIds)));
    } catch {
      // ignore
    }
  }, [visibleLayerIds]);

  const toggleLayer = useCallback((id: string) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setLayers = useCallback((ids: string[], visible: boolean) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (visible) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const ensureVisibleDefaults = useCallback((ids: string[]) => {
    if (!ids.length) return;
    try {
      const seen = JSON.parse(localStorage.getItem(SEEN_LAYERS_KEY) || "[]");
      const seenSet = new Set(Array.isArray(seen) ? seen : []);
      const unseen = ids.filter((id) => !seenSet.has(id));
      if (!unseen.length) return;
      localStorage.setItem(SEEN_LAYERS_KEY, JSON.stringify(Array.from(new Set([...seenSet, ...ids]))));
    } catch {
      // ignore
    }
    // Por defecto las capas territoriales quedan apagadas; el usuario las activa manualmente.
  }, []);

  const isVisible = useCallback((id: string) => visibleLayerIds.has(id), [visibleLayerIds]);

  const [heatmapEnabled, setHeatmapEnabledState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(HEATMAP_KEY) === "1";
    } catch {
      return false;
    }
  });

  const setHeatmapEnabled = useCallback((v: boolean) => {
    setHeatmapEnabledState(v);
    try {
      localStorage.setItem(HEATMAP_KEY, v ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo(
    () => ({ visibleLayerIds, toggleLayer, setLayers, ensureVisibleDefaults, isVisible, heatmapEnabled, setHeatmapEnabled }),
    [visibleLayerIds, toggleLayer, setLayers, ensureVisibleDefaults, isVisible, heatmapEnabled, setHeatmapEnabled],
  );

  return (
    <TerritorialVisibilityContext.Provider value={value}>
      {children}
    </TerritorialVisibilityContext.Provider>
  );
};

export const useTerritorialVisibility = () => {
  const ctx = useContext(TerritorialVisibilityContext);
  if (!ctx) throw new Error("useTerritorialVisibility must be inside TerritorialVisibilityProvider");
  return ctx;
};
