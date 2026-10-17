import { useEffect, useRef } from "react";
import L from "leaflet";
import { useMap } from "react-leaflet";
import type { SeiaProjectRow } from "@/types/seia";
import { pointStyle, radiusFor, tooltipText } from "@/utils/seiaFilters";

interface Props {
  rows: SeiaProjectRow[];
  onSelect: (row: SeiaProjectRow) => void;
}

/**
 * Puntos de los proyectos del SEIA. Imperativo y con renderer canvas: hasta 3.000 marcadores como componentes React serían pesados.
 * El punto es el ORIGINAL del servicio. Si una revisión humana propuso otro, se dibuja APARTE (verde) unido por una línea
 * punteada: la corrección nunca reemplaza al original.
 */
export const SeiaPointsLayer = ({ rows, onSelect }: Props) => {
  const map = useMap();
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const renderer = L.canvas({ padding: 0.5 });
    const group = L.layerGroup().addTo(map);
    for (const r of rows) {
      const m = L.circleMarker([r.lat, r.lon], { renderer, radius: radiusFor(r.investment_usd), ...pointStyle(r.geo_check_status) });
      m.bindTooltip(tooltipText(r), { sticky: true });
      m.on("click", () => onSelectRef.current(r));
      group.addLayer(m);
      if (r.review_decision === "corrected" && r.review_lat != null && r.review_lon != null) {
        group.addLayer(L.polyline([[r.lat, r.lon], [r.review_lat, r.review_lon]], { renderer, color: "#16a34a", weight: 1, dashArray: "2 4", interactive: false }));
        const p = L.circleMarker([r.review_lat, r.review_lon], { renderer, radius: 5, color: "#ffffff", weight: 1, fillColor: "#16a34a", fillOpacity: 0.9 });
        p.bindTooltip(`Ubicación PROPUESTA por una revisión (el punto original es el naranja): ${r.name ?? r.external_id}`, { sticky: true });
        p.on("click", () => onSelectRef.current(r));
        group.addLayer(p);
      }
    }
    return () => { group.remove(); };
  }, [rows, map]);

  return null;
};
