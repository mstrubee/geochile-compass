import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { MultiPolygon, Polygon } from "geojson";

export interface ShownPoiIsochrone {
  /** Identidad estable: un local puede tener varias bandas encendidas. */
  key: string;
  poiName: string;
  minutes: number;
  geometry: Polygon | MultiPolygon;
  color: string;
}

/**
 * Isócronas de locales mostradas a demanda desde el menú contextual.
 *
 * Se dibujan todas en un solo efecto y no una capa por isócrona: cada capa
 * traería su propio renderer, y con varias encendidas eso multiplica canvas del
 * tamaño del viewport (ver la fuga corregida en 92084f2). Acá comparten uno.
 *
 * Renderer canvas y no SVG: la exportación del informe compone la foto a partir
 * de los `<canvas>`/`<img>` del mapa, así que un polígono en SVG saldría del
 * mapa pero no del informe.
 */
export const PoiIsochroneLayer = ({
  isochrones,
  onIsochroneClick,
}: {
  isochrones: ShownPoiIsochrone[];
  onIsochroneClick?: (iso: ShownPoiIsochrone) => void;
}) => {
  const map = useMap();
  // El callback se lee por ref para que cambiarlo no obligue a redibujar todas
  // las isócronas encendidas.
  const clickRef = useRef(onIsochroneClick);
  clickRef.current = onIsochroneClick;

  const signature = isochrones.map((i) => i.key).join("|");

  useEffect(() => {
    if (isochrones.length === 0) return;
    const renderer = L.canvas({ padding: 0.5 });
    const group = L.featureGroup().addTo(map);

    for (const iso of isochrones) {
      const layer = L.geoJSON(iso.geometry as never, {
        style: {
          renderer,
          color: iso.color,
          weight: 2.5,
          fillColor: iso.color,
          fillOpacity: 0.12,
          dashArray: "6 4",
        } as never,
      });
      layer.bindTooltip(`${iso.poiName} · ${iso.minutes} min`, { sticky: true });
      layer.on("click", (e) => {
        // Sin esto el click cae al mapa y, según la herramienta activa, podría
        // crear un POI o mover el picker de coordenadas.
        L.DomEvent.stopPropagation(e);
        clickRef.current?.(iso);
      });
      layer.addTo(group);
    }

    return () => {
      group.remove();
      // El renderer queda como capa propia del mapa y sobrevive al group:
      // quitarlo acá es lo que evita el canvas huérfano suscrito a zoom/moveend.
      map.removeLayer(renderer);
    };
    // `signature` cubre el alta/baja de isócronas; las geometrías no cambian
    // para una misma key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, map]);

  return null;
};
