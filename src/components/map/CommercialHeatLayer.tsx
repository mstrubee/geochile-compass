/**
 * CommercialHeatLayer.tsx
 * =======================
 * Heatmap de atractores comerciales con:
 * - Parámetros ajustables en tiempo real (admin)
 * - Filtro por categoría OSM
 * - minZoom configurable (default: 12 ≈ nivel de comuna)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import rawData from "@/data/commercial_heatmap_points.json";
import { useHeatmapSettings } from "@/hooks/useHeatmapSettings";
import { HeatmapSettingsPanel } from "./HeatmapSettingsPanel";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type CommercialCategory =
  | "all" | "shops" | "food" | "services" | "health_edu" | "other";

export const CATEGORY_META: Record<CommercialCategory, { icon: string; label: string; color: string }> = {
  all:        { icon: "🏪", label: "Todos los atractores",   color: "#1565c0" },
  shops:      { icon: "🛍️", label: "Comercios y tiendas",   color: "#7b1fa2" },
  food:       { icon: "🍽️", label: "Alimentación y cafés",  color: "#e65100" },
  services:   { icon: "🏢", label: "Servicios financieros", color: "#0277bd" },
  health_edu: { icon: "🏥", label: "Salud y educación",     color: "#2e7d32" },
  other:      { icon: "🏨", label: "Turismo y otros",       color: "#5d4037" },
};

type PointArray = [number, number, number][];
const DATA = rawData as Record<CommercialCategory, PointArray>;

// ── Gradiente ─────────────────────────────────────────────────────────────────
const GRADIENT = {
  0.00: "rgba(0,0,128,0)",
  0.12: "rgba(21,101,192,0.5)",
  0.30: "#0277bd",
  0.50: "#00897b",
  0.65: "#c0ca33",
  0.80: "#f9a825",
  0.92: "#e64a19",
  1.00: "#b71c1c",
};

// ── Opciones del heatmap basadas en settings ──────────────────────────────────
function makeOpts(radius: number, blur: number, opacity: number): L.HeatMapOptions {
  return { radius, blur, maxZoom: 20, max: 1.0, minOpacity: opacity * 0.5, gradient: GRADIENT };
}

// ── Filtrado por categoría ────────────────────────────────────────────────────
function getFilteredPoints(active: Set<CommercialCategory>): PointArray {
  const cats = Array.from(active).filter(c => c !== "all") as CommercialCategory[];
  if (active.has("all") || cats.length === 0) return DATA["all"] ?? [];
  if (cats.length === 1) return DATA[cats[0]] ?? [];

  const merged = new Map<string, number>();
  for (const cat of cats)
    for (const [lat, lon, intensity] of (DATA[cat] ?? []))
      merged.set(`${lat},${lon}`, (merged.get(`${lat},${lon}`) ?? 0) + intensity);

  const maxVal = Math.max(...merged.values(), 1);
  const pts: PointArray = [];
  for (const [key, val] of merged) {
    const [lat, lon] = key.split(",").map(Number);
    pts.push([lat, lon, Math.min(1, val / maxVal)]);
  }
  return pts.sort((a, b) => b[2] - a[2]);
}

// ── Componente ────────────────────────────────────────────────────────────────

interface CommercialHeatLayerProps {
  visible: boolean;
  activeCategories: Set<CommercialCategory>;
  isAdmin?: boolean;
}

export const CommercialHeatLayer = ({
  visible, activeCategories, isAdmin = false,
}: CommercialHeatLayerProps) => {
  const map = useMap();
  const heatRef = useRef<L.HeatLayer | null>(null);
  const [zoom, setZoom] = useState(() => map.getZoom());
  const [showSettings, setShowSettings] = useState(false);

  const { settings, setSettings, save, saving, error } = useHeatmapSettings("commercial");

  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  const shouldShow = visible && zoom >= settings.min_zoom;

  // Reconstruir la capa cuando cambian parámetros o categorías
  useEffect(() => {
    if (!shouldShow) {
      if (heatRef.current) { map.removeLayer(heatRef.current); heatRef.current = null; }
      return;
    }

    const pts = getFilteredPoints(activeCategories);
    const opts = makeOpts(settings.radius, settings.blur, settings.opacity);

    if (heatRef.current) {
      (heatRef.current as L.HeatLayer & { setLatLngs: (d: PointArray) => void }).setLatLngs(pts);
      heatRef.current.setOptions(opts);
      (heatRef.current as L.HeatLayer & { redraw: () => void }).redraw();
      return;
    }

    const layer = L.heatLayer(pts, opts);
    layer.addTo(map);
    heatRef.current = layer;

    return () => {
      if (heatRef.current) { map.removeLayer(heatRef.current); heatRef.current = null; }
    };
  }, [shouldShow, map, activeCategories, settings]);

  // Preview en tiempo real desde el panel de ajuste
  const handleSettingsChange = useCallback((s: typeof settings) => {
    setSettings(s);
  }, [setSettings]);

  return (
    <>
      {/* Aviso de zoom insuficiente */}
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
          <span>Acerca el mapa para ver atractores (zoom ≥ {settings.min_zoom}, actual: {zoom})</span>
        </div>
      )}

      {/* Botón de ajuste (solo admin, capa visible) */}
      {isAdmin && visible && (
        <button
          onClick={() => setShowSettings(v => !v)}
          title="Ajustar parámetros del heatmap"
          style={{
            position: "absolute", bottom: 60, right: 12, zIndex: 10000,
            background: showSettings ? "#1d4ed8" : "rgba(10,15,30,0.90)",
            border: `1px solid ${showSettings ? "#3b82f6" : "rgba(255,255,255,0.15)"}`,
            borderRadius: 8, padding: "6px 10px",
            color: showSettings ? "#fff" : "#94a3b8",
            cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 5,
            backdropFilter: "blur(8px)",
          }}
        >
          ⚙️ <span style={{ fontWeight: showSettings ? 700 : 400 }}>Ajustar</span>
        </button>
      )}

      {/* Panel de ajuste */}
      {isAdmin && visible && showSettings && (
        <HeatmapSettingsPanel
          layerLabel="Atractores Comerciales"
          settings={settings}
          saving={saving}
          error={error}
          currentZoom={zoom}
          onChange={handleSettingsChange}
          onSave={(s) => { save(s); }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );
};

// ── Leyenda ───────────────────────────────────────────────────────────────────
export const CommercialLegend = ({
  activeCategories,
  onToggle,
}: {
  activeCategories: Set<CommercialCategory>;
  onToggle: (c: CommercialCategory) => void;
}) => (
  <div style={{
    background: "rgba(10,15,30,0.92)", border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 8, padding: "10px 12px", fontSize: 11, color: "#e2e8f0",
    backdropFilter: "blur(10px)", minWidth: 200,
  }}>
    <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>🏪 Concentración Comercial</div>
    <div style={{ height: 8, borderRadius: 4, marginBottom: 3,
      background: "linear-gradient(to right,#1565c0,#00897b,#c0ca33,#e64a19,#b71c1c)" }} />
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#64748b", marginBottom: 10 }}>
      <span>Disperso</span><span>Concentrado</span>
    </div>
    <div style={{ fontSize: 9, color: "#64748b", marginBottom: 5, textTransform: "uppercase" }}>
      Categoría
    </div>
    {(Object.keys(CATEGORY_META) as CommercialCategory[]).map((cat) => {
      const { icon, label, color } = CATEGORY_META[cat];
      const on = activeCategories.has(cat);
      return (
        <button key={cat} onClick={() => onToggle(cat)} style={{
          display: "flex", alignItems: "center", gap: 7,
          width: "100%", padding: "4px 6px", borderRadius: 5,
          border: "none", cursor: "pointer",
          background: on ? `${color}22` : "transparent",
          opacity: on ? 1 : 0.35, transition: "all 0.15s", marginBottom: 2,
        }}>
          <span style={{ fontSize: 13 }}>{icon}</span>
          <span style={{ color: on ? "#e2e8f0" : "#64748b", fontSize: 10, fontWeight: on ? 600 : 400 }}>{label}</span>
          {on && <div style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%",
            background: color, boxShadow: `0 0 5px ${color}` }} />}
        </button>
      );
    })}
  </div>
);
