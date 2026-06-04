/**
 * GastoEndogenoHeatLayer.tsx
 * ==========================
 * Heatmap de Concentración de Gasto Potencial Mensual Endógeno.
 *
 * Metodología: n_hog × EPF_AUTOPLANET[gse] por manzana (Censo 2024).
 * Coeficientes: ABC1 $49.237 · C1 $35.000 · C2 $25.057 · C3 $12.732 · D $4.117.
 * Grid 200m · 49.297 celdas · normalizado log(1+gasto).
 *
 * Gradiente: azul/morado (bajo) → verde → amarillo → naranja → rojo (alto)
 * igual al de la imagen de referencia de Arica.
 */

import { useEffect, useRef, useState } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import rawPoints from "@/data/gasto_endogeno_heatmap.json";
import { useHeatmapSettings } from "@/hooks/useHeatmapSettings";
import { HeatmapSettingsPanel } from "./HeatmapSettingsPanel";

type RawPoint = [number, number, number];
const POINTS = rawPoints as RawPoint[];

// ── Gradiente igual a la imagen de referencia ─────────────────────────────────
// Oscuro/transparente → azul → verde → amarillo → naranja → rojo
const GRADIENT = {
  0.00: "rgba(0,0,0,0)",
  0.10: "rgba(63,0,255,0.4)",
  0.25: "#3900a8",
  0.40: "#0099d4",
  0.55: "#00b300",
  0.68: "#cccc00",
  0.80: "#ff9900",
  0.92: "#ff3300",
  1.00: "#cc0000",
};

function heatOpts(zoom: number, radius: number, blur: number, opacity: number): L.HeatMapOptions {
  // Escalar radius/blur por zoom para mantener aspecto correcto
  const zScale = Math.pow(1.4, zoom - 12);  // doble de radio cada 2 zooms
  return {
    radius: Math.round(radius * zScale),
    blur:   Math.round(blur * zScale),
    maxZoom: 18,
    max: 1.0,
    minOpacity: opacity * 0.4,
    gradient: GRADIENT,
  };
}

// ── Componente ────────────────────────────────────────────────────────────────

interface GastoEndogenoHeatLayerProps {
  visible: boolean;
  isAdmin?: boolean;
}

export const GastoEndogenoHeatLayer = ({
  visible,
  isAdmin = false,
}: GastoEndogenoHeatLayerProps) => {
  const map = useMap();
  const heatRef = useRef<L.HeatLayer | null>(null);
  const [zoom, setZoom] = useState(() => map.getZoom());
  const [showSettings, setShowSettings] = useState(false);

  const { settings, setSettings, save, saving, error } = useHeatmapSettings("gasto_endogeno");

  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  const shouldShow = visible && zoom >= settings.min_zoom;

  useEffect(() => {
    if (!shouldShow) {
      if (heatRef.current) { map.removeLayer(heatRef.current); heatRef.current = null; }
      return;
    }

    const opts = heatOpts(zoom, settings.radius, settings.blur, settings.opacity);

    if (heatRef.current) {
      heatRef.current.setOptions(opts);
      (heatRef.current as L.HeatLayer & { redraw: () => void }).redraw();
      return;
    }

    const layer = L.heatLayer(POINTS, opts);
    layer.addTo(map);
    heatRef.current = layer;

    return () => {
      if (heatRef.current) { map.removeLayer(heatRef.current); heatRef.current = null; }
    };
  }, [shouldShow, map, zoom, settings]);

  return (
    <>
      {visible && zoom < settings.min_zoom && (
        <div style={{
          position: "absolute", bottom: 32, left: "50%", transform: "translateX(-50%)",
          zIndex: 10000, background: "rgba(10,15,30,0.88)", backdropFilter: "blur(8px)",
          border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8,
          padding: "8px 16px", color: "#94a3b8", fontSize: 11,
          pointerEvents: "none", whiteSpace: "nowrap",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span>🔍</span>
          <span>Acerca el mapa para ver gasto endógeno (zoom ≥ {settings.min_zoom})</span>
        </div>
      )}

      {isAdmin && visible && (
        <button
          onClick={() => setShowSettings(v => !v)}
          title="Ajustar parámetros del heatmap"
          style={{
            position: "absolute", bottom: 60, right: 12, zIndex: 10000,
            background: showSettings ? "#166534" : "rgba(10,15,30,0.90)",
            border: `1px solid ${showSettings ? "#22c55e" : "rgba(255,255,255,0.15)"}`,
            borderRadius: 8, padding: "6px 10px",
            color: showSettings ? "#fff" : "#94a3b8",
            cursor: "pointer", fontSize: 11,
            display: "flex", alignItems: "center", gap: 5,
            backdropFilter: "blur(8px)",
          }}
        >
          ⚙️ <span>Ajustar</span>
        </button>
      )}

      {isAdmin && visible && showSettings && (
        <HeatmapSettingsPanel
          layerLabel="Gasto Endógeno Autoplanet"
          layerKey="gasto_endogeno"
          settings={settings}
          saving={saving}
          error={error}
          currentZoom={zoom}
          onChange={setSettings}
          onSave={save}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );
};

// ── Leyenda ───────────────────────────────────────────────────────────────────

export const GastoEndogenoLegend = () => (
  <div style={{
    background: "rgba(10,15,30,0.92)", border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 8, padding: "10px 12px", fontSize: 11, color: "#e2e8f0",
    backdropFilter: "blur(10px)", minWidth: 210,
  }}>
    <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>
      💰 Gasto Endógeno Autoplanet
    </div>
    <div style={{ fontSize: 9, color: "#64748b", marginBottom: 8, lineHeight: 1.4 }}>
      Gasto mensual potencial en canasta automotriz<br />
      por manzana · EPF INE 2021-2022 · GSE ABC1–D
    </div>
    <div style={{
      height: 12, borderRadius: 4, marginBottom: 4,
      background: "linear-gradient(to right, #3900a8, #0099d4, #00b300, #cccc00, #ff9900, #cc0000)",
    }} />
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#64748b", marginBottom: 8 }}>
      <span>Bajo</span>
      <span>Alto</span>
    </div>
    <div style={{ fontSize: 9, color: "#475569", lineHeight: 1.5 }}>
      <div>🔵 Bajo → 🟢 Medio → 🟡 Alto → 🔴 Muy alto</div>
      <div style={{ marginTop: 3 }}>
        ABC1 $49.237 · C2 $25.057 · C3 $12.732 · D $4.117 / hog/mes
      </div>
    </div>
  </div>
);
