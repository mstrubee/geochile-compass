/**
 * CrimeLayer.tsx
 * ==============
 * Capa de Concentración de Riesgo Delictivo por comuna.
 *
 * Fuente: CEAD 2022-2024 (robos y asaltos) normalizado por población (Censo 2024).
 * Granularidad: comunal.
 * Niveles: Muy Alto | Alto | Medio | Bajo | Muy Bajo
 */

import { useEffect, useState, useCallback } from "react";
import { GeoJSON, useMap, useMapEvents } from "react-leaflet";
import type { Layer } from "leaflet";
import type { Feature } from "geojson";
import { crimeService } from "@/services/crimeService";
import type { CrimeFeature, CrimeProperties, RiskLevel } from "@/types/crime";
import { RISK_COLORS } from "@/types/crime";

interface CrimeLayerProps {
  visible: boolean;
  opacity?: number;
}

// ── Helpers de formato ──────────────────────────────────────────────────────

const fmtN = (v: number | null | undefined, dig = 0) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("es-CL", { maximumFractionDigits: dig }).format(v);

const RISK_ORDER: RiskLevel[] = ["Muy Alto", "Alto", "Medio", "Bajo", "Muy Bajo"];

// ── Popup de cada comuna ────────────────────────────────────────────────────

function buildPopupHtml(p: CrimeProperties): string {
  const nivel = p.nivel_riesgo ?? "—";
  const color = RISK_COLORS[p.nivel_riesgo] ?? "#9e9e9e";
  return `
    <div style="min-width:220px;font-family:system-ui,sans-serif">
      <div style="font-weight:700;color:${color};margin-bottom:6px;font-size:13px">
        ${p.comuna}
        <span style="font-weight:400;color:hsl(215 19% 50%);font-size:10px"> · ${p.region}</span>
      </div>
      <div style="
        display:inline-block;
        background:${color}22;
        border:1px solid ${color};
        color:${color};
        font-weight:700;
        font-size:11px;
        padding:2px 8px;
        border-radius:4px;
        margin-bottom:8px
      ">
        Riesgo ${nivel}
      </div>
      <div style="display:grid;grid-template-columns:auto auto;gap:3px 10px;font-size:10px;margin-bottom:8px">
        <span style="color:hsl(215 19% 50%)">Score delictivo</span>
        <span style="font-family:monospace;font-weight:600">${fmtN(p.risk_score, 0)} / 1000</span>

        <span style="color:hsl(215 19% 50%)">Tasa pond. x1000 hab</span>
        <span style="font-family:monospace">${fmtN(p.tasa_x1000, 1)}</span>

        <span style="color:hsl(215 19% 50%)">Total delitos/año</span>
        <span style="font-family:monospace">${fmtN(p.total_delitos_anual)}</span>

        <span style="color:hsl(215 19% 50%)">Robos c/violencia</span>
        <span style="font-family:monospace">${fmtN(p.robos_violencia_anual)}</span>

        <span style="color:hsl(215 19% 50%)">Hurtos</span>
        <span style="font-family:monospace">${fmtN(p.hurtos_anual)}</span>

        <span style="color:hsl(215 19% 50%)">Robos lugar</span>
        <span style="font-family:monospace">${fmtN(p.robos_lugar_anual)}</span>

        <span style="color:hsl(215 19% 50%)">Población</span>
        <span style="font-family:monospace">${fmtN(p.poblacion)}</span>
      </div>
      <div style="font-size:9px;color:hsl(215 19% 35%);border-top:1px solid hsl(215 19% 25%);padding-top:4px">
        ${p.fuente} · promedio ${p.years}
      </div>
    </div>`;
}

// ── Componente principal ────────────────────────────────────────────────────

export const CrimeLayer = ({ visible, opacity = 0.65 }: CrimeLayerProps) => {
  const map = useMap();
  const [features, setFeatures] = useState<CrimeFeature[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!visible) return;
    setLoading(true);
    const b = map.getBounds();
    const bbox: [number, number, number, number] = [
      b.getWest(), b.getSouth(), b.getEast(), b.getNorth(),
    ];
    crimeService
      .getFeaturesInBbox(bbox)
      .then(setFeatures)
      .catch(() => setFeatures([]))
      .finally(() => setLoading(false));
  }, [map, visible]);

  // Carga inicial
  useEffect(() => {
    if (visible) refresh();
    else setFeatures([]);
  }, [visible, refresh]);

  // Refresca en cada movimiento del mapa
  useMapEvents({
    moveend: refresh,
    zoomend: refresh,
  });

  if (!visible) return null;
  if (features.length === 0 && loading) return null;

  const styleFn = (feature?: Feature) => {
    const p = feature?.properties as CrimeProperties | undefined;
    const fillColor = p?.color ?? "#9e9e9e";
    return {
      color:       "hsl(222 38% 12%)",
      weight:      0.8,
      fillColor,
      fillOpacity: opacity,
    };
  };

  const onEachFeature = (feature: Feature, layer: Layer) => {
    const p = feature.properties as CrimeProperties;
    layer.bindPopup(buildPopupHtml(p));
    layer.on("mouseover", () => {
      (layer as unknown as { setStyle: (s: object) => void }).setStyle({
        weight: 2,
        fillOpacity: Math.min(opacity + 0.15, 1),
      });
    });
    layer.on("mouseout", () => {
      (layer as unknown as { setStyle: (s: object) => void }).setStyle(styleFn(feature));
    });
  };

  const key = `crime|${features.length}|${map.getCenter().lat.toFixed(3)}`;

  return (
    <GeoJSON
      key={key}
      data={{ type: "FeatureCollection", features }}
      style={styleFn}
      onEachFeature={onEachFeature}
    />
  );
};

// ── Leyenda (para usar en el panel de capas o mapa) ─────────────────────────

export const CrimeLegend = () => (
  <div
    style={{
      background: "hsl(222 38% 10%)",
      border: "1px solid hsl(222 38% 22%)",
      borderRadius: 6,
      padding: "8px 10px",
      fontSize: 10,
      color: "hsl(215 19% 80%)",
    }}
  >
    <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 11 }}>
      Índice de Riesgo Delictivo
    </div>
    <div style={{ marginBottom: 4, color: "hsl(215 19% 55%)", fontSize: 9 }}>
      Robos y asaltos ponderados · x1000 hab/año · CEAD 2022-2024
    </div>
    {RISK_ORDER.map((nivel) => (
      <div
        key={nivel}
        style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}
      >
        <div
          style={{
            width: 14,
            height: 14,
            background: RISK_COLORS[nivel],
            borderRadius: 2,
            flexShrink: 0,
          }}
        />
        <span>{nivel}</span>
      </div>
    ))}
  </div>
);
