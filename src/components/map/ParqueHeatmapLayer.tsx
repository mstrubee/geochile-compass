// ============================================================================
// ParqueHeatmapLayer.tsx
//
// Heatmap del parque automotor.
//
// Fixes (vs versión anterior):
//   1) Performance: maxCount memoizado, for-of en vez de spread.
//   2) Limpieza al apagar: layer imperativo con L.geoJSON + remove().
//   3) Click pasante: canvas con padding 0, bringToBack, interactive false.
// ============================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { FeatureCollection, Polygon } from "geojson";
import { loadParqueGeoJson, type ParqueHexProps } from "@/services/parqueData";

interface Props {
  visible: boolean;
}

function buildColorFn(maxCount: number) {
  const logMax = Math.log1p(maxCount);
  return (count: number): string => {
    const t = logMax > 0 ? Math.log1p(count) / logMax : 0;
    if (t < 0.5) {
      const u = t * 2;
      const r = Math.round(34 + (250 - 34) * u);
      const g = Math.round(197 + (204 - 197) * u);
      const b = Math.round(94 + (21 - 94) * u);
      return `rgb(${r},${g},${b})`;
    }
    const u = (t - 0.5) * 2;
    const r = Math.round(250 + (239 - 250) * u);
    const g = Math.round(204 + (68 - 204) * u);
    const b = Math.round(21 + (68 - 21) * u);
    return `rgb(${r},${g},${b})`;
  };
}

export default function ParqueHeatmapLayer({ visible }: Props) {
  const map = useMap();
  const [data, setData] = useState<FeatureCollection<Polygon, ParqueHexProps> | null>(null);
  const layerRef = useRef<L.GeoJSON | null>(null);
  const rendererRef = useRef<L.Canvas | null>(null);

  useEffect(() => {
    if (!visible || data) return;
    let cancelled = false;
    loadParqueGeoJson()
      .then((j) => {
        if (!cancelled) setData(j);
      })
      .catch((err) => console.error("[ParqueHeatmap] fetch error:", err));
    return () => {
      cancelled = true;
    };
  }, [visible, data]);

  const maxCount = useMemo(() => {
    if (!data) return 0;
    let m = 0;
    for (const f of data.features) {
      const c = f.properties.count;
      if (c > m) m = c;
    }
    return m;
  }, [data]);

  const colorFn = useMemo(() => buildColorFn(maxCount), [maxCount]);

  useEffect(() => {
    if (!map) return;

    if (layerRef.current) {
      layerRef.current.remove();
      layerRef.current = null;
    }

    if (!visible || !data) return;

    if (!rendererRef.current) {
      rendererRef.current = L.canvas({ padding: 0, tolerance: 0 });
    }

    const layer = L.geoJSON(data as any, {
      renderer: rendererRef.current,
      interactive: false,
      style: (feature: any) => ({
        fillColor: colorFn(feature.properties.count),
        fillOpacity: 0.55,
        color: "transparent",
        weight: 0,
        interactive: false,
      }),
    });

    layer.addTo(map);
    if ((layer as any).bringToBack) layer.bringToBack();

    layerRef.current = layer;

    return () => {
      if (layerRef.current) {
        layerRef.current.remove();
        layerRef.current = null;
      }
    };
  }, [map, visible, data, colorFn]);

  useEffect(() => {
    return () => {
      if (layerRef.current) {
        layerRef.current.remove();
        layerRef.current = null;
      }
      rendererRef.current = null;
    };
  }, []);

  return null;
}
