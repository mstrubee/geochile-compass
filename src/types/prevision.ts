/**
 * Salud, Fase 1b: previsión. Isapre (cartera de beneficiarios por comuna, Superintendencia de Salud) y CASEN regional (estimación).
 * Las RPC las crean 20261103000000_isapre_cartera y 20261103000100_casen_prevision; todavía no están en `integrations/supabase/types.ts` (generado).
 * Diseño: docs/salud/DISENO.md §3.
 */
import type { HealthAltaDef } from "@/types/health";

export const ISAPRE_DATASET = "isapre_cartera";
export const CASEN_DATASET = "casen_prevision";

export type IsapreSexo = "F" | "M" | "SI";
/** 0 = todas las edades · 12 = 60 años o más (tramos 60-64 … ≥100; el tramo «S/I» —edad sin dato— queda fuera). */
export const MIN_TRAMO_60 = 12;

export interface IsapreFilters {
  /** null = ambos sexos (y «sin información») */
  sexo: IsapreSexo | null;
  /** 0 = todas las edades; 12 = 60 años o más */
  minTramo: 0 | 12;
  /** D1: solo comunas SIN establecimiento de alta complejidad en la comuna (dos definiciones); null = todas */
  sinAlta: HealthAltaDef | null;
}
export const DEFAULT_ISAPRE_FILTERS: IsapreFilters = { sexo: null, minTramo: 0, sinAlta: null };

/** Métrica de la capa: beneficiarios Isapre (n.º) o penetración (% de la población censada 2024, 1b-2). */
export type IsapreMetric = "n" | "pct";
export const METRIC_LABEL: Record<IsapreMetric, string> = { n: "Beneficiarios (n.º)", pct: "Penetración (% de la población censada 2024)" };

/** Fila de get_isapre_comuna(): UNA por comuna con dato. [n_lo, n_hi] es el rango publicado; `exact` = ninguna celda suprimida (n_lo = n_hi). */
export interface IsapreComunaRow {
  cut: string;
  name: string;
  region_cut: string;
  n_lo: number;
  n_hi: number;
  exact: boolean;
  suppressed_cells: number;
  snapshot_id: string;
  period_end: string;
}

/**
 * Fila de get_isapre_penetracion() (1b-2): UNA por comuna (346). Numerador = SOLO lo publicado (mismo rango que get_isapre_comuna); denominador = población censada 2024 del MISMO
 * sexo y edad. Todo es null cuando falta: comuna sin fila Isapre (n_*, pct_*), sin población censada o con población 0 para el filtro (pct_*), o sin captura vigente.
 * `pct_*` NO se recorta a 100 %.
 */
export interface IsaprePenetracionRow {
  cut: string;
  name: string;
  region_cut: string;
  n_lo: number | null;
  n_hi: number | null;
  exact: boolean | null;
  poblacion: number | null;
  pct_lo: number | null;
  pct_hi: number | null;
  isapre_snapshot_id: string | null;
  isapre_period_end: string | null;
  censo_snapshot_id: string | null;
  censo_period_end: string | null;
}

/** Fila de get_isapre_resumen(): captura vigente (período ≠ fecha de publicación ≠ extracción) y estadísticas de la supresión. */
export interface IsapreResumenRow {
  snapshot_id: string;
  period_start: string;
  period_end: string;
  declared_date: string | null;
  extraction_date: string | null;
  suppress_below: number;
  cells: number;
  zeros_published: number;
  suppressed_primary: number;
  suppressed_complementary: number;
  groups: number;
  groups_total_suppressed: number;
}

/** Fila de get_isapre_resumen_sin_alta() (1b-1): agregado calculado con los conteos completos + el rango que sale de lo publicado. */
export interface IsapreSinAltaRow {
  comunas_sin_alta: number;
  comunas_con_dato: number;
  benef_exacto: number;
  benef_pub_lo: number;
  benef_pub_hi: number;
  consistente: boolean;
  /** 60+ en las unidades de tipo COMUNA con fila (sin «sin dato de comuna» ni «sin dato de región»): NO es el total del país */
  benef_total_comunas: number;
  snapshot_id: string;
  period_end: string;
  health_snapshot_id: string;
}

export type CasenSistema = "fonasa" | "isapre" | "ffaa" | "ninguno" | "otro" | "nosabe";

/** Fila de get_casen_prevision_region(): estimación SIEMPRE con intervalo de confianza del 95 %; sin valores (null) si no es publicable, con su motivo. */
export interface CasenRegionRow {
  region_cut: string;
  region_name: string;
  sistema: CasenSistema;
  publishable: boolean;
  reason: string | null;
  n_sample: number | null;
  pct: number | null;
  se: number | null;
  ci_lo: number | null;
  ci_hi: number | null;
  snapshot_id: string;
  period_end: string;
}
