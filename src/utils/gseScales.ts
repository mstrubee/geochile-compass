import type { GseClass, GseVariable } from "@/types/gse";

/** Etiquetas legibles. */
export const GSE_VARIABLE_LABEL: Record<GseVariable, string> = {
  gse: "GSE",
  quintil: "Quintil",
  nse_score: "Puntaje NSE",
  educ: "Escolaridad",
  hacin: "Hacinamiento",
  auto: "Movilización",
};

/** Paleta canónica para las 6 categorías GSE — alineada con el branding existente. */
export const GSE_COLORS: Record<GseClass, string> = {
  ABC1: "#1e40af",
  C1:   "#3b82f6",
  C2:   "#0ea5e9",
  C3:   "#eab308",
  D:    "#f97316",
  E:    "#dc2626",
};

export const GSE_ORDER: GseClass[] = ["ABC1", "C1", "C2", "C3", "D", "E"];

const QUINTIL_COLORS: Record<string, string> = {
  Q5: "#1e40af",
  Q4: "#3b82f6",
  Q3: "#eab308",
  Q2: "#f97316",
  Q1: "#dc2626",
};

interface NumericStop { max: number; color: string; label: string }

/** Puntaje NSE — más alto = mayor estatus. */
export const NSE_SCORE_SCALE: NumericStop[] = [
  { max: 200, color: "#dc2626", label: "< 200" },
  { max: 350, color: "#f97316", label: "200–350" },
  { max: 500, color: "#eab308", label: "350–500" },
  { max: 650, color: "#3b82f6", label: "500–650" },
  { max: Infinity, color: "#1e40af", label: "> 650" },
];

/** Años promedio de escolaridad. */
export const EDUC_SCALE: NumericStop[] = [
  { max: 6,  color: "#dc2626", label: "< 6 años" },
  { max: 9,  color: "#f97316", label: "6–9 años" },
  { max: 12, color: "#eab308", label: "9–12 años" },
  { max: 14, color: "#3b82f6", label: "12–14 años" },
  { max: Infinity, color: "#1e40af", label: "> 14 años" },
];

/** Hab por dormitorio — más alto = más hacinamiento (peor). */
export const HACIN_SCALE: NumericStop[] = [
  { max: 1,    color: "#1e40af", label: "Sin hac." },
  { max: 1.5,  color: "#3b82f6", label: "1–1,5" },
  { max: 2,    color: "#eab308", label: "Leve 1,5–2" },
  { max: 2.5,  color: "#f97316", label: "Medio 2–2,5" },
  { max: Infinity, color: "#dc2626", label: "Crítico > 2,5" },
];

/** Puntaje de motorización 0–100. */
export const AUTO_SCALE: NumericStop[] = [
  { max: 10, color: "#dc2626", label: "0–10" },
  { max: 25, color: "#f97316", label: "10–25" },
  { max: 50, color: "#eab308", label: "25–50" },
  { max: 75, color: "#3b82f6", label: "50–75" },
  { max: Infinity, color: "#1e40af", label: "> 75" },
];

const pickStop = (scale: NumericStop[], v: number): string => {
  for (const s of scale) if (v <= s.max) return s.color;
  return scale[scale.length - 1].color;
};

const NEUTRAL = "#52525b";

export const colorForGse = (
  variable: GseVariable,
  p: {
    gse: GseClass | null;
    quintil: string | null;
    nse_score: number | null;
    educ: number | null;
    hacin: number | null;
    auto_score: number | null;
  },
): string => {
  switch (variable) {
    case "gse":      return p.gse ? GSE_COLORS[p.gse] : NEUTRAL;
    case "quintil":  return (p.quintil && QUINTIL_COLORS[p.quintil]) ?? NEUTRAL;
    case "nse_score": return p.nse_score == null ? NEUTRAL : pickStop(NSE_SCORE_SCALE, p.nse_score);
    case "educ":     return p.educ == null ? NEUTRAL : pickStop(EDUC_SCALE, p.educ);
    case "hacin":    return p.hacin == null ? NEUTRAL : pickStop(HACIN_SCALE, p.hacin);
    case "auto":     return p.auto_score == null ? NEUTRAL : pickStop(AUTO_SCALE, p.auto_score);
  }
};

export const scaleForGseVariable = (variable: GseVariable): { color: string; label: string }[] => {
  switch (variable) {
    case "gse":
      return GSE_ORDER.map((g) => ({ color: GSE_COLORS[g], label: g }));
    case "quintil":
      return (["Q5", "Q4", "Q3", "Q2", "Q1"] as const).map((q) => ({ color: QUINTIL_COLORS[q], label: q }));
    case "nse_score":  return NSE_SCORE_SCALE.map((s) => ({ color: s.color, label: s.label }));
    case "educ":       return EDUC_SCALE.map((s) => ({ color: s.color, label: s.label }));
    case "hacin":      return HACIN_SCALE.map((s) => ({ color: s.color, label: s.label }));
    case "auto":       return AUTO_SCALE.map((s) => ({ color: s.color, label: s.label }));
  }
};
