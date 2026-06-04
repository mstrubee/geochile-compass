import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";

export type RiskLevel = "Muy Alto" | "Alto" | "Medio" | "Bajo" | "Muy Bajo";

export const RISK_COLORS: Record<RiskLevel, string> = {
  "Muy Alto": "#d32f2f",
  "Alto":     "#f44336",
  "Medio":    "#ff9800",
  "Bajo":     "#cddc39",
  "Muy Bajo": "#4caf50",
};

export const RISK_LABELS: Record<RiskLevel, string> = {
  "Muy Alto": "Muy Alto",
  "Alto":     "Alto",
  "Medio":    "Medio",
  "Bajo":     "Bajo",
  "Muy Bajo": "Muy Bajo",
};

export interface CrimeProperties {
  cut:        string;
  comuna:     string;
  provincia:  string;
  region:     string;
  // Índice
  nivel_riesgo:       RiskLevel;
  risk_score:         number;    // 0–1000
  tasa_x1000:         number;    // delitos ponderados por 1.000 hab/año
  tasa_simple_x1000:  number;    // delitos simples por 1.000 hab/año
  // Volúmenes anuales (promedio 2022-2024)
  total_delitos_anual:   number;
  robos_violencia_anual: number;
  hurtos_anual:          number;
  robos_lugar_anual:     number;
  // Demografía
  poblacion: number;
  hogares:   number;
  // Meta
  color:    string;
  fuente:   string;
  years:    string;
}

export type CrimeFeature = Feature<Polygon | MultiPolygon, CrimeProperties>;

export interface CrimeFeatureCollection extends FeatureCollection {
  features: CrimeFeature[];
}
