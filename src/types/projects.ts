/**
 * Parte 4: de la comuna al proyecto — tipos de las tres capas puntuales/poligonales.
 * Las RPC (get_ine_permit_points, get_ine_crf_*, get_seia_*) las crean las migraciones 20261021120000/100/200 y todavía no están en
 * `integrations/supabase/types.ts` (generado): por eso el servicio las llama con un cast localizado.
 */

export const INE_PE_DATASET = "ine_permit_points";
export const INE_CRF_DATASET = "ine_crf";
export const SEIA_DATASET = "building_projects";

/** 1 HABITACIONAL, 2 MIXTO, 3 NO HABITACIONAL (igual que ine_pe_points.uso). */
export type PermitUso = 1 | 2 | 3;
/** 3 ALTA, 2 MODERADA, 1 BAJA, 0 sin dato (igual que ine_pe_points.geo_precision). */
export type PermitPrecision = 0 | 1 | 2 | 3;
/** 0 dentro · 1 near_border · 2 outside_declared · 3 comuna sin polígono. */
export type PointGeoStatus = 0 | 1 | 2 | 3;

export interface Bounds { west: number; south: number; east: number; north: number }

/** Fila de get_ine_permit_points(): un punto, o un cluster (kind = 'cluster', con los campos de punto en null). */
export interface InePermitPointRow {
  kind: "point" | "cluster";
  lon: number;
  lat: number;
  /** Registros agrupados. OJO: un registro NO es un permiso; lo que se suma son `units`. */
  n_points: number;
  units: number;
  area_m2: number | null;
  src_oid: number | null;
  comuna_cut: string | null;
  year: number | null;
  uso: PermitUso | null;
  glosa: string | null;
  floors: number | null;
  geo_precision: PermitPrecision | null;
  geo_status: PointGeoStatus | null;
}

export interface InePermitFilters {
  years: number[] | null;
  uso: PermitUso[] | null;
  /** Precisión mínima: 2 = MODERADA o mejor (por defecto), 1 = BAJA o mejor, 0 = todo incluido «sin dato». */
  minPrecision: PermitPrecision;
}

export interface IneCoverageRow {
  year: number;
  points: number;
  units: number;
  comunas: number;
  comunas_total: number;
  precision_high: number;
  precision_moderate: number;
  precision_low: number;
  precision_none: number;
  outside_declared: number;
}

export interface IneVsMinvuRow {
  year: number;
  ine_housing_units: number;
  ine_housing_only_units: number;
  minvu_units_same_comunas: number | null;
  ratio: number | null;
  minvu_national_units: number | null;
  ine_covered_comunas: number;
}

export interface CrfPolygonRow {
  src_oid: number;
  comuna_cut: string;
  year: number;
  dwellings: number;
  /** 0 válida tal cual · 1 reparada · 2 reparada con diferencia de área sobre el umbral (revisión pendiente). */
  geom_status: 0 | 1 | 2;
  geojson: string;
}

export interface CrfByComunaRow { comuna_cut: string; polygons: number; dwellings: number; lon: number | null; lat: number | null }

export interface CrfCoverageRow { year: number; polygons: number; dwellings: number; comunas: number; comunas_total: number; repaired: number }

/** 0 inside · 1 near_border · 2 outside_declared · 3 comuna_unmatched · 4 no_geometry · 5 comuna_without_polygon. */
export type ProjectGeoStatus = 0 | 1 | 2 | 3 | 4 | 5;

export interface SeiaProjectRow {
  service_layer: 1 | 2;
  expediente_id: number;
  name: string;
  form: "EIA" | "DIA";
  typology_letter: string;
  typology_name: string;
  status_declared: string;
  comunas_declared: string | null;
  titular: string | null;
  submitted_at: string | null;
  /** FECHA_CALIFICACION: NO es un permiso de edificación ni el inicio de obras. */
  qualified_at: string | null;
  /** DECLARADA por el titular, no ejecutada. */
  investment_usd: number | null;
  expediente_url: string | null;
  lon: number;
  lat: number;
  geo_status: ProjectGeoStatus;
  geo_distance_m: number | null;
  review_decision: "confirm_original" | "propose_correction" | "unlocatable" | null;
  proposed_lon: number | null;
  proposed_lat: number | null;
  review_note: string | null;
  snapshot_id: string;
  captured_at: string;
}

export interface SeiaFilters { states: string[] | null; forms: Array<"EIA" | "DIA"> | null; yearFrom: number | null; yearTo: number | null }

export interface SeiaSummaryRow { service_layer: 1 | 2; status_declared: string; geo_status: ProjectGeoStatus; projects: number; investment_usd: number | null }
