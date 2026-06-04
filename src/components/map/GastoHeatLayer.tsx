/**
 * GastoHeatLayer.tsx
 * ==================
 * Heatmap del gasto endógeno mensual estimado por comuna.
 * Peso de cada centroide = hogares × coeficiente EPF de la clase NSE dominante.
 * Reusa COMMUNES (~20 comunas RM) como puntos. Cobertura nacional se logra
 * a futuro con el dataset INE completo.
 */

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import { COMMUNES } from "@/data/communes";
import { EPF_AUTOPLANET } from "@/utils/gastoEndogeno";
import type { GseClass } from "@/types/gse";

const NSE_TO_GSE: Record<number, GseClass> = {
  1: "E",
  2: "D",
  3: "C3",
  4: "C2",
  5: "ABC1",
};

interface Props {
  visible: boolean;
}

export const GastoHeatLayer = ({ visible }: Props) => {
  const map = useMap();
  const heatRef = useRef<L.HeatLayer | null>(null);

  useEffect(() => {
    if (!visible) {
      if (heatRef.current) {
        map.removeLayer(heatRef.current);
        heatRef.current = null;
      }
      return;
    }

    // Computar intensidad = hogares × EPF para cada comuna
    const points = COMMUNES.map((c) => {
      const gse = NSE_TO_GSE[c.nse] ?? "C3";
      const epf = EPF_AUTOPLANET[gse] ?? 0;
      const intensity = c.hh * epf; // CLP/mes totales
      return [c.lat, c.lng, intensity];
    });

    // Normalizar para leaflet.heat (0–1). max real ≈ 215_000 × 49k ≈ 1.05e10
    const maxI = Math.max(...points.map((p) => p[2]));
    if (maxI <= 0) return;
    const heatPts = points.map((p) => [p[0], p[1], p[2] / maxI] as L.HeatLatLngTuple);

    const layer = L.heatLayer(heatPts, {
      radius: 45,
      blur: 30,
      maxZoom: 14,
      minOpacity: 0.4,
      max: 1,
      gradient: {
        0.0: "#fee5d9",
        0.25: "#fcae91",
        0.5: "#fb6a4a",
        0.75: "#de2d26",
        1.0: "#a50f15",
      },
    });
    layer.addTo(map);
    heatRef.current = layer;

    return () => {
      if (heatRef.current) {
        map.removeLayer(heatRef.current);
        heatRef.current = null;
      }
    };
  }, [visible, map]);

  return null;
};
