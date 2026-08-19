import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { MultiPolygon, Polygon } from "geojson";

/**
 * Isócrona de un local mostrada a demanda desde el menú contextual.
 *
 * Renderer canvas y no SVG: la exportación del informe compone la foto a partir
 * de los `<canvas>`/`<img>` del mapa, así que un polígono en SVG saldría del
 * mapa pero no del informe.
 */
export const PoiIsochroneLayer = ({
  geometry,
  color = "#38bdf8",
  label,
}: {
  geometry: Polygon | MultiPolygon | null;
  color?: string;
  label?: string | null;
}) => {
  const map = useMap();

  useEffect(() => {
    if (!geometry) return;
    const renderer = L.canvas({ padding: 0.5 });
    const layer = L.geoJSON(geometry as never, {
      style: {
        renderer,
        color,
        weight: 2.5,
        fillColor: color,
        fillOpacity: 0.12,
        dashArray: "6 4",
      } as never,
    });
    if (label) layer.bindTooltip(label, { sticky: true });
    layer.addTo(map);

    return () => {
      layer.remove();
      // Igual que en IsochroneLayer: al pasar un `renderer` a un path, Leaflet
      // lo agrega como capa propia del mapa. Quitar solo la capa dejaría el
      // renderer huérfano —con su canvas en el DOM y suscrito a zoom/moveend—,
      // que es la fuga que se corrigió en el commit 92084f2.
      map.removeLayer(renderer);
    };
  }, [geometry, color, label, map]);

  return null;
};
