import { useEffect, useMemo } from "react";
import { GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import type { Isochrone } from "@/types/isochrones";

interface Props {
  isochrones: Isochrone[];
  fitId: string | null;
  onFitDone: () => void;
}

const opacityForIndex = (idx: number, total: number) => {
  // Anillo más interior (menor tiempo) más opaco
  const base = 0.55;
  const step = 0.18;
  return Math.max(0.18, base - idx * step / Math.max(1, total - 1) * (total - 1));
};

export const IsochroneLayer = ({ isochrones, fitId, onFitDone }: Props) => {
  const map = useMap();

  useEffect(() => {
    if (!fitId) return;
    const target = isochrones.find((i) => i.id === fitId);
    if (!target || !target.features.length) return;
    try {
      const gj = L.geoJSON(target.features as never);
      const b = gj.getBounds();
      if (b.isValid()) map.fitBounds(b, { padding: [40, 40], maxZoom: 15 });
    } catch (e) {
      console.warn("fit isochrone failed", e);
    }
    onFitDone();
  }, [fitId, isochrones, map, onFitDone]);

  const visibleLayers = useMemo(
    () => isochrones.filter((i) => i.visible),
    [isochrones],
  );

  return (
    <>
      {visibleLayers.map((iso) => {
        // Ordenado mayor->menor segundos: pintar primero el grande, luego el chico encima.
        const total = iso.features.length;
        return iso.features.map((f, idx) => {
          const minutes = Math.round((f.properties?.value ?? 0) / 60);
          return (
            <GeoJSON
              key={`${iso.id}-${idx}-${minutes}`}
              data={f}
              style={{
                color: iso.color,
                weight: 1.5,
                opacity: 0.9,
                fillColor: iso.color,
                fillOpacity: opacityForIndex(idx, total),
              }}
              onEachFeature={(_feat, layer) => {
                layer.bindPopup(
                  `<div style="font-size:12px"><b>${minutes} min</b><br/>${
                    iso.mode === "foot-walking"
                      ? "Caminata"
                      : iso.mode === "driving-car"
                        ? "Vehículo"
                        : "Bici"
                  }</div>`,
                );
              }}
            />
          );
        });
      })}

      {/* Marcadores del centro de cada isócrona */}
      {visibleLayers.map((iso) => (
        <CenterDot key={`c-${iso.id}`} iso={iso} />
      ))}
    </>
  );
};

const CenterDot = ({ iso }: { iso: Isochrone }) => {
  const map = useMap();
  useEffect(() => {
    const marker = L.circleMarker([iso.center.lat, iso.center.lng], {
      radius: 5,
      color: iso.color,
      weight: 2,
      fillColor: "#ffffff",
      fillOpacity: 1,
    }).addTo(map);
    return () => {
      marker.remove();
    };
  }, [iso, map]);
  return null;
};
