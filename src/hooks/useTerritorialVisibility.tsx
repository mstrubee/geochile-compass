import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface Ctx {
  visibleLayerIds: Set<string>;
  toggleLayer: (id: string) => void;
  setLayers: (ids: string[], visible: boolean) => void;
  ensureVisibleDefaults: (ids: string[]) => void;
  isVisible: (id: string) => boolean;
}

const TerritorialVisibilityContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "territorial_visible_v2";
const SEEN_LAYERS_KEY = `${STORAGE_KEY}_seen_layers`;

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
    let unseen = ids;
    try {
      const seen = JSON.parse(localStorage.getItem(SEEN_LAYERS_KEY) || "[]");
      const seenSet = new Set(Array.isArray(seen) ? seen : []);
      unseen = ids.filter((id) => !seenSet.has(id));
      if (!unseen.length) return;
      localStorage.setItem(SEEN_LAYERS_KEY, JSON.stringify(Array.from(new Set([...seenSet, ...ids]))));
    } catch {
      // ignore
    }
    setVisible((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const isVisible = useCallback((id: string) => visibleLayerIds.has(id), [visibleLayerIds]);

  const value = useMemo(
    () => ({ visibleLayerIds, toggleLayer, setLayers, ensureVisibleDefaults, isVisible }),
    [visibleLayerIds, toggleLayer, setLayers, ensureVisibleDefaults, isVisible],
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
