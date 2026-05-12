// ============================================================================
// ParqueHeatmapLayer.tsx
//
// Capa toggleable que renderiza el heatmap del parque automotor desde el
// GeoJSON pre-procesado en /public/parque/parque_h3_agregado.geojson
//
// Implementación: el GeoJSON viene como FeatureCollection de polígonos
// (cuadrados de ~500m) con propiedad `count`. Renderizamos como polígonos
// con fill semitransparente proporcional al count en escala logarítmica.
//
// Uso desde el MapView:
//   <ParqueHeatmapLayer visible={parqueLayerActive} />
// ============================================================================
import { useEffect, useState } from "react";
import { GeoJSON } from "react-leaflet";
import type { FeatureCollection, Feature, Polygon } from "geojson";

interface Props {
  visible: boolean;
}

interface HexProps {
  count: number;
  edad_med: number;
  edad_p25: number;
  edad_p75: number;
  top_marca: string;
}

export default function ParqueHeatmapLayer({ visible }: Props) {
  const [data, setData] = useState<FeatureCollection<Polygon, HexProps> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || data || loading) return;
    setLoading(true);
    fetch("/parque/parque_h3_agregado.geojson")
      .then(r => r.json())
      .then(j => setData(j))
      .catch(err => console.error("[ParqueHeatmap] error:", err))
      .finally(() => setLoading(false));
  }, [visible, data, loading]);

  if (!visible || !data) return null;

  // Escala logarítmica para el color
  const counts = data.features.map(f => f.properties.count);
  const maxCount = Math.max(...counts);
  const logMax = Math.log1p(maxCount);

  const colorFor = (count: number): string => {
    const t = Math.log1p(count) / logMax;
    // Verde→Amarillo→Rojo
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

  return (
    <GeoJSON
      data={data as any}
      style={(feature: any) => ({
        fillColor: colorFor(feature.properties.count),
        fillOpacity: 0.55,
        color: "transparent",
        weight: 0,
      })}
      onEachFeature={(feature: Feature<Polygon, HexProps>, layer) => {
        const p = feature.properties;
        layer.bindTooltip(
          `<div class="text-xs">
            <strong>${p.count.toLocaleString("es-CL")}</strong> vehículos<br/>
            Edad: ${p.edad_p25.toFixed(0)} · ${p.edad_med.toFixed(0)} · ${p.edad_p75.toFixed(0)} años<br/>
            Top marca: ${p.top_marca}
          </div>`,
          { sticky: true }
        );
      }}
    />
  );
}
