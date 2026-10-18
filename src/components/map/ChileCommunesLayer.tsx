import { useEffect } from "react";
import { GeoJSON } from "react-leaflet";
import type { Feature, Geometry } from "geojson";
import type { Layer, PathOptions } from "leaflet";
import { useComunasGeoIndex, type ComunaProps } from "@/hooks/useComunasGeoIndex";
import { nameTooltip, useComunaHover } from "@/hooks/useComunaHover";
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

/**
 * Polígonos de las 346 comunas de Chile (GeoJSON estático en /public),
 * coloreadas por la variable INE seleccionada (Población, Densidad, Ingreso, NSE).
 * Hover: resaltado mientras el puntero está sobre la comuna + tooltip con su nombre (useComunaHover, compartido por todas las coropletas comunales).
 */
export const ChileCommunesLayer = ({ visible, variable }: ChileCommunesLayerProps) => {
  const { ready, fc, nombresPorCodigo, getIneStats } = useComunasGeoIndex(visible);

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

  const hover = useComunaHover(styleForFeature as never);

  // Re-aplicar estilos cuando cambia la variable o los datos (sin recrear la capa y sin perder el resaltado vigente)
  useEffect(() => {
    hover.restyle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variable, ready, getIneStats]);

  if (!visible || !ready || !fc) return null;

  const onEachFeature = (feature: Feature<Geometry, ComunaProps>, layer: Layer) => {
    const codigo =
      feature.properties.codigo_comuna ?? feature.properties.cod_comuna ?? "";
    hover.bind(layer, nameTooltip(() => nombresPorCodigo[codigo] ?? feature.properties.nom_comuna ?? "Comuna desconocida"));
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
  };

  return (
    <GeoJSON
      key={variable}
      ref={hover.setRef}
      data={fc}
      style={hover.style as never}
      onEachFeature={onEachFeature}
    />
  );
};
