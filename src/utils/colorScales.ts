import type { ManzanaVariable } from "@/types/manzanas";
import type { NSE } from "@/data/communes";

export interface ColorStop {
  max: number; // upper bound (inclusive)
  color: string; // hex
  label: string;
}

export const DENSITY_SCALE: ColorStop[] = [
  { max: 2000, color: "#e9d5ff", label: "< 2.000" },
  { max: 5000, color: "#c084fc", label: "2 – 5k" },
  { max: 9000, color: "#a855f7", label: "5 – 9k" },
  { max: 13000, color: "#7c3aed", label: "9 – 13k" },
  { max: Infinity, color: "#4c1d95", label: "> 13k" },
];

export const INCOME_SCALE: ColorStop[] = [
  { max: 500_000, color: "#dc2626", label: "< 500k" },
  { max: 800_000, color: "#f97316", label: "500 – 800k" },
  { max: 1_200_000, color: "#eab308", label: "800k – 1,2M" },
  { max: 2_500_000, color: "#3b82f6", label: "1,2 – 2,5M" },
  { max: Infinity, color: "#1e40af", label: "> 2,5M" },
];

export const POPULATION_SCALE: ColorStop[] = [
  { max: 50_000, color: "#fde047", label: "< 50k" },
  { max: 150_000, color: "#fbbf24", label: "50 – 150k" },
  { max: 300_000, color: "#fb923c", label: "150 – 300k" },
  { max: 500_000, color: "#ef4444", label: "300 – 500k" },
  { max: Infinity, color: "#b91c1c", label: "> 500k" },
];

export const colorForPopulation = (pop: number): string => {
  for (const s of POPULATION_SCALE) if (pop <= s.max) return s.color;
  return POPULATION_SCALE[POPULATION_SCALE.length - 1].color;
};

export const TRAFFIC_SCALE: ColorStop[] = [
  { max: 49, color: "#22c55e", label: "Fluido < 50" },
  { max: 72, color: "#eab308", label: "Moderado 50–72" },
  { max: Infinity, color: "#ef4444", label: "Alto > 72" },
];

export const NSE_COLORS: Record<NSE, { color: string; label: string }> = {
  1: { color: "#dc2626", label: "E" },
  2: { color: "#f97316", label: "D" },
  3: { color: "#eab308", label: "C3" },
  4: { color: "#3b82f6", label: "C2" },
  5: { color: "#1e40af", label: "ABC1" },
};

const pickFromScale = (scale: ColorStop[], v: number): string => {
  for (const s of scale) if (v <= s.max) return s.color;
  return scale[scale.length - 1].color;
};

export const colorForManzana = (
  variable: ManzanaVariable,
  props: { density: number; nse: NSE; income: number; traffic: number }
): string => {
  switch (variable) {
    case "density":
      return pickFromScale(DENSITY_SCALE, props.density);
    case "income":
      return pickFromScale(INCOME_SCALE, props.income);
    case "traffic":
      return pickFromScale(TRAFFIC_SCALE, props.traffic);
    case "nse":
      return NSE_COLORS[props.nse].color;
  }
};

export const scaleForVariable = (variable: ManzanaVariable): { color: string; label: string }[] => {
  switch (variable) {
    case "density":
      return DENSITY_SCALE.map((s) => ({ color: s.color, label: s.label }));
    case "income":
      return INCOME_SCALE.map((s) => ({ color: s.color, label: s.label }));
    case "traffic":
      return TRAFFIC_SCALE.map((s) => ({ color: s.color, label: s.label }));
    case "nse":
      return ([5, 4, 3, 2, 1] as NSE[]).map((n) => NSE_COLORS[n]);
  }
};

export const VARIABLE_LABEL: Record<ManzanaVariable, string> = {
  density: "Densidad",
  nse: "NSE",
  income: "Ingresos",
  traffic: "Tráfico",
};
