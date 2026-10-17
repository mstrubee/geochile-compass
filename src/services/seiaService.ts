/**
 * Acceso a las RPC del módulo «Proyectos SEIA».
 *
 * `get_seia_projects`, `get_seia_facets` y `get_seia_project` las crea 20261021120100_seia_projects_read.sql y todavía no están en
 * `integrations/supabase/types.ts` (archivo generado: se regenera al aplicar las migraciones). Hasta entonces se llaman con un cast
 * explícito y localizado aquí (mismo criterio que permitsService.ts).
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchLayerProvenance } from "@/services/permitsService";
import type { Bbox, SeiaFacets, SeiaFilters, SeiaProjectDetail, SeiaProjectRow } from "@/types/seia";
import { MAX_POINTS, projectsArgs } from "@/utils/seiaFilters";

type RpcResult<T> = Promise<{ data: T | null; error: { message: string } | null }>;
const rpc = <T>(name: string, args: Record<string, unknown>): RpcResult<T> =>
  (supabase.rpc as unknown as (n: string, a: Record<string, unknown>) => RpcResult<T>)(name, args);

export const fetchSeiaProjects = async (bbox: Bbox, filters: SeiaFilters, limit = MAX_POINTS): Promise<SeiaProjectRow[]> => {
  const { data, error } = await rpc<SeiaProjectRow[]>("get_seia_projects", projectsArgs(bbox, filters, limit));
  if (error) throw new Error(error.message);
  return data ?? [];
};

export const fetchSeiaFacets = async (sourceKeys: string[] | null): Promise<SeiaFacets> => {
  const { data, error } = await rpc<SeiaFacets>("get_seia_facets", { p_source_keys: sourceKeys && sourceKeys.length ? sourceKeys : null });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("get_seia_facets no devolvió datos");
  return data;
};

/** `null` si ya no hay un proyecto VIGENTE con ese expediente (la carga siguiente pudo retirarlo). */
export const fetchSeiaProject = async (sourceKey: string, externalId: string): Promise<SeiaProjectDetail | null> => {
  const { data, error } = await rpc<SeiaProjectDetail | null>("get_seia_project", { p_source_key: sourceKey, p_external_id: externalId });
  if (error) throw new Error(error.message);
  return data ?? null;
};

/** Fuente(s), captura y frescura de lo que alimenta la capa: la misma RPC que usa permisos, con el dataset de proyectos. */
export const fetchSeiaProvenance = () => fetchLayerProvenance("building_projects");
