/**
 * CommercialHeatLayer.tsx
 * =======================
 * Heatmap de concentración de atractores comerciales con filtros por categoría.
 *
 * Fuente: OSM Overpass 2024 · ~98k POIs · 16 regiones · grid 300m
 * Categorías: todos / comercios / alimentación / servicios / salud+edu / otros
 * Gradiente: azul→verde→amarillo→rojo (diferenciado del crimen)
 */

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import rawData from "@/data/commercial_heatmap_points.json";

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type CommercialCategory =
  | "all"
  | "shops"
  | "food"
  | "services"
  | "health_edu"
  | "other";

export const CATEGORY_META: Record<CommercialCategory, { icon: string; label: string; color: string }> = {
  all:        { icon: "🏪", label: "Todos los atractores",    color: "#1565c0" },
  shops:      { icon: "🛍️", label: "Comercios y tiendas",    color: "#7b1fa2" },
  food:       { icon: "🍽️", label: "Alimentación y cafés",   color: "#e65100" },
  services:   { icon: "🏢", label: "Servicios financieros",  color: "#0277bd" },
  health_edu: { icon: "🏥", label: "Salud y educación",      color: "#2e7d32" },
  other:      { icon: "🏨", label: "Turismo y otros",        color: "#5d4037" },
};

type PointArray = [number, number, number][];
const DATA = rawData as Record<CommercialCategory, PointArray>;

// ── Gradiente (azul→verde→amarillo→rojo, diferente del crimen) ───────────────
const GRADIENT = {
  0.00: "rgba(0,0,128,0)",
  0.12: "rgba(21,101,192,0.5)",
  0.28: "#0277bd",
  0.42: "#00897b",
  0.56: "#43a047",
  0.68: "#c0ca33",
  0.80: "#f9a825",
  0.90: "#e64a19",
  1.00: "#b71c1c",
};

// ── Opciones por zoom ─────────────────────────────────────────────────────────
function heatOpts(zoom: number): L.HeatMapOptions {
  const g = GRADIENT;
  // Zoom alto: puntos pequeños y nítidos para ver concentración por calle
  if (zoom >= 15) return { radius: 12, blur: 8,  maxZoom: 20, max: 1.0, minOpacity: 0.4, gradient: g };
  if (zoom >= 13) return { radius: 18, blur: 13, maxZoom: 20, max: 1.0, minOpacity: 0.35, gradient: g };
  if (zoom >= 11) return { radius: 25, blur: 18, maxZoom: 20, max: 1.0, minOpacity: 0.3, gradient: g };
  if (zoom >= 9)  return { radius: 35, blur: 28, maxZoom: 20, max: 1.0, minOpacity: 0.25, gradient: g };
  if (zoom >= 7)  return { radius: 45, blur: 38, maxZoom: 20, max: 1.0, minOpacity: 0.22, gradient: g };
  return               { radius: 60, blur: 50, maxZoom: 20, max: 1.0, minOpacity: 0.18, gradient: g };
}

// ── Componente ────────────────────────────────────────────────────────────────

interface CommercialHeatLayerProps {
  visible: boolean;
  activeCategories: Set<CommercialCategory>;
}

export const CommercialHeatLayer = ({ visible, activeCategories }: CommercialHeatLayerProps) => {
  const map = useMap();
  const heatRef = useRef<L.HeatLayer | null>(null);

  useEffect(() => {
    if (!visible) {
      if (heatRef.current) { map.removeLayer(heatRef.current); heatRef.current = null; }
      return;
    }

    // Calcular qué puntos mostrar según categorías activas
    const pts = getFilteredPoints(activeCategories);

    if (heatRef.current) {
      (heatRef.current as L.HeatLayer & { setLatLngs: (d: PointArray) => void }).setLatLngs(pts);
      heatRef.current.setOptions(heatOpts(map.getZoom()));
      (heatRef.current as L.HeatLayer & { redraw: () => void }).redraw();
      return;
    }

    const layer = L.heatLayer(pts, heatOpts(map.getZoom()));
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
  }, [visible, map, activeCategories]);

  return null;
};

// Combinar o usar capa específica según categorías activas
function getFilteredPoints(active: Set<CommercialCategory>): PointArray {
  const cats = Array.from(active).filter(c => c !== "all") as CommercialCategory[];

  // Si "todos" está activo o ninguno específico → usar capa all
  if (active.has("all") || cats.length === 0) {
    return DATA["all"] ?? [];
  }

  // Si solo una categoría → devolver esa directamente (mantiene normalización)
  if (cats.length === 1) {
    return DATA[cats[0]] ?? [];
  }

  // Múltiples categorías: fusionar y re-normalizar
  const merged = new Map<string, number>();
  for (const cat of cats) {
    for (const [lat, lon, intensity] of (DATA[cat] ?? [])) {
      const key = `${lat},${lon}`;
      merged.set(key, (merged.get(key) ?? 0) + intensity);
    }
  }
  const maxVal = Math.max(...merged.values(), 1);
  const result: PointArray = [];
  for (const [key, val] of merged) {
    const [lat, lon] = key.split(",").map(Number);
    result.push([lat, lon, Math.min(1, val / maxVal)]);
  }
  result.sort((a, b) => b[2] - a[2]);
  return result;
}

// ── Leyenda con counts ────────────────────────────────────────────────────────
const CATEGORY_COUNTS: Record<CommercialCategory, number> = {
  all:        98102,
  shops:      0,  // se estima en frontend
  food:       0,
  services:   0,
  health_edu: 0,
  other:      0,
};

export const CommercialLegend = ({
  activeCategories,
  onToggle,
}: {
  activeCategories: Set<CommercialCategory>;
  onToggle: (c: CommercialCategory) => void;
}) => {
  const cats = Object.keys(CATEGORY_META) as CommercialCategory[];

  return (
    <div style={{
      background: "rgba(10,15,30,0.92)", border: "1px solid rgba(255,255,255,0.10)",
      borderRadius: 8, padding: "10px 12px", fontSize: 11, color: "#e2e8f0",
      backdropFilter: "blur(10px)", minWidth: 200,
    }}>
      <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8 }}>
        🏪 Concentración Comercial
      </div>

      {/* Gradiente */}
      <div style={{ height: 8, borderRadius: 4, marginBottom: 3,
        background: "linear-gradient(to right,#1565c0,#00897b,#c0ca33,#e64a19,#b71c1c)" }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#64748b", marginBottom: 10 }}>
        <span>Disperso</span><span>Concentrado</span>
      </div>

      {/* Categorías clickeables */}
      <div style={{ fontSize: 9, color: "#64748b", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Categoría (clic para filtrar)
      </div>
      {cats.map((cat) => {
        const { icon, label, color } = CATEGORY_META[cat];
        const on = activeCategories.has(cat);
        return (
          <button key={cat} onClick={() => onToggle(cat)} style={{
            display: "flex", alignItems: "center", gap: 7,
            width: "100%", padding: "4px 6px", borderRadius: 5,
            border: "none", cursor: "pointer",
            background: on ? `${color}22` : "transparent",
            opacity: on ? 1 : 0.35,
            transition: "all 0.15s", marginBottom: 2,
          }}>
            <span style={{ fontSize: 13 }}>{icon}</span>
            <span style={{ color: on ? "#e2e8f0" : "#64748b", fontSize: 10,
              fontWeight: on ? 600 : 400, textAlign: "left" }}>{label}</span>
            {on && <div style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%",
              background: color, boxShadow: `0 0 5px ${color}` }} />}
          </button>
        );
      })}
      <div style={{ marginTop: 8, fontSize: 9, color: "#475569", lineHeight: 1.4 }}>
        OSM 2024 · shops, restaurants, banks, health, education · grid 300m
      </div>
    </div>
  );
};
