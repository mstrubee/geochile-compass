import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface Ctx {
  visibleLayerIds: Set<string>;
  toggleLayer: (id: string) => void;
  setLayers: (ids: string[], visible: boolean) => void;
  isVisible: (id: string) => boolean;
}

const TerritorialVisibilityContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "territorial_visible_v1";

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

  const isVisible = useCallback((id: string) => visibleLayerIds.has(id), [visibleLayerIds]);

  const value = useMemo(
    () => ({ visibleLayerIds, toggleLayer, setLayers, isVisible }),
    [visibleLayerIds, toggleLayer, setLayers, isVisible],
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
