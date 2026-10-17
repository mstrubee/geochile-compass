/**
 * Escalas, clasificación y formato de la capa "Permisos de edificación".
 * Funciones puras (sin React ni Leaflet) para poder probarlas.
 *
 * Reglas de confiabilidad:
 *  - "Sin dato" NO es 0: tiene su propio color y su propia entrada en la leyenda.
 *  - Un 0 real (la fuente dice 0) también se distingue del resto.
 *  - La variación interanual solo existe si el servidor pudo calcularla; si no, es "no calculable".
 */
import type {
  PermitChoroplethRow, PermitDestination, PermitDisplay, PermitMetric, PermitPeriodMode, PermitSelection,
} from "@/types/permits";

export const NO_DATA_COLOR = "#d1d5db";
export const ZERO_COLOR = "#f8fafc";
/** Azules secuenciales (valor). */
export const SEQUENTIAL = ["#dbeafe", "#93c5fd", "#3b82f6", "#1d4ed8", "#1e3a8a"] as const;
/** Divergente rojo-azul, apto para daltonismo (variación). Orden: caída fuerte → alza fuerte. */
export const DIVERGING = ["#b2182b", "#ef8a62", "#f7f7f7", "#67a9cf", "#2166ac"] as const;
/** Cortes fijos de variación interanual (%): ≤-50 · -50..-10 · -10..+10 · +10..+50 · ≥+50. */
export const YOY_BREAKS = [-50, -10, 10, 50] as const;

export const METRIC_LABEL: Record<PermitMetric, string> = {
  units: "Viviendas autorizadas (unidades)",
  area_m2: "Superficie autorizada (m²)",
};
export const DESTINATION_LABEL: Record<PermitDestination, string> = {
  housing_total: "Vivienda total",
  housing_houses: "Casas",
  housing_apartments: "Departamentos",
};
export const MODE_LABEL: Record<PermitPeriodMode, string> = {
  year: "Año",
  ytd: "Acumulado del año",
  month: "Mes",
};
export const MONTH_LABEL = ["", "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"] as const;

const nf = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Valor que se pinta según lo elegido; null = sin dato / no calculable. */
export const displayValue = (row: PermitChoroplethRow | undefined, display: PermitDisplay): number | null => {
  if (!row) return null;
  return display === "yoy" ? row.yoy_pct : row.value;
};

export const formatPermitValue = (v: number | null | undefined, metric: PermitMetric, display: PermitDisplay): string => {
  if (v == null) return display === "yoy" ? "no calculable" : "sin dato";
  if (display === "yoy") return `${v > 0 ? "+" : ""}${nf1.format(v)} %`;
  return metric === "area_m2" ? `${nf.format(v)} m²` : `${nf.format(v)} viv.`;
};

/** Cortes por cuantiles de los valores > 0 (la distribución es muy asimétrica). Devuelve hasta `classes-1` cortes únicos. */
export const quantileBreaks = (values: number[], classes = 5): number[] => {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length === 0) return [];
  const cuts: number[] = [];
  for (let i = 1; i < classes; i++) {
    const idx = Math.min(v.length - 1, Math.floor((i * v.length) / classes));
    const c = v[idx];
    if (cuts.length === 0 || c > cuts[cuts.length - 1]) cuts.push(c);
  }
  return cuts;
};

export type Classified =
  | { kind: "nodata"; color: string }
  | { kind: "zero"; color: string }
  | { kind: "class"; color: string; index: number };

/** Clase de color de una comuna. `breaks` son los cortes de valor (solo se usan en display = value). */
export const classify = (v: number | null, display: PermitDisplay, breaks: number[]): Classified => {
  if (v == null || !Number.isFinite(v)) return { kind: "nodata", color: NO_DATA_COLOR };
  if (display === "yoy") {
    const i = YOY_BREAKS.filter((b) => v >= b).length;        // 0..4
    return { kind: "class", color: DIVERGING[i], index: i };
  }
  if (v === 0) return { kind: "zero", color: ZERO_COLOR };
  const i = Math.min(breaks.filter((b) => v >= b).length, SEQUENTIAL.length - 1);
  return { kind: "class", color: SEQUENTIAL[i], index: i };
};

export interface LegendEntry { color: string; label: string; kind: "class" | "zero" | "nodata" }

export const legendEntries = (display: PermitDisplay, metric: PermitMetric, breaks: number[]): LegendEntry[] => {
  const out: LegendEntry[] = [];
  if (display === "yoy") {
    const labels = ["≤ −50 %", "−50 a −10 %", "−10 a +10 %", "+10 a +50 %", "≥ +50 %"];
    labels.forEach((label, i) => out.push({ color: DIVERGING[i], label, kind: "class" }));
    out.push({ color: NO_DATA_COLOR, label: "No calculable (período previo incompleto o igual a 0)", kind: "nodata" });
    return out;
  }
  const unit = metric === "area_m2" ? " m²" : "";
  out.push({ color: ZERO_COLOR, label: "0 (valor informado por la fuente)", kind: "zero" });
  const edges = [0, ...breaks];
  edges.forEach((from, i) => {
    const to = edges[i + 1];
    const label = to == null ? `≥ ${nf.format(Math.max(from, 1))}${unit}` : `${nf.format(Math.max(from, 1))} – ${nf.format(to - 1)}${unit}`;
    out.push({ color: SEQUENTIAL[Math.min(i, SEQUENTIAL.length - 1)], label, kind: "class" });
  });
  out.push({ color: NO_DATA_COLOR, label: "Sin dato (no es 0)", kind: "nodata" });
  return out;
};

/** Etiqueta legible del período elegido: "2025", "ene–jul 2026", "jul 2026". */
export const periodLabel = (s: Pick<PermitSelection, "mode" | "year" | "month">): string => {
  if (s.mode === "year") return String(s.year);
  const m = s.month ?? 1;
  return s.mode === "ytd" ? `ene–${MONTH_LABEL[m]} ${s.year}` : `${MONTH_LABEL[m]} ${s.year}`;
};
