/**
 * Tipos del módulo de análisis cuantitativo de POIs.
 * Espejo de las tablas creadas en 20260509070000_analysis_uf_settings.sql
 */

/* ----------------- UF ----------------- */

export interface UfValue {
  period: string; // ISO date "YYYY-MM-01"
  value: number; // CLP por 1 UF
  source: string | null;
}

/* ----------------- Configuración del análisis ----------------- */

export interface AnalysisSettings {
  folder_id: string;
  iso_minutes_rm: number; // default 5
  iso_minutes_regions: number; // default 7
  external_competition_folder_ids: string[]; // ids de carpetas POI
  external_competition_layer_ids: string[]; // ids de user_layers
  use_fine_cannibalization: boolean;
  config_version: number;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/* ----------------- Reglas de pesos para complementarios ----------------- */

export interface ComplementWeightRule {
  id: string;
  /** null → regla global. Si != null aplica solo a esa carpeta. */
  folder_id: string | null;
  /** Regex case-insensitive, evaluada contra (name + " " + category). */
  pattern: string;
  /** Peso 0..1; multiplica la "atracción" del POI complementario. */
  weight: number;
  /** Etiqueta legible: "Ancla" | "Medio" | "Bajo" | "Mínimo" */
  label: string | null;
  /** Las reglas con priority menor se evalúan antes. */
  priority: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/* ----------------- Cache de features ----------------- */

/**
 * Vector de features territoriales por POI. Las claves son convenciones
 * documentadas en la fase 2; aquí guardamos JSONB plano para flexibilidad.
 *
 * Ejemplos de keys (Fase 2 las define):
 *  - pop_total           Población total (sum) en la isócrona
 *  - pop_density_avg     Densidad media ponderada por área
 *  - nse_high_pct        % de población GSE alto
 *  - nse_mid_pct         % GSE medio
 *  - nse_low_pct         % GSE bajo
 *  - traffic_idx         Índice 0..100 de tráfico promedio
 *  - n_competition_int   N° locales del mismo chain en la isócrona (sin contar self)
 *  - n_competition_ext   N° locales de competencia externa
 *  - dist_competition    Distancia (m) al competidor más cercano
 *  - complement_score    Suma ponderada de POIs complementarios
 *  - n_anchors           N° de anclas (peso ≥ 0.8)
 *  - cannibalization_factor  0..1 — fracción "exclusiva" tras descontar canibalización interna
 */
export interface PoiFeatures {
  [key: string]: number;
}

export interface PoiFeaturesCache {
  poi_id: string;
  folder_id: string;
  iso_minutes: number;
  is_rm: boolean;
  features: PoiFeatures;
  config_version: number;
  iso_geom_hash: string | null;
  computed_at: string;
}

/* ----------------- Cache del análisis Ridge ----------------- */

/** Una contribución individual de un driver a la predicción. */
export interface DriverContribution {
  feature: string; // key del feature
  label: string; // etiqueta legible (ES)
  contribution_clp: number; // delta en CLP/mes vs promedio del chain
  contribution_uf: number; // mismo delta en UF
  z: number; // valor estandarizado (z-score) del feature en este POI
}

export type TemporalState =
  | "recovered_growing"
  | "stable"
  | "decelerating"
  | "not_recovered"
  | "at_risk"
  | "insufficient_data";

/**
 * Descomposición temporal en regímenes detectados (z-score).
 * Todos los valores son promedios mensuales en UF (deflactados).
 */
export interface TemporalDecomposition {
  pre_shock?: { from: string; to: string; uf: number; clp: number };
  crisis?: { from: string; to: string; uf: number; clp: number; drop_pct: number };
  recovery?: { from: string; to: string; uf: number; clp: number };
  ttm?: { from: string; to: string; uf: number; clp: number };
  closed_year?: { year: number; uf: number; clp: number };
  growth_vs_pre_uf_pct: number | null;
  acceleration_pct: number | null;
}

export interface PoiPerformanceAnalysis {
  poi_id: string;
  folder_id: string;
  target_year: number;
  actual_monthly_clp: number | null;
  actual_monthly_uf: number | null;
  predicted_monthly_clp: number | null;
  predicted_monthly_uf: number | null;
  residual_clp: number | null;
  residual_pct: number | null;
  top_drivers: DriverContribution[];
  peer_poi_ids: string[];
  temporal_state: TemporalState | null;
  temporal_decomposition: TemporalDecomposition;
  config_version: number;
  computed_at: string;
}
