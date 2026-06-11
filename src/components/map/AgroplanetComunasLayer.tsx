import { useCallback, useEffect, useMemo, useRef } from "react";
import { GeoJSON } from "react-leaflet";
import L from "leaflet";
import type { Feature, Geometry } from "geojson";
import type { GeoJSON as LeafletGeoJSON, Layer, PathOptions } from "leaflet";
import { useComunasGeoIndex, type ComunaProps } from "@/hooks/useComunasGeoIndex";
import { useAgroplanetData, type AgroplanetComuna } from "@/hooks/useAgroplanetData";

export type AgroplanetScoreMode =
  | "combined" | "grandes" | "indap"    // Score 0–100 por segmento
  | "frutales" | "cereales" | "vinas"   // Sub-capa: ha de cultivo
  | "forrajeras" | "diversidad";         // Sub-capa: ha forraje / n° especies

// ── Paletas de color ───────────────────────────────────────────────────────────

/** Quintil score: 1=menor potencial, 5=mayor potencial */
const SCORE_Q_COLORS: Record<number, string> = {
  1: "#d1fae5",
  2: "#6ee7b7",
  3: "#f59e0b",
  4: "#f97316",
  5: "#15803d",
};

/** Cultivos ha: intensidad azul (0=sin datos, 5=máximo quintil) */
const HA_COLORS: Record<number, string> = {
  0: "#f1f5f9",
  1: "#bfdbfe",
  2: "#60a5fa",
  3: "#2563eb",
  4: "#1e40af",
  5: "#1e3a8a",
};

/** Diversidad de especies: verde→índigo */
const DIV_COLORS: Record<number, string> = {
  0: "#f1f5f9",
  1: "#d1fae5",
  2: "#34d399",
  3: "#059669",
  4: "#065f46",
  5: "#4338ca",
};

/** Colores de badge Q1–Q5 en el tooltip */
const Q_BADGE_COLORS: Record<number, string> = {
  1: "#ef4444",
  2: "#f97316",
  3: "#eab308",
  4: "#84cc16",
  5: "#16a34a",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

export const AGRO_IS_SCORE = (m: AgroplanetScoreMode) =>
  m === "combined" || m === "grandes" || m === "indap";

const getAgroValue = (d: AgroplanetComuna, mode: AgroplanetScoreMode): number => {
  switch (mode) {
    case "frutales":   return d.ha_frutales_riego ?? 0;
    case "cereales":   return d.ha_cereales_total ?? 0;
    case "vinas":      return d.ha_vinas_riego ?? 0;
    case "forrajeras": return d.ha_forrajeras_total ?? 0;
    case "diversidad": return d.diversidad_especies ?? 0;
    default: return 0;
  }
};

/** Calcula umbrales de quintil (p20/p40/p60/p80) a partir de una lista de valores >0. */
const computeThresholds = (values: number[]): [number, number, number, number] => {
  const sorted = values.filter((v) => v > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return [0, 0, 0, 0];
  const q = (p: number) => sorted[Math.floor(sorted.length * p)] ?? sorted[sorted.length - 1];
  return [q(0.2), q(0.4), q(0.6), q(0.8)];
};

const valueToQuantile = (v: number, thresholds: [number, number, number, number]): number => {
  if (v <= 0) return 0;
  if (v <= thresholds[0]) return 1;
  if (v <= thresholds[1]) return 2;
  if (v <= thresholds[2]) return 3;
  if (v <= thresholds[3]) return 4;
  return 5;
};

const HIGHLIGHT_STYLE: PathOptions = { weight: 2, color: "#15803d", fillOpacity: 0.85 };

// ── Tooltip builder ────────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined) =>
  (n ?? 0).toLocaleString("es-CL", { maximumFractionDigits: 0 });

const scoreBarHtml = (score: number, quintil: number, isActive: boolean): string => {
  const qColor = Q_BADGE_COLORS[Math.max(1, Math.min(5, quintil))] ?? "#94a3b8";
  const pct     = Math.min(100, Math.max(0, score));
  const qLabel  = quintil > 0 ? `Q${quintil}` : "—";
  return `
    <div style="flex:1;height:4px;background:#e2e8f0;border-radius:2px;overflow:hidden">
      <div style="width:${pct}%;height:100%;background:${qColor};border-radius:2px"></div>
    </div>
    <span style="width:26px;text-align:right;font-size:10.5px;${isActive ? `color:${qColor};font-weight:700` : "color:#64748b"}">${score.toFixed(1)}</span>
    <span style="padding:1px 4px;border-radius:3px;font-size:9px;font-weight:700;background:${qColor};color:#fff;min-width:18px;text-align:center">${qLabel}</span>
  `;
};

const buildTooltipHtml = (d: AgroplanetComuna, activeMode: AgroplanetScoreMode): string => {
  const tipLine = [d.macrozona, d.tipologia].filter(Boolean).join(" · ");

  const scoreModes: Array<{ key: AgroplanetScoreMode; icon: string; label: string; score: number; quintil: number }> = [
    { key: "combined", icon: "🌱", label: "Combinado", score: d.score_combined, quintil: d.quintil_combined },
    { key: "grandes",  icon: "🏭", label: "Grandes",   score: d.score_grandes,  quintil: d.quintil_grandes  },
    { key: "indap",    icon: "🌾", label: "INDAP",     score: d.score_indap,    quintil: d.quintil_indap    },
  ];

  const scoreRows = scoreModes.map((m) => {
    const isActive = activeMode === m.key;
    const bg = isActive ? "background:#f0fdf4;border-radius:4px;padding:2px 3px;margin-left:-3px;" : "";
    return `
      <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;${bg}">
        <span style="font-size:12px;width:16px;flex-shrink:0">${m.icon}</span>
        <span style="width:56px;font-size:10px;color:${isActive ? "#166534" : "#64748b"};${isActive ? "font-weight:600" : ""}">${m.label}</span>
        ${scoreBarHtml(m.score, m.quintil, isActive)}
      </div>`;
  }).join("");

  const cultivosList: Array<[string, string, number | null | undefined]> = [
    ["🍇", "Frutales riego", d.ha_frutales_riego],
    ["🌾", "Cereales",       d.ha_cereales_total],
    ["🍷", "Viñas",          d.ha_vinas_riego],
    ["🌿", "Forrajeras",     d.ha_forrajeras_total],
    ["🌲", "Forestal",       d.ha_forestal_total],
  ];
  const cultivosRows = cultivosList
    .filter(([, , v]) => (v ?? 0) > 0)
    .map(([icon, label, v]) => {
      const isActiveCultivo =
        (activeMode === "frutales"   && icon === "🍇") ||
        (activeMode === "cereales"   && icon === "🌾") ||
        (activeMode === "vinas"      && icon === "🍷") ||
        (activeMode === "forrajeras" && icon === "🌿") ||
        (activeMode === "diversidad" && icon === "🔬");
      return `<div style="display:flex;gap:4px;align-items:baseline;${isActiveCultivo ? "font-weight:700;color:#1e40af" : ""}">
        <span style="width:14px">${icon}</span>
        <span style="flex:1;font-size:10px;color:${isActiveCultivo ? "#1e40af" : "#64748b"}">${label}</span>
        <span style="font-size:10px;${isActiveCultivo ? "font-weight:700;color:#1e40af" : "font-weight:500"}">${fmt(v)} ha</span>
      </div>`;
    }).join("");

  const diversidadRow = (d.diversidad_especies ?? 0) > 0
    ? `<div style="display:flex;gap:4px;align-items:baseline;${activeMode === "diversidad" ? "font-weight:700;color:#4338ca" : ""}">
        <span style="width:14px">🔬</span>
        <span style="flex:1;font-size:10px;color:${activeMode === "diversidad" ? "#4338ca" : "#64748b"}">Diversidad</span>
        <span style="font-size:10px;${activeMode === "diversidad" ? "font-weight:700;color:#4338ca" : "font-weight:500"}">${d.diversidad_especies} esp.</span>
      </div>`
    : "";

  const cafParts: string[] = [];
  if ((d.tractores_total ?? 0) > 0)
    cafParts.push(`🚜 <b>${fmt(d.tractores_total)}</b> tractores`);
  if ((d.total_explotaciones ?? 0) > 0)
    cafParts.push(`🏡 <b>${fmt(d.total_explotaciones)}</b> explot.`);
  const cafRow = cafParts.length > 0
    ? `<div style="display:flex;gap:8px;margin-top:5px;padding-top:4px;border-top:1px solid #f1f5f9;font-size:10px;color:#374151;flex-wrap:wrap">${cafParts.join('<span style="color:#cbd5e1"> · </span>')}</div>`
    : "";

  const cultivosBlock =
    cultivosRows || diversidadRow
      ? `<div style="border-top:1px solid #f1f5f9;margin:6px 0 3px"></div>
         <div style="font-size:9px;font-weight:600;letter-spacing:0.06em;color:#94a3b8;text-transform:uppercase;margin-bottom:3px">CULTIVOS</div>
         ${cultivosRows}${diversidadRow}`
      : "";

  return `<div style="font-family:system-ui,sans-serif;min-width:215px;max-width:255px;padding:1px 0">
    <div style="font-weight:700;font-size:13px;margin-bottom:1px;color:#0f172a">${d.nombre}</div>
    <div style="font-size:10px;color:#64748b;margin-bottom:${tipLine ? "2px" : "6px"}">${d.region}</div>
    ${tipLine ? `<div style="font-size:10px;color:#94a3b8;margin-bottom:6px">${tipLine}</div>` : ""}
    <div style="font-size:9px;font-weight:600;letter-spacing:0.06em;color:#94a3b8;text-transform:uppercase;margin-bottom:4px">MODO DE SCORE</div>
    ${scoreRows}
    ${cultivosBlock}
    ${cafRow}
  </div>`;
};

// ── Componente principal ───────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  scoreMode: AgroplanetScoreMode;
}

export const AgroplanetComunasLayer = ({ visible, scoreMode }: Props) => {
  const { ready, fc } = useComunasGeoIndex(visible);
  const { data: agroData, loading } = useAgroplanetData(visible);
  const geoJsonRef  = useRef<LeafletGeoJSON | null>(null);
  const hoveredRef  = useRef<Layer | null>(null);
  const scoreModeRef = useRef(scoreMode);
  scoreModeRef.current = scoreMode;

  // Umbrales dinámicos para los modos de cultivo
  const agroThresholds = useMemo((): [number, number, number, number] => {
    if (AGRO_IS_SCORE(scoreMode) || agroData.size === 0) return [0, 0, 0, 0];
    const values = Array.from(agroData.values()).map((d) => getAgroValue(d, scoreMode));
    return computeThresholds(values);
  }, [scoreMode, agroData]);

  /** Devuelve el valor de relleno (score 0-100 o ha/diversidad) para colorear. */
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

  const getQuintil = useCallback(
    (cut: string): number => {
      const d = agroData.get(cut);
      if (!d) return 0;
      if (scoreMode === "grandes") return d.quintil_grandes;
      if (scoreMode === "indap")   return d.quintil_indap;
      return d.quintil_combined;
    },
    [agroData, scoreMode],
  );

  const styleForFeature = useCallback(
    (feature?: Feature<Geometry, ComunaProps>): PathOptions => {
      const rawCut =
        feature?.properties?.codigo_comuna ?? feature?.properties?.cod_comuna ?? "";
      const cut = String(rawCut).padStart(5, "0");
      const d   = agroData.get(cut);

      if (!d) return { fillColor: "#f8fafc", fillOpacity: 0.08, color: "rgba(0,0,0,0.1)", weight: 0.5 };

      let fillColor: string;
      let fillOpacity: number;

      if (AGRO_IS_SCORE(scoreMode)) {
        const score   = getScore(cut);
        const quintil = getQuintil(cut);
        fillColor     = SCORE_Q_COLORS[Math.max(1, Math.min(5, quintil))] ?? SCORE_Q_COLORS[1];
        fillOpacity   = score > 0 ? 0.65 : 0.10;
      } else {
        const v  = getAgroValue(d, scoreMode);
        const q  = valueToQuantile(v, agroThresholds);
        const palette = scoreMode === "diversidad" ? DIV_COLORS : HA_COLORS;
        fillColor   = palette[q] ?? palette[0];
        fillOpacity = q > 0 ? 0.72 : 0.10;
      }

      return { fillColor, fillOpacity, color: "rgba(0,0,0,0.22)", weight: 0.5 };
    },
    [scoreMode, agroData, agroThresholds, getScore, getQuintil],
  );

  // Re-estilizar al cambiar modo o datos (sin recrear la capa GeoJSON completa)
  useEffect(() => {
    if (geoJsonRef.current && !loading) {
      geoJsonRef.current.setStyle(styleForFeature as never);
      hoveredRef.current = null;
    }
  }, [scoreMode, agroData, loading, styleForFeature]);

  if (!visible || !ready || !fc) return null;

  const onEachFeature = (feature: Feature<Geometry, ComunaProps>, layer: Layer) => {
    const rawCut =
      feature?.properties?.codigo_comuna ?? feature?.properties?.cod_comuna ?? "";
    const cut = String(rawCut).padStart(5, "0");
    const d   = agroData.get(cut);

    const tooltipContent = d
      ? buildTooltipHtml(d, scoreModeRef.current)
      : `<strong>${cut}</strong> — sin datos`;

    (layer as L.Path).bindTooltip(tooltipContent, {
      sticky:    true,
      opacity:   0.97,
      className: "leaflet-tooltip-agroplanet",
    });

    layer.on({
      mouseover(e) {
        const prev = hoveredRef.current;
        if (prev && prev !== layer) geoJsonRef.current?.resetStyle(prev as never);
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
      ref={(r) => { geoJsonRef.current = r as unknown as LeafletGeoJSON | null; }}
      data={fc}
      style={styleForFeature as never}
      onEachFeature={onEachFeature}
    />
  );
};
