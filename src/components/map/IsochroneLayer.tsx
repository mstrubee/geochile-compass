import { useEffect, useMemo } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { Isochrone } from "@/types/isochrones";

interface Props {
  isochrones?: Isochrone[];
  fitId?: string | null;
  onFitDone?: () => void;
}

type IsoFeature = Feature<Polygon | MultiPolygon, { value: number }>;

const opacityForIndex = (idx: number, total: number) => {
  const base = 0.55;
  const step = 0.18;
  return Math.max(0.18, base - (idx * step) / Math.max(1, total - 1) * (total - 1));
};

const modeLabel = (mode: Isochrone["mode"]) => {
  if (mode === "foot-walking") return "Caminata";
  if (mode === "driving-car") return "Vehículo";
  return "Bici";
};

export const IsochroneLayer = ({
  isochrones = [],
  fitId = null,
  onFitDone = () => undefined,
}: Props) => {
  const map = useMap();

  const visibleLayers = useMemo(() => {
    if (!Array.isArray(isochrones)) return [] as Isochrone[];
    return isochrones.filter((i) => i?.visible && Array.isArray(i.features) && i.features.length > 0);
  }, [isochrones]);

  useEffect(() => {
    if (!fitId) return;
    const target = visibleLayers.find((i) => i.id === fitId) ?? isochrones.find((i) => i?.id === fitId);
    if (!target || !Array.isArray(target.features) || target.features.length === 0) return;

    try {
      const gj = L.geoJSON(target.features as never);
      const bounds = gj.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
      }
    } catch (e) {
      console.warn("fit isochrone failed", e);
    } finally {
      onFitDone();
    }
  }, [fitId, isochrones, visibleLayers, map, onFitDone]);

  useEffect(() => {
    const group = L.featureGroup().addTo(map);

    visibleLayers.forEach((iso) => {
      const orderedFeatures = [...iso.features].sort(
        (a, b) => (b.properties?.value ?? 0) - (a.properties?.value ?? 0),
      );

      orderedFeatures.forEach((feature, idx) => {
        const minutes = Math.round((feature.properties?.value ?? 0) / 60);
        const layer = L.geoJSON(feature as never, {
          style: {
            color: iso.color,
            weight: 1.5,
            opacity: 0.9,
            fillColor: iso.color,
            fillOpacity: opacityForIndex(idx, orderedFeatures.length),
          },
          onEachFeature: (_feat, childLayer) => {
            childLayer.bindPopup(
              `<div style="font-size:12px"><b>${minutes} min</b><br/>${modeLabel(iso.mode)}</div>`,
            );
          },
        });
        layer.addTo(group);
      });

      L.circleMarker([iso.center.lat, iso.center.lng], {
        radius: 5,
        color: iso.color,
        weight: 2,
        fillColor: "#ffffff",
        fillOpacity: 1,
      }).addTo(group);
    });

    return () => {
      group.remove();
    };
  }, [map, visibleLayers]);

  return null;
};
