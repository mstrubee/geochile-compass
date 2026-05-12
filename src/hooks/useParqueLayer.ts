// ============================================================================
// useParqueLayer.ts
//
// Hook simple para gestionar el toggle de la capa de parque automotor en el
// sidebar / mapa. Persiste el estado en localStorage.
// ============================================================================
import { useEffect, useState } from "react";

const LS_KEY = "geochile:parque-layer-visible";

export function useParqueLayer() {
  const [visible, setVisibleState] = useState<boolean>(() => {
    try { return localStorage.getItem(LS_KEY) === "true"; }
    catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, visible ? "true" : "false"); }
    catch { /* ignore */ }
  }, [visible]);

  return {
    visible,
    setVisible: setVisibleState,
    toggle: () => setVisibleState(v => !v),
  };
}
