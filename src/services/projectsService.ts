/**
 * Acceso a las RPC de la Parte 4. Se llaman con un cast localizado porque `integrations/supabase/types.ts` es generado y
 * todavía no las conoce (se regenera al aplicar las migraciones). Un error de la RPC se PROPAGA: nunca se muestra como «sin datos».
 */
import { supabase } from "@/integrations/supabase/client";
import type {
  Bounds, CrfByComunaRow, CrfCoverageRow, CrfPolygonRow, IneCoverageRow, InePermitFilters, InePermitPointRow, IneVsMinvuRow,
  SeiaFilters, SeiaProjectRow, SeiaSummaryRow,
} from "@/types/projects";

type RpcResult<T> = Promise<{ data: T | null; error: { message: string } | null }>;
const rpc = <T>(name: string, args: Record<string, unknown> = {}): RpcResult<T> =>
  (supabase.rpc as unknown as (n: string, a: Record<string, unknown>) => RpcResult<T>)(name, args);

const run = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T[]> => {
  const { data, error } = await rpc<T[]>(name, args);
  if (error) throw new Error(error.message);
  return data ?? [];
};

const bbox = (b: Bounds) => ({ p_west: b.west, p_south: b.south, p_east: b.east, p_north: b.north });

export const inePermitPointsArgs = (b: Bounds, zoom: number, f: InePermitFilters, limit = 3000) => ({
  ...bbox(b), p_zoom: Math.round(zoom), p_years: f.years && f.years.length ? f.years : null,
  p_uso: f.uso && f.uso.length ? f.uso : null, p_min_precision: f.minPrecision, p_limit: limit,
});

export const fetchInePermitPoints = (b: Bounds, zoom: number, f: InePermitFilters) =>
  run<InePermitPointRow>("get_ine_permit_points", inePermitPointsArgs(b, zoom, f));
export const fetchIneCoverage = () => run<IneCoverageRow>("get_ine_pe_coverage");
export const fetchIneVsMinvu = () => run<IneVsMinvuRow>("get_ine_pe_vs_minvu_by_year");

export const ineCrfPolygonsArgs = (b: Bounds, years: number[] | null, limit = 4000) => ({
  ...bbox(b), p_years: years && years.length ? years : null, p_limit: limit,
});
export const fetchIneCrfPolygons = (b: Bounds, years: number[] | null, limit = 4000) =>
  run<CrfPolygonRow>("get_ine_crf_polygons", ineCrfPolygonsArgs(b, years, limit));
export const fetchIneCrfByComuna = (years: number[] | null) =>
  run<CrfByComunaRow>("get_ine_crf_by_comuna", { p_years: years && years.length ? years : null });
export const fetchIneCrfCoverage = () => run<CrfCoverageRow>("get_ine_crf_coverage");

export const seiaProjectsArgs = (b: Bounds, f: SeiaFilters, limit = 6000) => ({
  ...bbox(b), p_states: f.states && f.states.length ? f.states : null, p_forms: f.forms && f.forms.length ? f.forms : null,
  p_year_from: f.yearFrom, p_year_to: f.yearTo, p_limit: limit,
});
export const fetchSeiaProjects = (b: Bounds, f: SeiaFilters) => run<SeiaProjectRow>("get_seia_projects", seiaProjectsArgs(b, f));
export const fetchSeiaSummary = () => run<SeiaSummaryRow>("get_seia_summary");
