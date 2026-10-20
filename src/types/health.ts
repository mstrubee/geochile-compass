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

/** AmbitoFuncionamiento de la fuente. Por defecto se cuentan solo «Establecimiento de Salud»: las unidades y los programas cuelgan de un establecimiento. */
export const AMBITO_ESTABLECIMIENTO = "Establecimiento de Salud";

export interface HealthFilters {
  includeClosed: boolean;
  /** null = todos los ámbitos (unidades de atención y programas incluidos) */
  ambito: string[] | null;
  /** tipo_norm de la tabla de clasificación; null = todos los tipos */
  tipo: string[] | null;
  dependencia: string[] | null;
  complejidad: HealthComplejidad[] | null;
  clase: HealthClase[] | null;
  alta: HealthAltaDef | null;
}

export const DEFAULT_HEALTH_FILTERS: HealthFilters = { includeClosed: false, ambito: [AMBITO_ESTABLECIMIENTO], tipo: null, dependencia: null, complejidad: null, clase: null, alta: null };

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

/** Fila de get_health_comuna_tipos(): qué hay detrás del número de una comuna. */
export interface HealthComunaTipoRow { tipo_glosa: string; ambito: string | null; estado: "vigente" | "cerrado"; n: number }

export interface HealthSummaryRow { dimension: string; value: string; n: number }

export interface HealthTipoRow {
  tipo_norm: string;
  tipo_label: string;
  clase: HealthClase | "mixto";
  alta_hospital: boolean;
  alta_ampliada: boolean;
  evidence: string;
}

/**
 * Capacidad de un hospital (20261108000000_health_capacity): respuesta de get_health_capacity(code). TODO lo ausente llega como null y la interfaz escribe «sin dato».
 * Pabellones (REM A21) NO están: van en otro PR cuando exista la fuente.
 */
export interface HealthCapacityBedArea { area: number; nombre: string; camas: number }
/** Último año de la captura vigente de dotación (camas asignadas por resolución). `total` es la fila «Total» PUBLICADA (null = no la trae); jamás se suma. */
export interface HealthCapacityDotacion { year: number; total: number | null; snapshot_id: string; areas: HealthCapacityBedArea[] }
export interface HealthCapacityOccArea { area: number; nombre: string; ocupados: number; disponibles: number; indice: number | null }
/** Ocupación de un período: índice = Σ días-cama ocupados / Σ disponibles × 100 sobre TODAS las áreas (fórmula oficial DEIS). `year` (+ `months` de `expected_months`) o `period` (AAAA-MM). */
export interface HealthCapacityOccupancy {
  year?: number; months?: number; expected_months?: number; period?: string;
  snapshot_id: string; ocupados: number; disponibles: number; indice: number | null; areas: HealthCapacityOccArea[];
}
export interface HealthCapacitySource {
  name: string; origin_url: string; sha256: string; declared_date: string | null; declared_date_note: string | null; captured_at: string;
  period_start: string; period_end: string; license_label: string | null; verification_status: string;
}
export type HealthCapacityField = "dotacion" | "ocupacion";
export interface HealthCapacity {
  code: string;
  /** null = el código no está en la captura vigente de establecimientos */
  snss: boolean | null;
  dependencia_norm: string | null;
  dotacion: HealthCapacityDotacion | null;
  ocupacion_anual: HealthCapacityOccupancy | null;
  ocupacion_mes: HealthCapacityOccupancy | null;
  fuentes: { dotacion: HealthCapacitySource | null; rem20: HealthCapacitySource | null };
  client_ready: Partial<Record<HealthCapacityField, { client_ready: boolean; note: string | null }>>;
}
