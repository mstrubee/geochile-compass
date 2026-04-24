import { useEffect, useRef, useState } from "react";
import { manzanaService } from "@/services/manzanaService";
import type {
  ManzanaFeatureCollection,
  ManzanaParams,
  ManzanaVariable,
} from "@/types/manzanas";

interface UseManzanasInput {
  enabled: boolean;
  bbox: [number, number, number, number] | null; // [w, s, e, n]
  zoom: number;
  variable: ManzanaVariable;
  debounceMs?: number;
  minZoom?: number;
}

interface UseManzanasResult {
  data: ManzanaFeatureCollection | null;
  loading: boolean;
  error: string | null;
}

const cacheKey = (p: ManzanaParams) =>
  `${p.variable}|${p.zoom}|${p.west.toFixed(3)},${p.south.toFixed(3)},${p.east.toFixed(3)},${p.north.toFixed(3)}`;

export const useManzanas = ({
  enabled,
  bbox,
  zoom,
  variable,
  debounceMs = 400,
  minZoom = 10,
}: UseManzanasInput): UseManzanasResult => {
  const [data, setData] = useState<ManzanaFeatureCollection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cacheRef = useRef<Map<string, ManzanaFeatureCollection>>(new Map());
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!enabled || !bbox) {
      return;
    }
    if (zoom < minZoom) {
      setData(null);
      setError("Acerca el zoom para ver las manzanas");
      return;
    }
    const params: ManzanaParams = {
      west: bbox[0],
      south: bbox[1],
      east: bbox[2],
      north: bbox[3],
      variable,
      zoom: Math.round(zoom),
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
        const result = await manzanaService.fetchManzanas(params);
        if (reqId !== reqIdRef.current) return;
        cacheRef.current.set(key, result);
        setData(result);
      } catch (e) {
        if (reqId !== reqIdRef.current) return;
        setError(e instanceof Error ? e.message : "Error al cargar manzanas");
      } finally {
        if (reqId === reqIdRef.current) setLoading(false);
      }
    }, debounceMs);

    return () => clearTimeout(t);
  }, [enabled, bbox, zoom, variable, debounceMs, minZoom]);

  return { data, loading, error };
};
