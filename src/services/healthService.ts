/**
 * Acceso a las RPC de Salud (Fase 1a). Se llaman con un cast localizado porque `integrations/supabase/types.ts` es generado y todavía no las conoce
 * (se regenera al aplicar las migraciones). Un error de la RPC se PROPAGA: nunca se muestra como «sin datos».
 */
import { supabase } from "@/integrations/supabase/client";
import type { Bounds } from "@/types/projects";
import type { HealthComunaCountRow, HealthComunaTipoRow, HealthEstablishmentRow, HealthFilters, HealthSummaryRow, HealthTipoRow } from "@/types/health";

type RpcResult<T> = Promise<{ data: T | null; error: { message: string } | null }>;
const rpc = <T>(name: string, args: Record<string, unknown> = {}): RpcResult<T> =>
  (supabase.rpc as unknown as (n: string, a: Record<string, unknown>) => RpcResult<T>)(name, args);

const run = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T[]> => {
  const { data, error } = await rpc<T[]>(name, args);
  if (error) throw new Error(error.message);
  return data ?? [];
};

/** Un arreglo vacío significa «sin filtro» y viaja como null. */
const arr = <T>(a: T[] | null | undefined) => (a && a.length ? a : null);

export const healthFilterArgs = (f: HealthFilters) => ({
  p_include_closed: f.includeClosed, p_dependencia: arr(f.dependencia), p_complejidad: arr(f.complejidad), p_clase: arr(f.clase), p_alta: f.alta,
  p_ambito: arr(f.ambito), p_tipo: arr(f.tipo),
});

export const healthPointsArgs = (b: Bounds, f: HealthFilters, limit = 6000) => ({
  p_west: b.west, p_south: b.south, p_east: b.east, p_north: b.north, ...healthFilterArgs(f), p_limit: limit,
});

export const fetchHealthEstablishments = (b: Bounds, f: HealthFilters) => run<HealthEstablishmentRow>("get_health_establishments", healthPointsArgs(b, f));
export const fetchHealthComunaCounts = (f: HealthFilters) => run<HealthComunaCountRow>("get_health_comuna_counts", healthFilterArgs(f));
export const fetchHealthComunaTipos = (cut: string) => run<HealthComunaTipoRow>("get_health_comuna_tipos", { p_cut: cut });
export const fetchHealthSummary = () => run<HealthSummaryRow>("get_health_summary");
export const fetchHealthTipos = () => run<HealthTipoRow>("get_health_tipo_clasificacion");
