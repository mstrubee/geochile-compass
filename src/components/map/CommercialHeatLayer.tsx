/**
 * CommercialHeatLayer.tsx
 * =======================
 * Heatmap de atractores comerciales con:
 * - Parámetros ajustables en tiempo real (admin)
 * - Filtro por categoría OSM
 * - minZoom configurable (default: 12 ≈ nivel de comuna)
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import rawData from "@/data/commercial_heatmap_points.json";
import { useHeatmapSettings, type HeatmapSettings } from "@/hooks/useHeatmapSettings";
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

// Puntos crudos [lat, lon] — sin intensidad explícita.
// Leaflet.heat calcula la densidad kernel desde los puntos reales de cada local.
// Grid de dedup a 100m → 1 POI representativo por celda → 33.707 puntos "all".
type RawPoint = [number, number];
const DATA = rawData as Record<CommercialCategory, RawPoint[]>;

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
// Devuelve puntos crudos [lat, lon] — Leaflet.heat calcula la densidad solo.
function getFilteredPoints(active: Set<CommercialCategory>): RawPoint[] {
  const cats = Array.from(active).filter(c => c !== "all") as CommercialCategory[];
  if (active.has("all") || cats.length === 0) return DATA["all"] ?? [];
  if (cats.length === 1) return DATA[cats[0]] ?? [];

  // Fusionar múltiples categorías deduplicando por coordenada
  const seen = new Set<string>();
  const result: RawPoint[] = [];
  for (const cat of cats)
    for (const [lat, lon] of (DATA[cat] ?? [])) {
      const key = `${lat},${lon}`;
      if (!seen.has(key)) { seen.add(key); result.push([lat, lon]); }
    }
  return result;
}

// ── Componente ────────────────────────────────────────────────────────────────

interface CommercialHeatLayerProps {
  visible: boolean;
  activeCategories: Set<CommercialCategory>;
  isAdmin?: boolean;
  /**
   * Ajustes que pisan a los guardados, sin escribirlos.
   *
   * El radio del heatmap está en PÍXELES, así que la mancha se ve distinta
   * según la escala de la vista: lo que está bien calibrado en pantalla puede
   * tapar la isócrona en la foto del informe. Esto permite afinarlo solo para
   * la captura.
   */
  settingsOverride?: Partial<HeatmapSettings> | null;
}

export const CommercialHeatLayer = ({
  visible, activeCategories, isAdmin = false, settingsOverride = null,
}: CommercialHeatLayerProps) => {
  const map = useMap();
  const heatRef = useRef<L.HeatLayer | null>(null);
  const [zoom, setZoom] = useState(() => map.getZoom());
  const [showSettings, setShowSettings] = useState(false);

  const { settings: saved, setSettings, save, saving, error } = useHeatmapSettings("commercial");
  // Memorizado: sin esto el objeto es nuevo en cada render y el efecto que
  // reconstruye la capa se dispararía continuamente.
  const settings = useMemo(
    () => (settingsOverride ? { ...saved, ...settingsOverride } : saved),
    [saved, settingsOverride],
  );

  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  const shouldShow = visible && zoom >= settings.min_zoom;

  // Se recrea la capa en cada cambio en vez de usar setOptions: el redraw() de
  // leaflet.heat se salta el redibujo si ya hay uno agendado (`this._frame`),
  // así que un cambio de radio podía no llegar a pintarse — y en la captura del
  // informe eso significa una foto con los parámetros viejos. Recrear es
  // determinista, y de paso el cleanup vuelve a registrarse siempre (antes el
  // camino de reutilización hacía `return` y se lo saltaba).
  useEffect(() => {
    if (heatRef.current) {
      map.removeLayer(heatRef.current);
      heatRef.current = null;
    }
    if (!shouldShow) return;

    const pts = getFilteredPoints(activeCategories) as unknown as L.HeatLatLngTuple[];
    const layer = L.heatLayer(pts, makeOpts(settings.radius, settings.blur, settings.opacity));
    layer.addTo(map);
    heatRef.current = layer;

    return () => {
      if (heatRef.current) {
        map.removeLayer(heatRef.current);
        heatRef.current = null;
      }
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
          layerKey="commercial"
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
