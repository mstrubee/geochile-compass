/**
 * CrimeHeatLayer.tsx
 * ==================
 * Heatmap de concentración de riesgo delictivo con:
 * - 4 tipos de crimen seleccionables (total / robos / hurtos / lugar)
 * - Leyenda clickeable para filtrar por nivel de riesgo
 * - Gradiente custom sin azul (verde → amarillo → rojo)
 * - Normalización regional (contraste real dentro de cada región)
 * - Puntos clipeados al polígono de la comuna
 */

import { useEffect, useRef, useState } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";

// JSON embebido: sin fetch, sin CSP, carga instantánea (~400 KB gzipped)
import rawData from "@/data/crime_heatmap_points.json";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type CrimeType = "total" | "robos" | "hurtos" | "lugar";
export type RiskFilter = "Muy Alto" | "Alto" | "Medio" | "Bajo" | "Muy Bajo";

const CRIME_TYPE_LABELS: Record<CrimeType, string> = {
  total:  "Todos los delitos",
  robos:  "Robos con violencia",
  hurtos: "Hurtos",
  lugar:  "Robos en lugar",
};

const CRIME_TYPE_ICONS: Record<CrimeType, string> = {
  total:  "🔴",
  robos:  "🔪",
  hurtos: "👜",
  lugar:  "🏠",
};

// Umbrales de intensidad para clasificar los niveles de riesgo
const RISK_LEVELS: { label: RiskFilter; min: number; max: number; color: string }[] = [
  { label: "Muy Alto", min: 0.80, max: 1.00, color: "#d32f2f" },
  { label: "Alto",     min: 0.60, max: 0.80, color: "#f57c00" },
  { label: "Medio",    min: 0.40, max: 0.60, color: "#fbc02d" },
  { label: "Bajo",     min: 0.20, max: 0.40, color: "#558b2f" },
  { label: "Muy Bajo", min: 0.00, max: 0.20, color: "#1b5e20" },
];

// ── Datos ─────────────────────────────────────────────────────────────────────

type PointArray = [number, number, number][];
const DATA = rawData as Record<CrimeType, PointArray>;

// Pre-filtrar por nivel de riesgo (intensidad)
function filterByRisk(points: PointArray, active: Set<RiskFilter>): PointArray {
  if (active.size === RISK_LEVELS.length) return points; // todos activos → sin filtro
  return points.filter(([,, intensity]) =>
    RISK_LEVELS.some(lvl => active.has(lvl.label) && intensity >= lvl.min && intensity <= lvl.max)
  );
}

// ── Gradiente custom (sin azul confuso) ───────────────────────────────────────

// Verde oscuro → verde → amarillo → naranja → rojo vivo
const HEAT_GRADIENT = {
  0.00: "rgba(27,94,32,0)",      // transparente (sin riesgo)
  0.10: "rgba(27,94,32,0.5)",    // verde oscuro
  0.25: "#388e3c",               // verde
  0.45: "#aed581",               // verde claro
  0.60: "#fdd835",               // amarillo
  0.75: "#f57c00",               // naranja
  0.90: "#e53935",               // rojo
  1.00: "#b71c1c",               // rojo oscuro
};

// ── Opciones de zoom ──────────────────────────────────────────────────────────

function heatOptions(zoom: number): L.HeatMapOptions {
  const gradient = HEAT_GRADIENT;
  if (zoom >= 13) return { radius: 20, blur: 18, maxZoom: 18, max: 1.0, minOpacity: 0.35, gradient };
  if (zoom >= 10) return { radius: 30, blur: 25, maxZoom: 18, max: 1.0, minOpacity: 0.30, gradient };
  if (zoom >= 7)  return { radius: 45, blur: 38, maxZoom: 18, max: 1.0, minOpacity: 0.25, gradient };
  return                 { radius: 60, blur: 50, maxZoom: 18, max: 1.0, minOpacity: 0.20, gradient };
}

// ── Componente principal ──────────────────────────────────────────────────────

interface CrimeHeatLayerProps {
  visible: boolean;
  crimeType?: CrimeType;
  activeRisk?: Set<RiskFilter>;
}

export const CrimeHeatLayer = ({
  visible,
  crimeType = "total",
  activeRisk,
}: CrimeHeatLayerProps) => {
  const map = useMap();
  const heatRef = useRef<L.HeatLayer | null>(null);

  useEffect(() => {
    if (!visible) {
      if (heatRef.current) { map.removeLayer(heatRef.current); heatRef.current = null; }
      return;
    }

    // Obtener y filtrar puntos
    const rawPts = DATA[crimeType] ?? DATA.total;
    const pts = activeRisk ? filterByRisk(rawPts, activeRisk) : rawPts;

    if (heatRef.current) {
      // Actualizar datos sin recrear la capa
      (heatRef.current as L.HeatLayer & { setLatLngs: (d: PointArray) => void }).setLatLngs(pts);
      heatRef.current.setOptions(heatOptions(map.getZoom()));
      (heatRef.current as L.HeatLayer & { redraw: () => void }).redraw();
      return;
    }

    const layer = L.heatLayer(pts, heatOptions(map.getZoom()));
    layer.addTo(map);
    heatRef.current = layer;

    const onZoom = () => {
      if (heatRef.current) heatRef.current.setOptions(heatOptions(map.getZoom()));
    };
    map.on("zoomend", onZoom);
    return () => {
      map.off("zoomend", onZoom);
      if (heatRef.current) { map.removeLayer(heatRef.current); heatRef.current = null; }
    };
  }, [visible, map, crimeType, activeRisk]);

  return null;
};

// ── Panel de control (tipo + filtro de riesgo) ────────────────────────────────

interface CrimeControlPanelProps {
  crimeType: CrimeType;
  onCrimeTypeChange: (t: CrimeType) => void;
  activeRisk: Set<RiskFilter>;
  onRiskToggle: (r: RiskFilter) => void;
}

export const CrimeControlPanel = ({
  crimeType,
  onCrimeTypeChange,
  activeRisk,
  onRiskToggle,
}: CrimeControlPanelProps) => {
  const panelStyle: React.CSSProperties = {
    background: "rgba(10,15,30,0.92)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 10,
    padding: "12px 14px",
    fontSize: 11,
    color: "#e2e8f0",
    backdropFilter: "blur(10px)",
    minWidth: 210,
  };

  return (
    <div style={panelStyle}>
      {/* Título */}
      <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 14 }}>🚨</span>
        Riesgo Delictivo
        <span style={{
          marginLeft: "auto", fontSize: 9, padding: "1px 6px",
          background: "rgba(239,68,68,0.2)", border: "1px solid #ef4444",
          borderRadius: 4, color: "#fca5a5", fontWeight: 600,
        }}>CEAD 2022-2024</span>
      </div>

      {/* Selector de tipo de crimen */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 9, color: "#64748b", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Tipo de delito
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {(Object.keys(CRIME_TYPE_LABELS) as CrimeType[]).map((t) => (
            <button
              key={t}
              onClick={() => onCrimeTypeChange(t)}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "5px 8px", borderRadius: 6, border: "none",
                background: crimeType === t ? "rgba(99,102,241,0.25)" : "transparent",
                color: crimeType === t ? "#a5b4fc" : "#94a3b8",
                cursor: "pointer", fontSize: 11, textAlign: "left",
                outline: crimeType === t ? "1px solid rgba(99,102,241,0.4)" : "none",
                transition: "all 0.15s",
              }}
            >
              <span>{CRIME_TYPE_ICONS[t]}</span>
              <span style={{ fontWeight: crimeType === t ? 600 : 400 }}>{CRIME_TYPE_LABELS[t]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Separador */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", marginBottom: 10 }} />

      {/* Filtro por nivel de riesgo */}
      <div>
        <div style={{ fontSize: 9, color: "#64748b", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Nivel de riesgo (clic para filtrar)
        </div>
        {RISK_LEVELS.map(({ label, color }) => {
          const active = activeRisk.has(label);
          return (
            <button
              key={label}
              onClick={() => onRiskToggle(label)}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "5px 8px", borderRadius: 6,
                border: "none", cursor: "pointer",
                background: active ? `${color}22` : "transparent",
                opacity: active ? 1 : 0.4,
                transition: "all 0.15s",
                marginBottom: 2,
              }}
            >
              <div style={{
                width: 12, height: 12, borderRadius: "50%",
                background: color, flexShrink: 0,
                boxShadow: active ? `0 0 6px ${color}` : "none",
                transition: "box-shadow 0.15s",
              }} />
              <span style={{ color: active ? "#e2e8f0" : "#64748b", fontSize: 11, fontWeight: active ? 600 : 400 }}>
                {label}
              </span>
              {!active && (
                <span style={{ marginLeft: "auto", fontSize: 9, color: "#475569" }}>oculto</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Gradiente visual */}
      <div style={{ marginTop: 10 }}>
        <div style={{
          height: 8, borderRadius: 4,
          background: "linear-gradient(to right, #1b5e20, #388e3c, #aed581, #fdd835, #f57c00, #e53935, #b71c1c)",
        }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#475569", marginTop: 3 }}>
          <span>Sin riesgo</span>
          <span>Riesgo máximo</span>
        </div>
      </div>

      {/* Nota metodológica */}
      <div style={{ marginTop: 8, fontSize: 9, color: "#475569", lineHeight: 1.4 }}>
        Intensidad normalizada por región · robos y asaltos ponderados · tasa x1000 hab/año
      </div>
    </div>
  );
};
