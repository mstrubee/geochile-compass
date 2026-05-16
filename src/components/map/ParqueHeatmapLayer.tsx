// ============================================================================
// ParqueHeatmapLayer.tsx
//
// Heatmap del parque automotor (canvas renderer para performance).
// Tooltip simple al hover, popup completo al click, contorno negro al hover.
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { GeoJSON } from "react-leaflet";
import L from "leaflet";
import type { FeatureCollection, Feature, Polygon } from "geojson";

interface Props {
  visible: boolean;
}

interface MarcaCount {
  marca: string;
  count: number;
}

interface HexProps {
  count: number;
  edad_med: number;
  edad_p25: number;
  edad_p75: number;
  top_marcas: MarcaCount[];
}

export default function ParqueHeatmapLayer({ visible }: Props) {
  const [data, setData] = useState<FeatureCollection<Polygon, HexProps> | null>(null);
  const [loading, setLoading] = useState(false);

  // Canvas renderer compartido: baja el tiempo de render de >5s a <1s
  const renderer = useMemo(() => L.canvas({ padding: 0.5 }), []);

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

  const counts = data.features.map(f => f.properties.count);
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
  });

  return (
    <GeoJSON
      data={data as any}
      style={styleFor as any}
      onEachFeature={(feature: Feature<Polygon, HexProps>, layer: any) => {
        const p = feature.properties;
        const count = p.count;
        const marcas = Array.isArray(p.top_marcas) ? p.top_marcas : [];

        // Tooltip al hover: solo cantidad
        layer.bindTooltip(
          `${count.toLocaleString("es-CL")} vehículos`,
          { sticky: true },
        );

        // Popup al click: info completa
        const marcasHtml = marcas.length
          ? `<ol style="margin:6px 0 0 0;padding-left:18px;font-size:11px;line-height:1.4">${marcas
              .map(
                (m) =>
                  `<li><strong>${m.marca}</strong> (${m.count.toLocaleString("es-CL")})</li>`,
              )
              .join("")}</ol>`
          : "";
        const popupHtml = `
          <div style="font-size:12px;min-width:180px">
            <div style="font-weight:600;font-size:13px;margin-bottom:4px">
              ${count.toLocaleString("es-CL")} vehículos
            </div>
            <div style="color:#555">
              Edad: ${p.edad_p25.toFixed(0)} / ${p.edad_med.toFixed(0)} / ${p.edad_p75.toFixed(0)} años
            </div>
            ${marcas.length ? `<div style="margin-top:6px;font-weight:500">Top marcas</div>${marcasHtml}` : ""}
          </div>
        `;
        layer.bindPopup(popupHtml);

        // Highlight al hover: contorno negro
        const baseStyle = styleFor(feature);
        layer.on({
          mouseover: () => {
            layer.setStyle({ color: "#000", weight: 2, fillOpacity: 0.7 });
            if ((layer as any).bringToFront) layer.bringToFront();
          },
          mouseout: () => {
            layer.setStyle(baseStyle);
          },
        });
      }}
    />
  );
}
