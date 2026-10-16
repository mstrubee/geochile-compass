/**
 * Permisos de edificación (MINVU CEDOC) — tipos de la capa temática por comuna.
 * Las RPC viven en supabase/migrations/20261020120100_building_permit_statistics.sql
 * (diseño: docs/permisos-edificacion/DISENO.md). Aún no están en `integrations/supabase/types.ts`
 * (archivo generado): por eso el servicio las llama con un cast explícito.
 */

export type PermitMetric = "units" | "area_m2";
/** `value` = el valor del período; `yoy` = variación interanual (%). */
export type PermitDisplay = "value" | "yoy";
/** `year` = año completo · `ytd` = acumulado de enero al mes · `month` = un mes. */
export type PermitPeriodMode = "year" | "ytd" | "month";
export type PermitDestination = "housing_total" | "housing_houses" | "housing_apartments";

/** El archivo anual trae años; el mensual, meses. Cada modo lee de su fuente. */
export const PERMIT_SOURCE_KEYS = {
  year: "minvu_cedoc_permisos_anual",
  month: "minvu_cedoc_permisos_mensual",
} as const;
export type PermitSourceKey = (typeof PERMIT_SOURCE_KEYS)[keyof typeof PERMIT_SOURCE_KEYS];

export interface PermitSelection {
  mode: PermitPeriodMode;
  year: number;
  /** 1-12; obligatorio en `ytd` y `month`. */
  month: number | null;
  metric: PermitMetric;
  display: PermitDisplay;
  destination: PermitDestination;
}

/** Fila de `get_permit_choropleth()`. Un dato faltante es `null`, NUNCA 0. */
export interface PermitChoroplethRow {
  comuna_cut: string;
  comuna_name: string;
  value: number | null;
  prev_value: number | null;
  yoy_pct: number | null;
  /** El período está completo para esta comuna (si no, `value` es null). */
  coverage_ok: boolean;
  is_provisional: boolean | null;
  snapshot_ids: string[] | null;
}

/** Fila de `get_permit_series()`: un valor con su procedencia. */
export interface PermitSeriesRow {
  period: string;
  granularity: "month" | "year";
  value: number;
  is_provisional: boolean;
  quality_note: string | null;
  destination_declared: string;
  work_type_declared: string;
  source_sheet: string | null;
  /** p. ej. "número_total!R245": la celda del archivo donde nació el valor. */
  cell_ref: string | null;
  first_snapshot_id: string;
  first_captured_at: string;
  first_origin_url: string;
  first_declared_date: string | null;
  latest_snapshot_id: string | null;
  latest_captured_at: string | null;
  latest_period_end: string | null;
  landing_url: string;
  source_key: string;
  verification_status: VerificationStatus;
}

export type VerificationStatus = "comprobado" | "documentado" | "hipotesis" | "no_disponible";
export type FreshnessStatus = "fresh" | "stale" | "never_loaded";

/** Fila de `get_layer_provenance()`: qué fuente alimenta la capa y qué tan al día está. */
export interface LayerProvenanceRow {
  source_key: string;
  name: string;
  publisher: string;
  landing_url: string;
  attribution: string;
  license_label: string | null;
  verification_status: VerificationStatus;
  scope_note: string | null;
  access_mode: string;
  freshness_status: FreshnessStatus;
  check_overdue: boolean;
  overdue_since: string | null;
  last_checked_at: string | null;
  snapshot_id: string | null;
  origin_url: string | null;
  sha256: string | null;
  captured_at: string | null;
  period_start: string | null;
  period_end: string | null;
  load_from: string | null;
  declared_date: string | null;
  definitive_until: number | null;
  quality_note: string | null;
}

/** Fila de `thematic_layers`: marca una hoja del árbol como capa temática. */
export interface ThematicLayerRow {
  layer_id: string;
  renderer: "choropleth_comuna" | "points_projects";
  dataset: string;
  default_params: Partial<{
    source_key: string;
    metric: PermitMetric;
    destination_class: PermitDestination;
    granularity: "year" | "month";
  }> | null;
}
