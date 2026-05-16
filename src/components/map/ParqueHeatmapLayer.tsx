// ============================================================================
// ParqueHeatmapLayer.tsx
//
// Heatmap del parque automotor (canvas renderer para performance).
// - Sin hover preview (ni tooltip ni highlight).
// - Click derecho: popup con info completa del hexágono.
// - En modo isócrona: capa no interactiva, para que los clicks creen isócronas.
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import type { FeatureCollection, Feature, Polygon } from "geojson";

interface Props {
  visible: boolean;
  /** Si true, la capa no captura eventos (necesario para crear isócronas encima). */
  passthrough?: boolean;
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

export default function ParqueHeatmapLayer({ visible, passthrough = false }: Props) {
  const map = useMap();
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
    interactive: !passthrough,
  });

  // Forzamos remount al cambiar passthrough para que Leaflet aplique
  // `interactive` correctamente sobre el canvas.
  const layerKey = passthrough ? "pt" : "int";

  return (
    <GeoJSON
      key={layerKey}
      data={data as any}
      style={styleFor as any}
      interactive={!passthrough}
      onEachFeature={
        passthrough
          ? undefined
          : (feature: Feature<Polygon, HexProps>, layer: any) => {
              const p = feature.properties;
              const count = p.count;
              const marcas = Array.isArray(p.top_marcas) ? p.top_marcas : [];

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

              // Click derecho: abre popup. Se previene el menú nativo y se
              // detiene la propagación al mapa para no disparar otros handlers.
              layer.on("contextmenu", (e: L.LeafletMouseEvent) => {
                L.DomEvent.preventDefault(e.originalEvent);
                L.DomEvent.stopPropagation(e.originalEvent);
                L.popup({ closeButton: true })
                  .setLatLng(e.latlng)
                  .setContent(popupHtml)
                  .openOn(map);
              });
            }
      }
    />
  );
}
