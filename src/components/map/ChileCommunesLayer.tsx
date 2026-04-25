import { useEffect, useRef } from "react";
import { GeoJSON } from "react-leaflet";
import L from "leaflet";
import type { Feature, Geometry } from "geojson";
import type { GeoJSON as LeafletGeoJSON, Layer, PathOptions } from "leaflet";
import { useComunasGeoIndex, type ComunaProps } from "@/hooks/useComunasGeoIndex";
import {
  colorForIneCommune,
  formatIneValue,
  INE_VARIABLE_LABEL,
  type IneVariable,
} from "@/utils/ineScales";

interface ChileCommunesLayerProps {
  visible: boolean;
  variable: IneVariable;
}

const HIGHLIGHT_STYLE: PathOptions = {
  weight: 2,
  color: "hsl(199 89% 70%)",
  fillOpacity: 0.75,
};

/**
 * Polígonos de las 346 comunas de Chile (GeoJSON estático en /public),
 * coloreadas por la variable INE seleccionada (Población, Densidad, Ingreso, NSE).
 * El destacado por hover persiste hasta que el mouse entra a otra comuna.
 */
export const ChileCommunesLayer = ({ visible, variable }: ChileCommunesLayerProps) => {
  const { ready, fc, nombresPorCodigo, getIneStats } = useComunasGeoIndex(visible);
  const geoJsonRef = useRef<LeafletGeoJSON | null>(null);
  const hoveredLayerRef = useRef<Layer | null>(null);

  // Re-aplicar estilos cuando cambia la variable (sin recrear la capa)
  useEffect(() => {
    if (geoJsonRef.current) {
      geoJsonRef.current.setStyle(styleForFeature);
      hoveredLayerRef.current = null; // limpia destacado previo
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variable, ready]);

  if (!visible || !ready || !fc) return null;

  const styleForFeature = (feature?: Feature<Geometry, ComunaProps>): PathOptions => {
    const codigo =
      feature?.properties?.codigo_comuna ?? feature?.properties?.cod_comuna ?? "";
    const stats = getIneStats(codigo);
    const fill = colorForIneCommune(variable, stats);
    return {
      fillColor: fill,
      fillOpacity: 0.55,
      color: "hsl(var(--border))",
      weight: 0.6,
    };
  };

  const onEachFeature = (feature: Feature<Geometry, ComunaProps>, layer: Layer) => {
    const codigo =
      feature.properties.codigo_comuna ?? feature.properties.cod_comuna ?? "";
    layer.bindPopup(() => {
      const nombre =
        nombresPorCodigo[codigo] ?? feature.properties.nom_comuna ?? "Comuna desconocida";
      const stats = getIneStats(codigo);
      const value = formatIneValue(variable, stats);
      return `<div style="min-width:160px">
        <strong>${nombre}</strong><br/>
        <span style="font-size:11px">${INE_VARIABLE_LABEL[variable]}: <strong>${value}</strong></span><br/>
        <span style="font-size:10px;opacity:0.7">Código: ${codigo}</span>
      </div>`;
    });
    layer.on({
      mouseover: (e) => {
        const newLayer = e.target as L.Path;
        const prev = hoveredLayerRef.current;
        if (prev && prev !== newLayer) {
          geoJsonRef.current?.resetStyle(prev as never);
        }
        newLayer.setStyle(HIGHLIGHT_STYLE);
        newLayer.bringToFront();
        hoveredLayerRef.current = newLayer;
      },
      // mouseout intencionalmente NO restaura el estilo: el destacado persiste
      // hasta que el mouse entra en otra comuna.
    });
  };

  return (
    <GeoJSON
      key={variable}
      ref={(r) => {
        geoJsonRef.current = r as unknown as LeafletGeoJSON | null;
      }}
      data={fc}
      style={styleForFeature}
      onEachFeature={onEachFeature}
    />
  );
};
