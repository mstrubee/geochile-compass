/**
 * Población comunal: UNA sola fuente, el Censo de Población y Vivienda 2024 (INE), tabulado D1. Las RPC (get_poblacion_*) las crea
 * 20261104000000_censo_poblacion y todavía no están en `integrations/supabase/types.ts` (generado): el servicio las llama con un cast localizado.
 * Diseño y trazabilidad: docs/poblacion/RUNBOOK_CENSO2024.md.
 */

export const POBLACION_DATASET = "poblacion_censo2024";

/** Rótulo único de la cifra: «censada» = residentes habituales censados (definición del tabulado), no proyección. */
export const POBLACION_LABEL = "Población censada 2024 (INE)";
export const POBLACION_DEFINITION = "Residentes habituales censados en el Censo 2024 (INE). No es proyección ni estimación posterior.";
export const SIN_DATO = "sin dato";

/** Fila de get_poblacion_comunal(): una por comuna (las 346) de la captura vigente. */
export interface PoblacionComunalRow {
  cut: string;
  comuna: string;
  region_cut: string;
  total: number;
  hombres: number;
  mujeres: number;
  snapshot_id: string;
  period_start: string;
  period_end: string;
  /** fecha de PUBLICACIÓN que declara el tabulado (27-03-2025), distinta del período */
  declared_date: string | null;
}

/** Fila de get_poblacion_comunal_edad(): comuna × grupo de edad quinquenal (18 grupos). */
export interface PoblacionEdadRow {
  cut: string;
  grupo_edad: string;
  grupo_orden: number;
  total: number;
  hombres: number;
  mujeres: number;
  snapshot_id: string;
}

export type PoblacionStatus = "ok" | "empty" | "error";

export interface PoblacionMeta {
  snapshotId: string;
  periodStart: string;
  periodEnd: string;
  declaredDate: string | null;
}

/** Índice en memoria. `status` distingue «la base no tiene captura» (empty) de «la lectura falló» (error): en ambos casos la población es «sin dato», nunca otra cifra. */
export interface PoblacionIndex {
  status: PoblacionStatus;
  error: string | null;
  meta: PoblacionMeta | null;
  byCut: Map<string, PoblacionComunalRow>;
  byName: Map<string, PoblacionComunalRow>;
}
