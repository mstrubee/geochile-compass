import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";

export type GseClass = "ABC1" | "C1" | "C2" | "C3" | "D" | "E";
export type Quintil = "Q1" | "Q2" | "Q3" | "Q4" | "Q5";

/** Variable seleccionable para colorear los polígonos GSE. */
export type GseVariable =
  | "gse"        // Categoría GSE_final
  | "quintil"    // Quintil socioeconómico
  | "nse_score"  // Puntaje NSE continuo (0–1000)
  | "educ"       // Años de escolaridad promedio
  | "hacin"      // Índice de hacinamiento (hab/dorm)
  | "auto";      // Puntaje "automovilización"

export interface GseProperties {
  id: string;
  commune: string | null;
  code: string | null;
  gse: GseClass | null;
  quintil: Quintil | null;
  nse_score: number | null;
  educ: number | null;
  educ_score: number | null;
  hacin: number | null;
  hacin_class: string | null;
  hacin_score: number | null;
  auto_score: number | null;
}

export type GseFeature = Feature<Polygon | MultiPolygon, GseProperties>;

export interface GseFeatureCollection extends FeatureCollection {
  features: GseFeature[];
  metadata: {
    total: number;
    bbox: [number, number, number, number];
    variable: GseVariable;
    source: "Censo 2012";
    /** Comunas sin cobertura en el viewport (para el fallback). */
    fallbackCommunes: string[];
  };
}

export interface GseParams {
  west: number;
  south: number;
  east: number;
  north: number;
  variable: GseVariable;
  zoom: number;
}

export interface GseIndexEntry {
  commune: string;
  slug: string;
  file: string;
  count: number;
  bbox: [number, number, number, number];
}

export interface GseIndex {
  region: string;
  source: string;
  communes: GseIndexEntry[];
}
