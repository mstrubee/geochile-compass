/**
 * CrimeHeatLayer.tsx
 * ==================
 * Heatmap de concentración de riesgo delictivo.
 *
 * Fuente: CEAD 2022-2024 — 346 comunas desagregadas a ~12.000 puntos ponderados.
 * Técnica: Gaussian sampling centrado en el polo urbano de cada comuna,
 *          intensidad proporcional al risk_score normalizado (0-1).
 *
 * Usa leaflet.heat (ya en el bundle del proyecto).
 * Los puntos están embebidos como módulo TS → sin fetch, sin CSP.
 */

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import type { RiskLevel } from "@/types/crime";
import { RISK_COLORS } from "@/types/crime";

// Importación directa — Vite bundlea el JSON, ~80 KB gzipped, carga instantánea
import rawPoints from "@/data/crime_heatmap_points.json";

// [[lat, lng, intensity], ...] donde intensity ∈ [0, 1]
const POINTS = rawPoints as [number, number, number][];

// ── Opciones del heatmap según zoom ──────────────────────────────────────────

function heatOptions(zoom: number): L.HeatMapOptions {
  // A mayor zoom → menos blur, más detalle de cada punto
  // A menor zoom → más blur, efecto "mancha" continua
  if (zoom >= 13) {
    return { radius: 25, blur: 20, maxZoom: 18, max: 1.0, minOpacity: 0.3 };
  } else if (zoom >= 10) {
    return { radius: 35, blur: 30, maxZoom: 18, max: 1.0, minOpacity: 0.3 };
  } else if (zoom >= 7) {
    return { radius: 50, blur: 40, maxZoom: 18, max: 1.0, minOpacity: 0.25 };
  } else {
    return { radius: 70, blur: 55, maxZoom: 18, max: 1.0, minOpacity: 0.2 };
  }
}

// ── Componente ────────────────────────────────────────────────────────────────

interface CrimeHeatLayerProps {
  visible: boolean;
}

export const CrimeHeatLayer = ({ visible }: CrimeHeatLayerProps) => {
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

    if (heatRef.current) return; // ya está en el mapa

    const zoom = map.getZoom();
    const layer = L.heatLayer(POINTS, heatOptions(zoom));
    layer.addTo(map);
    heatRef.current = layer;

    // Actualizar opciones al hacer zoom para mantener calidad visual
    const onZoom = () => {
      if (heatRef.current) {
        heatRef.current.setOptions(heatOptions(map.getZoom()));
      }
    };
    map.on("zoomend", onZoom);

    return () => {
      map.off("zoomend", onZoom);
      if (heatRef.current) {
        map.removeLayer(heatRef.current);
        heatRef.current = null;
      }
    };
  }, [visible, map]);

  return null;
};

// ── Leyenda ───────────────────────────────────────────────────────────────────

const LEVELS: { label: RiskLevel; desc: string }[] = [
  { label: "Muy Alto", desc: "Centro comercial / turístico" },
  { label: "Alto",     desc: "Corredores urbanos activos"   },
  { label: "Medio",    desc: "Zonas residenciales mixtas"   },
  { label: "Bajo",     desc: "Sectores residenciales"       },
  { label: "Muy Bajo", desc: "Zonas rurales / periféricas"  },
];

export const CrimeHeatLegend = () => (
  <div style={{
    background: "rgba(10,15,30,0.90)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8, padding: "10px 12px",
    fontSize: 11, color: "#e2e8f0",
    backdropFilter: "blur(8px)",
  }}>
    <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 12, letterSpacing: "0.02em" }}>
      Concentración de Riesgo Delictivo
    </div>
    <div style={{ marginBottom: 8, color: "#94a3b8", fontSize: 9 }}>
      Robos y asaltos ponderados · CEAD 2022-2024 · 346 comunas
    </div>

    {/* Gradiente continuo (como el heatmap real) */}
    <div style={{
      height: 12, borderRadius: 4, marginBottom: 6,
      background: "linear-gradient(to right, #1a9850, #91cf60, #fee08b, #fc8d59, #d73027)",
    }} />
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#94a3b8", marginBottom: 8 }}>
      <span>Muy Bajo</span><span>Muy Alto</span>
    </div>

    {LEVELS.map(({ label, desc }) => (
      <div key={label} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
        <div style={{
          width: 12, height: 12, borderRadius: "50%",
          background: RISK_COLORS[label], flexShrink: 0,
          boxShadow: `0 0 6px ${RISK_COLORS[label]}`,
        }} />
        <div>
          <span style={{ fontWeight: 600 }}>{label}</span>
          <span style={{ color: "#64748b", marginLeft: 5, fontSize: 9 }}>{desc}</span>
        </div>
      </div>
    ))}
  </div>
);
