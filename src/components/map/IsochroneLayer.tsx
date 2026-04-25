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

// Paleta tipo "semáforo" para diferenciar las bandas de tiempo:
// banda más cercana (índice 0, menos minutos) = verde intenso,
// banda intermedia = ámbar, banda más lejana = rojo. Esto da
// mucho más contraste visual entre las 3 capas que solo variar opacidad.
const BAND_COLORS = ["#10B981", "#F59E0B", "#EF4444", "#7C3AED", "#0EA5E9"];

const styleForBand = (idx: number, total: number, baseColor: string) => {
  // Si hay una sola banda, respetamos el color de la isócrona.
  if (total <= 1) {
    return { fillColor: baseColor, color: baseColor, fillOpacity: 0.5 };
  }
  // idx 0 = banda más interna (menos minutos) → primer color de la paleta.
  const fillColor = BAND_COLORS[idx % BAND_COLORS.length];
  // Opacidades bien separadas para que aún se note la jerarquía dentro
  // de cada color: interna más opaca, externa más translúcida.
  const opacities = [0.65, 0.5, 0.38, 0.3, 0.25];
  const fillOpacity = opacities[Math.min(idx, opacities.length - 1)];
  return { fillColor, color: fillColor, fillOpacity };
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
