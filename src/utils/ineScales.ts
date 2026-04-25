/**
 * Escalas de color y formato para variables INE por comuna.
 * Se usan en la capa "Comunas de Chile" (polígonos) cuando se elige
 * un coroplético (Población, Densidad, Ingreso o NSE).
 */

export type IneVariable = "poblacion" | "densidad" | "ingreso" | "nse";

export const INE_VARIABLE_LABEL: Record<IneVariable, string> = {
  poblacion: "Población",
  densidad: "Densidad",
  ingreso: "Ingreso",
  nse: "NSE",
};

export interface IneCommuneStats {
  poblacion: number | null;
  superficie_km2: number | null;
  densidad: number | null; // hab/km²
  ingreso: number | null; // CLP
  nse: "ABC1" | "C2" | "C3" | "D" | "E" | null;
}

interface ScaleStop {
  max: number;
  color: string;
  label: string;
}

const POBLACION_SCALE: ScaleStop[] = [
  { max: 10_000, color: "#fef3c7", label: "< 10k" },
  { max: 50_000, color: "#fcd34d", label: "10 – 50k" },
  { max: 150_000, color: "#fb923c", label: "50 – 150k" },
  { max: 300_000, color: "#ef4444", label: "150 – 300k" },
  { max: Infinity, color: "#991b1b", label: "> 300k" },
];

const DENSIDAD_SCALE: ScaleStop[] = [
  { max: 100, color: "#dcfce7", label: "< 100" },
  { max: 1_000, color: "#86efac", label: "100 – 1k" },
  { max: 5_000, color: "#22c55e", label: "1k – 5k" },
  { max: 10_000, color: "#15803d", label: "5k – 10k" },
  { max: Infinity, color: "#14532d", label: "> 10k" },
];

const INGRESO_SCALE: ScaleStop[] = [
  { max: 500_000, color: "#fecaca", label: "< 500k" },
  { max: 800_000, color: "#fca5a5", label: "500 – 800k" },
  { max: 1_200_000, color: "#93c5fd", label: "800k – 1,2M" },
  { max: 2_000_000, color: "#3b82f6", label: "1,2 – 2M" },
  { max: Infinity, color: "#1e3a8a", label: "> 2M" },
];

const NSE_COLOR: Record<NonNullable<IneCommuneStats["nse"]>, { color: string; label: string }> = {
  E: { color: "#dc2626", label: "E" },
  D: { color: "#f97316", label: "D" },
  C3: { color: "#eab308", label: "C3" },
  C2: { color: "#3b82f6", label: "C2" },
  ABC1: { color: "#1e40af", label: "ABC1" },
};

export const NO_DATA_COLOR = "#3f3f46";

const pick = (scale: ScaleStop[], v: number): string => {
  for (const s of scale) if (v <= s.max) return s.color;
  return scale[scale.length - 1].color;
};

export const colorForIneCommune = (
  variable: IneVariable,
  stats: IneCommuneStats | null,
): string => {
  if (!stats) return NO_DATA_COLOR;
  switch (variable) {
    case "poblacion":
      return stats.poblacion != null ? pick(POBLACION_SCALE, stats.poblacion) : NO_DATA_COLOR;
    case "densidad":
      return stats.densidad != null ? pick(DENSIDAD_SCALE, stats.densidad) : NO_DATA_COLOR;
    case "ingreso":
      return stats.ingreso != null ? pick(INGRESO_SCALE, stats.ingreso) : NO_DATA_COLOR;
    case "nse":
      return stats.nse ? NSE_COLOR[stats.nse].color : NO_DATA_COLOR;
  }
};

export const scaleForIneVariable = (
  variable: IneVariable,
): { color: string; label: string }[] => {
  switch (variable) {
    case "poblacion":
      return POBLACION_SCALE.map((s) => ({ color: s.color, label: s.label }));
    case "densidad":
      return DENSIDAD_SCALE.map((s) => ({ color: s.color, label: s.label }));
    case "ingreso":
      return INGRESO_SCALE.map((s) => ({ color: s.color, label: s.label }));
    case "nse":
      return (["ABC1", "C2", "C3", "D", "E"] as const).map((k) => NSE_COLOR[k]);
  }
};

export const formatIneValue = (
  variable: IneVariable,
  stats: IneCommuneStats | null,
): string => {
  if (!stats) return "Sin dato";
  const fmt = (n: number) => n.toLocaleString("es-CL");
  switch (variable) {
    case "poblacion":
      return stats.poblacion != null ? `${fmt(stats.poblacion)} hab` : "Sin dato";
    case "densidad":
      return stats.densidad != null ? `${fmt(Math.round(stats.densidad))} hab/km²` : "Sin dato";
    case "ingreso":
      return stats.ingreso != null ? `$${fmt(stats.ingreso)}` : "Sin dato";
    case "nse":
      return stats.nse ?? "Sin dato";
  }
};
