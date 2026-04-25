import { useRef } from "react";
import { GeoJSON } from "react-leaflet";
import type { Feature, Geometry } from "geojson";
import type { GeoJSON as LeafletGeoJSON, Layer, PathOptions } from "leaflet";
import { useComunasGeoIndex, type ComunaProps } from "@/hooks/useComunasGeoIndex";

interface ChileCommunesLayerProps {
  visible: boolean;
}

/**
 * Polígonos de las 346 comunas de Chile (GeoJSON estático en /public).
 * Popup muestra nombre + código.
 */
export const ChileCommunesLayer = ({ visible }: ChileCommunesLayerProps) => {
  const { ready, fc, nombresPorCodigo } = useComunasGeoIndex(visible);
  const geoJsonRef = useRef<LeafletGeoJSON | null>(null);

  if (!visible || !ready || !fc) return null;

  const style = (): PathOptions => ({
    fillColor: "hsl(199 89% 60%)",
    fillOpacity: 0.15,
    color: "hsl(199 89% 50%)",
    weight: 0.8,
  });

  const onEachFeature = (feature: Feature<Geometry, ComunaProps>, layer: Layer) => {
    const codigo =
      feature.properties.codigo_comuna ?? feature.properties.cod_comuna ?? "";
    layer.bindPopup(() => {
      const nombre =
        nombresPorCodigo[codigo] ?? feature.properties.nom_comuna ?? "Comuna desconocida";
      return `<div style="min-width:140px"><strong>${nombre}</strong><br/><span style="font-size:10px;opacity:0.7">Código: ${codigo}</span></div>`;
    });
    layer.on({
      mouseover: (e) => {
        const l = e.target as { setStyle: (s: PathOptions) => void; bringToFront: () => void };
        l.setStyle({ weight: 2, color: "hsl(199 89% 70%)", fillOpacity: 0.3 });
        l.bringToFront();
      },
      mouseout: (e) => {
        geoJsonRef.current?.resetStyle(e.target);
      },
    });
  };

  return (
    <GeoJSON
      ref={(r) => {
        geoJsonRef.current = r as unknown as LeafletGeoJSON | null;
      }}
      data={fc}
      style={style}
      onEachFeature={onEachFeature}
    />
  );
};
