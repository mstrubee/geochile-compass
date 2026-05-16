// ============================================================================
// ParqueHeatmapLayer.tsx
// ============================================================================
import { useEffect, useMemo, useState } from "react";
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
    if (!map || !visible || !data) return;

    const renderer = L.canvas({ padding: 0, tolerance: 0 });

    const layer = L.geoJSON(data as any, {
      renderer,
      interactive: false,
      style: (feature: any) => ({
        fillColor: colorFn(feature.properties.count),
        fillOpacity: 0.55,
        color: "transparent",
        weight: 0,
        interactive: false,
      }),
    } as any);

    layer.addTo(map);
    if ((layer as any).bringToBack) layer.bringToBack();

    return () => {
      try {
        layer.remove();
      } catch {}
      try {
        const container = (renderer as any)._container as HTMLElement | undefined;
        if (container && container.parentNode) {
          container.parentNode.removeChild(container);
        }
        if ((renderer as any).remove) (renderer as any).remove();
      } catch {}
    };
  }, [map, visible, data, colorFn]);

  return null;
}
