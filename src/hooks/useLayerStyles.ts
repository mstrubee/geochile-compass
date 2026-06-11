/**
 * useLayerStyles
 * ──────────────
 * Persistencia en localStorage de overrides de estilo para capas territoriales.
 * Mismo patrón que useBrandStyles: CustomEvent para sincronizar todas las
 * instancias del hook sin necesidad de Context.
 */

import { useCallback, useEffect, useReducer } from "react";

export interface LayerStyle {
  color:    string | null;  // null = usar color del DB
  icon:     string | null;  // null = usar ícono del DB (o ninguno)
  iconSize: number;         // 12-40 px; default 22
}

const STORAGE_KEY   = "geo_layer_styles_v1";
const EVENT_NAME    = "geoLayerStylesChanged";
const DEFAULT_SIZE  = 22;

function readAll(): Record<string, LayerStyle> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

export function useLayerStyles() {
  // `version` se incrementa en cada cambio para que los componentes que
  // dependan de él se rerendicen sin necesidad de leer el hook completo.
  const [version, bump] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const handler = () => bump();
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  /**
   * Devuelve el estilo efectivo para una capa:
   * override local si existe, sino los valores del DB (dbColor / dbIcon).
   */
  const getStyle = useCallback(
    (
      layerId:  string,
      dbColor:  string | null,
      dbIcon:   string | null,
    ): Required<LayerStyle> => {
      const stored = readAll()[layerId];
      return {
        color:    stored?.color    !== undefined ? stored.color    : dbColor,
        icon:     stored?.icon     !== undefined ? stored.icon     : dbIcon,
        iconSize: stored?.iconSize ?? DEFAULT_SIZE,
      };
    },
    // readAll() lee directamente de localStorage; `version` no entra aquí
    // porque el caller añade `version` a sus propias deps cuando lo necesita.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const setLayerStyle = useCallback(
    (layerId: string, patch: Partial<LayerStyle>) => {
      const all = readAll();
      all[layerId] = {
        color:    null,
        icon:     null,
        iconSize: DEFAULT_SIZE,
        ...(all[layerId] ?? {}),
        ...patch,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      window.dispatchEvent(new CustomEvent(EVENT_NAME));
    },
    [],
  );

  const resetLayerStyle = useCallback((layerId: string) => {
    const all = readAll();
    delete all[layerId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    window.dispatchEvent(new CustomEvent(EVENT_NAME));
  }, []);

  return { getStyle, setLayerStyle, resetLayerStyle, version };
}
