/**
 * Salud, Fase 1a: registro de establecimientos (DEIS/MINSAL). Las RPC (get_health_*) las crea 20261102000000_health_establishments y todavía no
 * están en `integrations/supabase/types.ts` (generado): el servicio las llama con un cast localizado. Diseño: docs/salud/DISENO.md §2.
 */

export const HEALTH_DATASET = "health_establishments";

/** 0 dentro · 1 borde · 2 costero · 3 fuera_declarada · 4 sin_coordenadas · 5 comuna_sin_poligono · 6 coordenada_invalida. Se marca, jamás se mueve. */
export type HealthGeoStatus = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type HealthClase = "ambulatorio" | "hospitalario" | "sin_clasificar";
export type HealthClaseFuente = "oficial" | "tabla" | "sin_clasificar";
export type HealthComplejidad = "alta" | "mediana" | "baja" | "no_aplica" | "sin_dato";
/** D1: «hospital» = alta complejidad y tipo Hospital (por defecto) · «ampliada» = además Clínicas y Centros de Especialidades. */
export type HealthAltaDef = "hospital" | "ampliada";

export interface HealthFilters {
  includeClosed: boolean;
  dependencia: string[] | null;
  complejidad: HealthComplejidad[] | null;
  clase: HealthClase[] | null;
  alta: HealthAltaDef | null;
}

export const DEFAULT_HEALTH_FILTERS: HealthFilters = { includeClosed: false, dependencia: null, complejidad: null, clase: null, alta: null };

/** Fila de get_health_establishments(). */
export interface HealthEstablishmentRow {
  code: string;
  name: string;
  tipo_glosa: string;
  comuna_cut: string;
  comuna_name: string;
  dependencia_norm: string;
  complejidad: HealthComplejidad;
  tipo_atencion: string;
  clase_servicio: HealthClase;
  clase_fuente: HealthClaseFuente;
  estado: "vigente" | "cerrado";
  alta_hospital: boolean;
  alta_ampliada: boolean;
  tiene_urgencia: boolean | null;
  address: string | null;
  lon: number;
  lat: number;
  geo_status: HealthGeoStatus;
  geo_distance_m: number | null;
  total_matching: number;
  snapshot_id: string;
  captured_at: string;
}

/** Fila de get_health_comuna_counts(): una por comuna (las 346). `establishments` es un conteo REAL (0 = cero verdadero). */
export interface HealthComunaCountRow {
  cut: string;
  name: string;
  region_cut: string;
  region_name: string;
  establishments: number;
  /** de los contados, cuántos tienen la clase imputada por la tabla de diseño (advertencia regla 3) */
  imputed: number;
  not_drawable: number;
  marked_geo: number;
  rank: number;
  snapshot_id: string;
  captured_at: string;
}

export interface HealthSummaryRow { dimension: string; value: string; n: number }

export interface HealthTipoRow {
  tipo_norm: string;
  tipo_label: string;
  clase: HealthClase | "mixto";
  alta_hospital: boolean;
  alta_ampliada: boolean;
  evidence: string;
}
