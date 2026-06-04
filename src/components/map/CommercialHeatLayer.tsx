/**
 * CommercialHeatLayer.tsx
 * =======================
 * Heatmap de concentración de atractores comerciales.
 *
 * Fuente: OpenStreetMap Overpass API — shops, amenities, offices, tourism.
 * 16 regiones · ~100.000 POIs → grid 500m → ~8.000 puntos de densidad.
 * Gradiente: azul (bajo) → verde → amarillo → naranja → rojo (alta concentración)
 */

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";

import rawPoints from "@/data/commercial_heatmap_points.json";

const POINTS = rawPoints as [number, number, number][];

// ── Gradiente comercial (azul→verde→amarillo→rojo) ────────────────────────────
const COMMERCIAL_GRADIENT = {
  0.00: "rgba(0,0,128,0)",
  0.15: "rgba(0,0,200,0.5)",
  0.30: "#1565c0",
  0.45: "#0288d1",
  0.55: "#00897b",
  0.65: "#43a047",
  0.75: "#fdd835",
  0.85: "#f57c00",
  1.00: "#c62828",
};

function heatOpts(zoom: number): L.HeatMapOptions {
  const gradient = COMMERCIAL_GRADIENT;
  if (zoom >= 13) return { radius: 18, blur: 15, maxZoom: 18, max: 1.0, minOpacity: 0.3, gradient };
  if (zoom >= 10) return { radius: 28, blur: 22, maxZoom: 18, max: 1.0, minOpacity: 0.3, gradient };
  if (zoom >= 7)  return { radius: 40, blur: 32, maxZoom: 18, max: 1.0, minOpacity: 0.25, gradient };
  return                 { radius: 55, blur: 45, maxZoom: 18, max: 1.0, minOpacity: 0.2, gradient };
}

// ── Tipos de atractores ───────────────────────────────────────────────────────

export type CommercialFilter = "all" | "shops" | "food" | "services" | "health";

export const COMMERCIAL_FILTER_LABELS: Record<CommercialFilter, string> = {
  all:      "Todos",
  shops:    "🛍️ Comercios",
  food:     "🍽️ Alimentación",
  services: "🏢 Servicios",
  health:   "🏥 Salud/Educ.",
};

// ── Componente ────────────────────────────────────────────────────────────────

interface CommercialHeatLayerProps {
  visible: boolean;
}

export const CommercialHeatLayer = ({ visible }: CommercialHeatLayerProps) => {
  const map = useMap();
  const heatRef = useRef<L.HeatLayer | null>(null);

  useEffect(() => {
    if (!visible) {
      if (heatRef.current) { map.removeLayer(heatRef.current); heatRef.current = null; }
      return;
    }
    if (heatRef.current) return;

    const layer = L.heatLayer(POINTS, heatOpts(map.getZoom()));
    layer.addTo(map);
    heatRef.current = layer;

    const onZoom = () => {
      if (heatRef.current) heatRef.current.setOptions(heatOpts(map.getZoom()));
    };
    map.on("zoomend", onZoom);

    return () => {
      map.off("zoomend", onZoom);
      if (heatRef.current) { map.removeLayer(heatRef.current); heatRef.current = null; }
    };
  }, [visible, map]);

  return null;
};

// ── Leyenda ───────────────────────────────────────────────────────────────────

const SCALE = [
  { color: "#c62828", label: "Muy alta densidad"   },
  { color: "#f57c00", label: "Alta"                 },
  { color: "#fdd835", label: "Media"                },
  { color: "#00897b", label: "Baja"                 },
  { color: "#1565c0", label: "Muy baja / dispersa"  },
];

export const CommercialLegend = () => (
  <div style={{
    background: "rgba(10,15,30,0.92)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 8, padding: "10px 12px",
    fontSize: 11, color: "#e2e8f0",
    backdropFilter: "blur(10px)",
  }}>
    <div style={{ fontWeight: 700, marginBottom: 5, fontSize: 12 }}>
      🏪 Concentración Comercial
    </div>
    <div style={{ marginBottom: 7, color: "#94a3b8", fontSize: 9 }}>
      Comercios, servicios y amenities · OSM 2024 · ~100k POIs
    </div>
    <div style={{
      height: 10, borderRadius: 4, marginBottom: 5,
      background: "linear-gradient(to right,#1565c0,#00897b,#fdd835,#f57c00,#c62828)",
    }} />
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#64748b" }}>
      <span>Disperso</span><span>Concentrado</span>
    </div>
    <div style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 6 }}>
      {SCALE.map(({ color, label }) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: "#94a3b8" }}>{label}</span>
        </div>
      ))}
    </div>
  </div>
);
