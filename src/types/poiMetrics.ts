/**
 * Tipos del subsistema de métricas configurables de POIs.
 * Espejo de las tablas creadas en la migración 20260508220000_poi_metrics_schemas.sql
 */

/** Define cómo se interpreta una columna de la planilla. */
export type MetricKind = "timeseries" | "static_number" | "static_text";

export type MetricFormat = "clp" | "int" | "decimal" | "percent" | "text";

export interface MetricDefinition {
  key: string; // p.ej. "ventas"
  label: string; // p.ej. "Ventas"
  kind: MetricKind;
  format: MetricFormat;
  /** Para series temporales: cómo agregar (sum, avg, last). Default: sum. */
  aggregation?: "sum" | "avg" | "last" | "max" | "min";
  /** Si true, los valores se asumen en miles/UF/etc. */
  scale?: number;
}

export type FolderSchemaType = "autoplanet" | "generic_wide" | "generic_long";

export interface PoiFolderSchema {
  folder_id: string;
  schema_type: FolderSchemaType;
  identity_columns: string[];
  metric_definitions: MetricDefinition[];
  static_columns: string[];
  import_enabled: boolean;
  created_at: string;
  updated_at: string;
}

/** Una observación temporal de una métrica para un POI. */
export interface PoiMetric {
  id: string;
  poi_id: string;
  metric_key: string;
  period: string; // ISO date "YYYY-MM-DD"
  value: number;
  source_import_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Atributo estático de un POI (e.g. Centro SAP, Gerente Zonal). */
export interface PoiAttribute {
  poi_id: string;
  attr_key: string;
  attr_value: string | null;
  source_import_id: string | null;
  updated_at: string;
}

/** Alias de dirección manualmente confirmado por el admin. */
export interface PoiAddressAlias {
  id: string;
  poi_id: string;
  normalized_address: string;
  raw_address: string | null;
  created_at: string;
}

/** Auditoría de una importación de Excel. */
export interface PoiImportJob {
  id: string;
  folder_id: string;
  filename: string;
  status: "pending" | "completed" | "failed" | "partial";
  rows_total: number;
  rows_matched_auto: number;
  rows_matched_manual: number;
  rows_unmatched: number;
  metric_keys: string[];
  period_min: string | null;
  period_max: string | null;
  error: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

/* ---------- Estados de la UI de importación ----------------- */

/** Una fila parseada del Excel, antes de matchear. */
export interface ImportRow {
  rowIndex: number; // índice 0-based en la planilla original
  identity: Record<string, string>; // {Centro Sap, Local, ...}
  rawAddress: string;
  normalizedAddress: string;
  comuna: string | null;
  staticAttrs: Record<string, string>; // valores literal de columnas estáticas
  metrics: Array<{ key: string; period: string; value: number }>;
}

export type RowMatchStatus =
  | "auto_matched"   // un POI dentro del threshold y único
  | "alias_matched"  // resuelto por alias previo
  | "needs_review"   // múltiples candidatos o ninguno cercano
  | "no_geocode"     // dirección no geocodificable
  | "manual_assigned"; // admin eligió en el mapa

export interface RowMatchResult {
  rowIndex: number;
  status: RowMatchStatus;
  /** Coordenadas geocodificadas (si las hubo). */
  geocoded: { lat: number; lng: number } | null;
  /** POI asignado (si lo hay). */
  assignedPoiId: string | null;
  /** Distancia al POI elegido en metros (si aplica). */
  distanceMeters: number | null;
  /** Candidatos cercanos para resolución manual. */
  candidates: Array<{ poiId: string; name: string; distanceMeters: number }>;
  /** Mensaje de error si la geocodificación falló. */
  error?: string;
}
