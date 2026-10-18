/**
 * Acceso a las RPC de previsión (Fase 1b). Cast localizado: `integrations/supabase/types.ts` es generado y todavía no las conoce.
 * Un error de la RPC se PROPAGA: nunca se muestra como «sin datos».
 */
import { supabase } from "@/integrations/supabase/client";
import type { HealthAltaDef } from "@/types/health";
import type { CasenRegionRow, IsapreComunaRow, IsapreFilters, IsapreResumenRow, IsapreSinAltaRow } from "@/types/prevision";

type RpcResult<T> = Promise<{ data: T | null; error: { message: string } | null }>;
const rpc = <T>(name: string, args: Record<string, unknown> = {}): RpcResult<T> =>
  (supabase.rpc as unknown as (n: string, a: Record<string, unknown>) => RpcResult<T>)(name, args);

const run = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T[]> => {
  const { data, error } = await rpc<T[]>(name, args);
  if (error) throw new Error(error.message);
  return data ?? [];
};

export const isapreComunaArgs = (f: IsapreFilters) => ({ p_sexo: f.sexo, p_min_tramo: f.minTramo, p_sin_alta: f.sinAlta });

export const fetchIsapreComuna = (f: IsapreFilters) => run<IsapreComunaRow>("get_isapre_comuna", isapreComunaArgs(f));
export const fetchIsapreResumen = () => run<IsapreResumenRow>("get_isapre_resumen");
export const fetchIsapreSinAlta = (alta: HealthAltaDef, minTramo: number) => run<IsapreSinAltaRow>("get_isapre_resumen_sin_alta", { p_alta: alta, p_min_tramo: minTramo });
export const fetchCasenRegion = () => run<CasenRegionRow>("get_casen_prevision_region");
