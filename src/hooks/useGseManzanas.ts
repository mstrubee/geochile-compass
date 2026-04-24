import { useEffect, useRef, useState } from "react";
import { gseService } from "@/services/gseService";
import type { GseFeatureCollection, GseParams, GseVariable } from "@/types/gse";

interface UseGseInput {
  enabled: boolean;
  bbox: [number, number, number, number] | null;
  zoom: number;
  variable: GseVariable;
  debounceMs?: number;
  /** Bajo este zoom, no se cargan polígonos (demasiados para renderizar). */
  minZoom?: number;
}

interface UseGseResult {
  data: GseFeatureCollection | null;
  loading: boolean;
  error: string | null;
}

const cacheKey = (p: GseParams) =>
  `${p.variable}|${Math.round(p.zoom)}|${p.west.toFixed(3)},${p.south.toFixed(3)},${p.east.toFixed(3)},${p.north.toFixed(3)}`;

export const useGseManzanas = ({
  enabled,
  bbox,
  zoom,
  variable,
  debounceMs = 400,
  minZoom = 11,
}: UseGseInput): UseGseResult => {
  const [data, setData] = useState<GseFeatureCollection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, GseFeatureCollection>>(new Map());
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!enabled || !bbox) return;
    if (zoom < minZoom) {
      setData(null);
      setError("Acerca el zoom para ver GSE por manzana");
      return;
    }
    const params: GseParams = {
      west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3],
      variable, zoom: Math.round(zoom),
    };
    const key = cacheKey(params);
    const cached = cacheRef.current.get(key);
    if (cached) {
      setData(cached);
      setError(null);
      return;
    }
    const reqId = ++reqIdRef.current;
    const t = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await gseService.fetchGse(params);
        if (reqId !== reqIdRef.current) return;
        cacheRef.current.set(key, result);
        setData(result);
      } catch (e) {
        if (reqId !== reqIdRef.current) return;
        setError(e instanceof Error ? e.message : "Error al cargar GSE");
      } finally {
        if (reqId === reqIdRef.current) setLoading(false);
      }
    }, debounceMs);
    return () => clearTimeout(t);
  }, [enabled, bbox, zoom, variable, debounceMs, minZoom]);

  return { data, loading, error };
};
