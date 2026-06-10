/**
 * poiFolderReportService.ts
 * ─────────────────────────
 * Reúne todos los datos necesarios para generar el informe PDF/Excel
 * de ventas de una carpeta de POIs (Autoplanet u otra).
 *
 * Fuentes:
 *   - poi_metrics        → histórico mensual de ventas (CLP)
 *   - poi_performance_analysis → real vs modelo + drivers + estado temporal
 *   - poi_attributes     → atributos estáticos (Centro SAP, Gerente, etc.)
 */

import { supabase } from "@/integrations/supabase/client";
import type { PoiFolder, SavedPoi } from "@/types/pois";
import type { PoiFolderSchema } from "@/types/poiMetrics";
import type { DriverContribution, TemporalState } from "@/types/analysis";

// ── helpers internos ─────────────────────────────────────────────────────────

const CHUNK = 200;
const PAGE  = 1_000;

/** Pagina queries PostgREST que pueden superar el límite de 1000 filas. */
const fetchPaginated = async <T,>(
  ids: string[],
  runPage: (chunk: string[], from: number, to: number) => Promise<T[]>,
): Promise<T[]> => {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    let from = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const to   = from + PAGE - 1;
      const rows = await runPage(slice, from, to);
      out.push(...rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
  }
  return out;
};

/** Devuelve el conjunto de IDs de la carpeta raíz y todas sus subcarpetas. */
const collectFolderIds = (rootId: string, allFolders: PoiFolder[]): Set<string> => {
  const out = new Set<string>([rootId]);
  const childrenOf = new Map<string, string[]>();
  for (const f of allFolders) {
    if (f.deleted_at || !f.parent_id) continue;
    const arr = childrenOf.get(f.parent_id) ?? [];
    arr.push(f.id);
    childrenOf.set(f.parent_id, arr);
  }
  const walk = (id: string) => {
    for (const c of childrenOf.get(id) ?? []) {
      if (!out.has(c)) { out.add(c); walk(c); }
    }
  };
  walk(rootId);
  return out;
};

/** Períodos espurios generados por columnas resumen mal parseadas. */
const SPURIOUS_PERIODS = new Set<string>(["2026-06-01"]);

// ── Tipos de salida públicos ─────────────────────────────────────────────────

export interface ReportPoi {
  id:       string;
  name:     string;
  address:  string;
  lat:      number;
  lng:      number;
  attrs:    Record<string, string>;

  /** Ventas CLP por período "YYYY-MM" (de poi_metrics). */
  monthlyCLP: Record<string, number>;

  /** De poi_performance_analysis (null si no se ha ejecutado). */
  actual_monthly_uf:   number | null;
  actual_monthly_clp:  number | null;
  predicted_monthly_uf: number | null;
  residual_pct:        number | null;
  temporal_state:      TemporalState | null;
  top_drivers:         DriverContribution[];
  target_year:         number | null;
}

export interface FolderReportTotals {
  nPois:        number;
  nWithSales:   number;
  last12mCLP:   number;
  prev12mCLP:   number;
  yoyPct:       number | null;
  avgMonthlyCLP: number;
}

export interface PoiFolderReportData {
  folder:      PoiFolder;
  generatedAt: string;
  pois:        ReportPoi[];

  /** Todos los períodos con datos, ordenados asc (YYYY-MM). */
  allPeriods:   string[];
  /** Últimos 12 períodos disponibles. */
  last12Periods: string[];
  /** 12 períodos anteriores a los últimos 12 (para YoY). */
  prev12Periods: string[];

  totals:           FolderReportTotals;
  hasPerformanceData: boolean;
}

// ── Función principal ────────────────────────────────────────────────────────

export const buildPoiFolderReport = async (
  folder:     PoiFolder,
  allFolders: PoiFolder[],
  allPois:    SavedPoi[],
  _schema?:   PoiFolderSchema,
): Promise<PoiFolderReportData> => {

  // 0) POIs del scope
  const targetIds    = collectFolderIds(folder.id, allFolders);
  const poisInScope  = allPois.filter(
    (p) => !p.deleted_at && p.folder_id && targetIds.has(p.folder_id),
  );
  if (poisInScope.length === 0) throw new Error("La carpeta no contiene POIs activos");
  const poiIds = poisInScope.map((p) => p.id);

  // 1) Atributos estáticos
  const attrRows = await fetchPaginated(poiIds, async (chunk, from, to) => {
    const { data, error } = await supabase
      .from("poi_attributes")
      .select("poi_id,attr_key,attr_value")
      .in("poi_id", chunk)
      .range(from, to);
    if (error) throw new Error(`poi_attributes: ${error.message}`);
    return (data ?? []) as Array<{ poi_id: string; attr_key: string; attr_value: string | null }>;
  });
  const attrsByPoi = new Map<string, Record<string, string>>();
  for (const r of attrRows) {
    const m = attrsByPoi.get(r.poi_id) ?? {};
    m[r.attr_key] = r.attr_value ?? "";
    attrsByPoi.set(r.poi_id, m);
  }

  // 2) Métricas de ventas mensuales
  const metricRows = await fetchPaginated(poiIds, async (chunk, from, to) => {
    const { data, error } = await supabase
      .from("poi_metrics")
      .select("poi_id,metric_key,period,value")
      .in("poi_id", chunk)
      .eq("metric_key", "ventas")
      .range(from, to);
    if (error) throw new Error(`poi_metrics: ${error.message}`);
    return (data ?? []) as Array<{
      poi_id:     string;
      metric_key: string;
      period:     string;
      value:      number;
    }>;
  });
  const periodSet  = new Set<string>();
  const metricByPoi = new Map<string, Record<string, number>>();
  for (const r of metricRows) {
    if (SPURIOUS_PERIODS.has(r.period)) continue;
    const ym = r.period.slice(0, 7); // YYYY-MM
    periodSet.add(ym);
    const m = metricByPoi.get(r.poi_id) ?? {};
    // Si hay duplicados por el mismo período, acumular (caso importación parcial)
    m[ym] = (m[ym] ?? 0) + r.value;
    metricByPoi.set(r.poi_id, m);
  }
  const allPeriods   = [...periodSet].sort();
  const last12Periods = allPeriods.slice(-12);
  const prev12Periods = allPeriods.slice(-24, -12);

  // 3) Performance analysis
  const perfRows = await fetchPaginated(poiIds, async (chunk, from, to) => {
    const { data, error } = await supabase
      .from("poi_performance_analysis")
      .select([
        "poi_id",
        "target_year",
        "actual_monthly_clp",
        "actual_monthly_uf",
        "predicted_monthly_uf_model_a",
        "residual_pct",
        "temporal_state",
        "top_drivers",
        "computed_at",
      ].join(","))
      .in("poi_id", chunk)
      .range(from, to);
    if (error) throw new Error(`poi_performance_analysis: ${error.message}`);
    return (data ?? []) as Array<Record<string, unknown>>;
  });
  // Nos quedamos con el análisis más reciente por poi_id
  const perfByPoi = new Map<string, Record<string, unknown>>();
  for (const r of perfRows) {
    const prev = perfByPoi.get(r.poi_id as string);
    if (!prev || (r.computed_at as string) > (prev.computed_at as string)) {
      perfByPoi.set(r.poi_id as string, r);
    }
  }

  // 4) Construir lista de POIs del reporte
  const reportPois: ReportPoi[] = poisInScope.map((p) => {
    const props   = (p.properties ?? {}) as Record<string, unknown>;
    const address = (typeof props.address === "string" && props.address)
      || (typeof props.direccion === "string" && props.direccion) || "";
    const attrs      = attrsByPoi.get(p.id) ?? {};
    const monthlyCLP = metricByPoi.get(p.id) ?? {};
    const perf       = perfByPoi.get(p.id);

    return {
      id:      p.id,
      name:    p.name,
      address,
      lat:     p.lat,
      lng:     p.lng,
      attrs,
      monthlyCLP,
      actual_monthly_uf:    (perf?.actual_monthly_uf   as number | null) ?? null,
      actual_monthly_clp:   (perf?.actual_monthly_clp  as number | null) ?? null,
      predicted_monthly_uf: (perf?.predicted_monthly_uf_model_a as number | null) ?? null,
      residual_pct:         (perf?.residual_pct         as number | null) ?? null,
      temporal_state:       (perf?.temporal_state as TemporalState | null) ?? null,
      top_drivers:          (perf?.top_drivers as DriverContribution[]) ?? [],
      target_year:          (perf?.target_year as number | null) ?? null,
    };
  });

  // Ordenar por ventas últimos 12m desc
  reportPois.sort((a, b) => {
    const aV = last12Periods.reduce((s, p) => s + (a.monthlyCLP[p] ?? 0), 0);
    const bV = last12Periods.reduce((s, p) => s + (b.monthlyCLP[p] ?? 0), 0);
    return bV - aV;
  });

  // 5) Totales de la carpeta
  let last12mCLP = 0, prev12mCLP = 0, nWithSales = 0;
  for (const poi of reportPois) {
    const l12 = last12Periods.reduce((s, p) => s + (poi.monthlyCLP[p] ?? 0), 0);
    const p12 = prev12Periods.reduce((s, p) => s + (poi.monthlyCLP[p] ?? 0), 0);
    if (l12 > 0) nWithSales++;
    last12mCLP += l12;
    prev12mCLP += p12;
  }
  const yoyPct = prev12mCLP > 0
    ? ((last12mCLP - prev12mCLP) / prev12mCLP) * 100
    : null;
  const avgMonthlyCLP = nWithSales > 0 && last12Periods.length > 0
    ? last12mCLP / nWithSales / last12Periods.length
    : 0;

  return {
    folder,
    generatedAt:  new Date().toISOString(),
    pois:         reportPois,
    allPeriods,
    last12Periods,
    prev12Periods,
    totals: {
      nPois:         reportPois.length,
      nWithSales,
      last12mCLP,
      prev12mCLP,
      yoyPct,
      avgMonthlyCLP,
    },
    hasPerformanceData: perfByPoi.size > 0,
  };
};
