import { useMemo } from "react";

const KEY = "geochile.layerTree.legacy";

/**
 * Válvula de escape de la Fase 2: `?capas=clasico` vuelve a la lista anterior de
 * grupos y la recuerda en este navegador; `?capas=arbol` la quita. Se retira
 * junto con la lista anterior en la Fase 5.
 */
export const useLegacyLayerList = (): boolean =>
  useMemo(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("capas");
      if (q === "clasico") localStorage.setItem(KEY, "1");
      else if (q === "arbol") localStorage.removeItem(KEY);
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  }, []);
