import { useEffect, useMemo } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import type { Isochrone } from "@/types/isochrones";

interface Props {
  isochrones?: Isochrone[];
  fitId?: string | null;
  onFitDone?: () => void;
  /**
   * Fuerza un contorno rojo grueso sin relleno, renderizado en un pane por
   * encima de cualquier otra capa (GSE, calor, etc.). Se usa al capturar las
   * fotos del informe de isócrona, para que el límite sea siempre visible
   * sobre cualquier capa activa.
   */
  outlineOnly?: boolean;
}

const OUTLINE_PANE = "isoOutlinePane";
const OUTLINE_STYLE = { color: "#DC2626", weight: 4, opacity: 1, fillOpacity: 0 };

/** Velo sobre todo lo que queda FUERA de la isócrona, para que resalte. */
const MASK_STYLE = {
  color: "transparent", weight: 0, fillColor: "#0B1220", fillOpacity: 0.45,
};

/**
 * Polígono del mundo con un hueco por cada anillo de la isócrona: al pintarlo
 * con `evenodd` queda oscurecido todo menos el área analizada.
 */
const buildMask = (features: IsoFeature[]): GeoJSON.Feature<MultiPolygon> => {
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  const holes: number[][][] = [];
  for (const f of features) {
    const g = f.geometry;
    if (g.type === "Polygon") holes.push(...g.coordinates);
    else for (const poly of g.coordinates) holes.push(...poly);
  }
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "MultiPolygon", coordinates: [[world, ...holes]] },
  };
};

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
  outlineOnly = false,
}: Props) => {
  const map = useMap();

  useEffect(() => {
    if (!map.getPane(OUTLINE_PANE)) {
      const pane = map.createPane(OUTLINE_PANE);
      // Por encima de overlayPane (400, choropleths/heatmaps) y de markerPane (600).
      pane.style.zIndex = "650";
    }
  }, [map]);

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
    // Renderer canvas (no SVG): la exportación del informe compone la foto a
    // partir de los <canvas>/<img> del mapa, así que los vectores deben
    // rasterizarse para aparecer en ella.
    const renderer = L.canvas(outlineOnly ? { pane: OUTLINE_PANE, padding: 0.5 } : { padding: 0.5 });

    visibleLayers.forEach((iso) => {
      const orderedFeatures = [...iso.features].sort(
        (a, b) => (b.properties?.value ?? 0) - (a.properties?.value ?? 0),
      );

      orderedFeatures.forEach((feature, idx) => {
        const minutes = Math.round((feature.properties?.value ?? 0) / 60);
        // orderedFeatures está ordenado de MAYOR a MENOR minutos, así que la
        // banda más interna (menos minutos) es la última. Invertimos el índice
        // para que el verde caiga en la banda corta y el rojo en la larga.
        const bandIdx = orderedFeatures.length - 1 - idx;
        const style = outlineOnly
          ? OUTLINE_STYLE
          : (() => {
              const { color, fillColor, fillOpacity } = styleForBand(
                bandIdx,
                orderedFeatures.length,
                iso.color,
              );
              return { color, weight: 1.8, opacity: 0.95, fillColor, fillOpacity };
            })();
        const layer = L.geoJSON(feature as never, {
          pane: outlineOnly ? OUTLINE_PANE : undefined,
          renderer,
          style,
          onEachFeature: (_feat, childLayer) => {
            childLayer.bindPopup(
              `<div style="font-size:12px"><b>${minutes} min</b><br/>${modeLabel(iso.mode)}</div>`,
            );
          },
        });
        layer.addTo(group);
      });

      if (!outlineOnly) {
        L.circleMarker([iso.center.lat, iso.center.lng], {
          renderer,
          radius: 5,
          color: iso.color,
          weight: 2,
          fillColor: "#ffffff",
          fillOpacity: 1,
        }).addTo(group);
      }
    });

    return () => {
      group.remove();
    };
  }, [map, visibleLayers, outlineOnly]);

  return null;
};
