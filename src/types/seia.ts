/**
 * Proyectos del SEIA — tipos de la capa de puntos.
 * Las RPC viven en supabase/migrations/20261021120100_seia_projects_read.sql (diseño: docs/permisos-edificacion/DISENO.md,
 * «Parte 4 – SEIA»). Aún no están en `integrations/supabase/types.ts` (archivo generado): el servicio las llama con un cast.
 *
 * Semántica que NO se debe perder en la interfaz: solo proyectos que ingresan al SEIA (no es un catastro de edificación);
 * `qualified_at` no es permiso ni inicio de obras; `investment_usd` es DECLARADA.
 */

/** Resultado de la validación punto-en-polígono contra la comuna que declara el propio expediente. */
export type SeiaGeoStatus = "inside" | "near_border" | "outside_declared" | "comuna_unmatched" | "no_geometry" | "pending";
export type SeiaKind = "EIA" | "DIA";

export interface Bbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Filtros del panel. `null` = sin filtro (todas); nunca se envía un arreglo vacío. */
export interface SeiaFilters {
  /** Letras de tipología (la parte anterior al punto: «h» casa con «h.1»). */
  typology: string[] | null;
  /** ESTADO_EVALUACION exacto, tal como lo informa el servicio. */
  statuses: string[] | null;
  yearFrom: number | null;
  yearTo: number | null;
  /** Oculta `outside_declared` y `comuna_unmatched`. */
  hideFlagged: boolean;
  sourceKeys: string[] | null;
}

/** Fila de `get_seia_projects()`. El punto es el ORIGINAL del servicio; la corrección de una revisión viene aparte. */
export interface SeiaProjectRow {
  id: number;
  source_key: string;
  kind: SeiaKind;
  external_id: string;
  name: string | null;
  typology_letter: string | null;
  typology_name: string | null;
  status_declared: string | null;
  submitted_at: string | null;
  qualified_at: string | null;
  investment_usd: number | null;
  lon: number;
  lat: number;
  geo_check_status: SeiaGeoStatus;
  review_decision: "confirmed_ok" | "confirmed_error" | "corrected" | null;
  review_lon: number | null;
  review_lat: number | null;
  /** Coincidencias totales con los filtros en este recuadro (puede ser mayor que las filas devueltas). */
  total_matching: number;
}

/** `get_seia_facets()`: valores REALES para los filtros y calidad de ubicación de lo vigente. */
export interface SeiaFacets {
  total: number;
  with_point: number;
  by_source: Record<string, number>;
  geo_status: Partial<Record<SeiaGeoStatus, number>>;
  typologies: { letter: string | null; name: string | null; n: number }[];
  statuses: { value: string | null; n: number }[];
  year_min: number | null;
  year_max: number | null;
}

export interface SeiaReview {
  decision: "confirmed_ok" | "confirmed_error" | "corrected";
  note: string;
  reviewed_at: string;
  reviewed_by: string;
  proposed_lon: number | null;
  proposed_lat: number | null;
}

/** `get_seia_project()`: la ficha de un expediente con su procedencia. */
export interface SeiaProjectDetail {
  project: {
    id: number;
    source_key: string;
    kind: SeiaKind;
    external_id: string;
    name: string | null;
    submission_form_declared: string | null;
    typology_letter: string | null;
    typology_name: string | null;
    region_declared: string | null;
    comunas_declared: string | null;
    comuna_cuts: string[];
    comunas_unresolved: string[];
    titular: string | null;
    status_declared: string | null;
    submitted_at: string | null;
    qualified_at: string | null;
    investment_usd: number | null;
    expediente_url: string | null;
    lon: number | null;
    lat: number | null;
    geo_check_status: SeiaGeoStatus;
    geo_check_distance_m: number | null;
    geo_check_detail: { tolerance_m?: number; unresolved?: string[] } | null;
  };
  /** Atributos del servicio que no tienen columna propia (OBJECTID, X, Y, fechas en epoch…). */
  raw: Record<string, unknown>;
  source: { name: string; publisher: string; landing_url: string; attribution: string; verification_status: string; scope_note: string | null };
  snapshot: { id: string; origin_url: string; captured_at: string; declared_date: string | null; sha256: string };
  reviews: SeiaReview[];
}

/** Parámetros por defecto de la hoja del árbol (`thematic_layers.default_params`). Son DATOS, editables por un admin. */
export interface SeiaLayerDefaults {
  sourceKeys: string[] | null;
  typology: string[] | null;
}
