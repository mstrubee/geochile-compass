import { useCallback, useEffect, useRef } from "react";
import { GeoJSON } from "react-leaflet";
import L from "leaflet";
import type { Feature, Geometry } from "geojson";
import type { GeoJSON as LeafletGeoJSON, Layer, PathOptions } from "leaflet";
import { useComunasGeoIndex, type ComunaProps } from "@/hooks/useComunasGeoIndex";
import { useAgroplanetData } from "@/hooks/useAgroplanetData";

export type AgroplanetScoreMode = "combined" | "grandes" | "indap";

interface Props {
  visible: boolean;
  scoreMode: AgroplanetScoreMode;
}

/** Escala quintil → color verde-amarillo-naranja (1=bajo, 5=alto potencial) */
const QUINTIL_COLORS: Record<number, string> = {
  1: "#d1fae5", // verde muy claro
  2: "#6ee7b7",
  3: "#f59e0b",
  4: "#f97316",
  5: "#15803d", // verde oscuro = mayor potencial
};

function colorForScore(score: number): string {
  if (score >= 50) return QUINTIL_COLORS[5];
  if (score >= 30) return QUINTIL_COLORS[4];
  if (score >= 15) return QUINTIL_COLORS[3];
  if (score >= 5)  return QUINTIL_COLORS[2];
  return QUINTIL_COLORS[1];
}

const HIGHLIGHT_STYLE: PathOptions = {
  weight: 2,
  color: "#15803d",
  fillOpacity: 0.85,
};

export const AgroplanetComunasLayer = ({ visible, scoreMode }: Props) => {
  const { ready, fc } = useComunasGeoIndex(visible);
  const { data: agroData, loading } = useAgroplanetData(visible);
  const geoJsonRef = useRef<LeafletGeoJSON | null>(null);
  const hoveredRef = useRef<Layer | null>(null);

  // Derivar score de una comuna según el modo activo
  const getScore = useCallback(
    (cut: string): number => {
      const d = agroData.get(cut);
      if (!d) return 0;
      if (scoreMode === "grandes") return d.score_grandes;
      if (scoreMode === "indap")   return d.score_indap;
      return d.score_combined;
    },
    [agroData, scoreMode],
  );

  // Función de estilo — definida con useCallback para que sea estable y no esté en TDZ
  const styleForFeature = useCallback(
    (feature?: Feature<Geometry, ComunaProps>): PathOptions => {
      const cut =
        feature?.properties?.codigo_comuna ?? feature?.properties?.cod_comuna ?? "";
      const score = getScore(String(cut).padStart(5, "0"));
      return {
        fillColor: colorForScore(score),
        fillOpacity: score > 0 ? 0.65 : 0.10,
        color: "rgba(0,0,0,0.25)",
        weight: 0.5,
      };
    },
    [getScore],
  );

  // Re-estilizar cuando cambia el modo o los datos (sin recrear la capa)
  useEffect(() => {
    if (geoJsonRef.current && !loading) {
      geoJsonRef.current.setStyle(styleForFeature as never);
      hoveredRef.current = null;
    }
  }, [scoreMode, agroData, loading, styleForFeature]);

  if (!visible || !ready || !fc) return null;

  const onEachFeature = (feature: Feature<Geometry, ComunaProps>, layer: Layer) => {
    const cut = String(
      feature?.properties?.codigo_comuna ?? feature?.properties?.cod_comuna ?? ""
    ).padStart(5, "0");
    const d = agroData.get(cut);

    const label = d
      ? `<div class="text-[11px] leading-snug">
          <strong>${d.nombre}</strong><br/>
          <span class="text-muted-foreground">${d.region}</span><br/>
          🌾 Score combinado: <strong>${d.score_combined.toFixed(1)}</strong><br/>
          🏭 Grandes: ${d.score_grandes.toFixed(1)} &nbsp;·&nbsp; INDAP: ${d.score_indap.toFixed(1)}<br/>
          🍎 Frutales riego: ${d.ha_frutales_riego.toLocaleString("es-CL", { maximumFractionDigits: 0 })} ha<br/>
          🌾 Cereales: ${d.ha_cereales_total.toLocaleString("es-CL", { maximumFractionDigits: 0 })} ha
        </div>`
      : `<strong>${cut}</strong> — sin datos`;

    (layer as L.Path).bindTooltip(label, {
      sticky: true,
      opacity: 0.92,
      className: "leaflet-tooltip-agroplanet",
    });

    layer.on({
      mouseover(e) {
        const prev = hoveredRef.current;
        if (prev && prev !== layer) {
          geoJsonRef.current?.resetStyle(prev as never);
        }
        (layer as L.Path).setStyle(HIGHLIGHT_STYLE);
        hoveredRef.current = layer;
        (e as L.LeafletMouseEvent).originalEvent.stopPropagation?.();
      },
      mouseout() {
        if (hoveredRef.current === layer) {
          geoJsonRef.current?.resetStyle(layer as never);
          hoveredRef.current = null;
        }
      },
    });
  };

  return (
    <GeoJSON
      key={`agroplanet-${scoreMode}`}
      ref={(r) => {
        geoJsonRef.current = r as unknown as LeafletGeoJSON | null;
      }}
      data={fc}
      style={styleForFeature as never}
      onEachFeature={onEachFeature}
    />
  );
};
