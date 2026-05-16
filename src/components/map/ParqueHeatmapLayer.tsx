// ============================================================================
// ParqueHeatmapLayer.tsx
//
// Heatmap del parque automotor (canvas renderer, siempre no interactivo).
// La info por hexágono y otras acciones se exponen en el menú contextual
// del mapa (click derecho), no en la capa.
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { GeoJSON } from "react-leaflet";
import L from "leaflet";
import type { FeatureCollection, Polygon } from "geojson";
import { loadParqueGeoJson, type ParqueHexProps } from "@/services/parqueData";

interface Props {
  visible: boolean;
}

export default function ParqueHeatmapLayer({ visible }: Props) {
  const [data, setData] = useState<FeatureCollection<Polygon, ParqueHexProps> | null>(null);
  const [loading, setLoading] = useState(false);

  const renderer = useMemo(() => L.canvas({ padding: 0.5 }), []);

  useEffect(() => {
    if (!visible || data || loading) return;
    setLoading(true);
    loadParqueGeoJson()
      .then((j) => setData(j))
      .catch((err) => console.error("[ParqueHeatmap] error:", err))
      .finally(() => setLoading(false));
  }, [visible, data, loading]);

  if (!visible || !data) return null;

  const counts = data.features.map((f) => f.properties.count);
  const maxCount = Math.max(...counts);
  const logMax = Math.log1p(maxCount);

  const colorFor = (count: number): string => {
    const t = Math.log1p(count) / logMax;
    if (t < 0.5) {
      const u = t * 2;
      const r = Math.round(34 + (250 - 34) * u);
      const g = Math.round(197 + (204 - 197) * u);
      const b = Math.round(94 + (21 - 94) * u);
      return `rgb(${r},${g},${b})`;
    } else {
      const u = (t - 0.5) * 2;
      const r = Math.round(250 + (239 - 250) * u);
      const g = Math.round(204 + (68 - 204) * u);
      const b = Math.round(21 + (68 - 21) * u);
      return `rgb(${r},${g},${b})`;
    }
  };

  const styleFor = (feature: any) => ({
    renderer,
    fillColor: colorFor(feature.properties.count),
    fillOpacity: 0.55,
    color: "transparent",
    weight: 0,
    interactive: false,
  });

  return (
    <GeoJSON
      data={data as any}
      style={styleFor as any}
      interactive={false}
    />
  );
}
