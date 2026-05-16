// ============================================================================
// useParqueLayer.ts
//
// Store global compartido para el toggle del "Parque automotor". Antes usaba
// useState local en cada consumidor, lo que causaba que el sidebar y el host
// del mapa tuvieran estados independientes (el heatmap quedaba pegado).
// ============================================================================
import { useSyncExternalStore } from "react";

const LS_KEY = "geochile:parque-layer-visible";

let visible: boolean = (() => {
  try { return localStorage.getItem(LS_KEY) === "true"; }
  catch { return false; }
})();

const listeners = new Set<() => void>();

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};

const getSnapshot = () => visible;

const setVisible = (v: boolean) => {
  if (visible === v) return;
  visible = v;
  try { localStorage.setItem(LS_KEY, v ? "true" : "false"); } catch { /* ignore */ }
  listeners.forEach((cb) => cb());
};

export function useParqueLayer() {
  const v = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    visible: v,
    setVisible,
    toggle: () => setVisible(!visible),
  };
}
