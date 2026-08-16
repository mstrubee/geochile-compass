import { supabase } from "@/integrations/supabase/client";

/**
 * Detección de meses sin operación a partir de la serie de ventas.
 *
 * Un mes en cero NO equivale a "cerrado": puede ser un mes anterior a la
 * apertura del local. En los datos reales hay un caso con 43 meses en cero que
 * son simplemente los meses previos a que abriera. Por eso solo se consideran
 * cerrados los ceros POSTERIORES a la primera venta registrada.
 *
 * La detección es una sugerencia para revisar, no un marcado automático: un
 * vacío de carga de datos y un cierre real se ven idénticos en la serie.
 */
export interface PoiClosureStats {
  poiId: string;
  /** Primer mes con venta > 0. null si nunca registró ventas. */
  firstSale: string | null;
  /** Último mes con venta > 0. */
  lastSale: string | null;
  /** Meses en cero posteriores a la primera venta. */
  closedMonths: number;
  /** Meses en cero previos a la primera venta (aún no operaba). */
  preOpeningMonths: number;
  /** Racha más larga de meses en cero tras la apertura. */
  longestClosedRun: number;
}

/** A partir de cuántos meses cerrados se sugiere revisar el local. */
export const CLOSURE_REVIEW_MIN_MONTHS = 3;

interface MetricRow {
  poi_id: string;
  period: string;
  value: number | null;
}

/** Calcula las estadísticas de cierre para los POIs indicados. */
export const fetchClosureStats = async (
  poiIds: string[],
): Promise<Map<string, PoiClosureStats>> => {
  const ids = poiIds.filter(Boolean);
  if (ids.length === 0) return new Map();

  const rows: MetricRow[] = [];
  // Paginado: la serie mensual de una carpeta grande supera el tope por consulta.
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("poi_metrics")
      .select("poi_id, period, value")
      .eq("metric_key", "ventas")
      .in("poi_id", ids)
      .order("period", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data?.length) break;
    rows.push(...(data as MetricRow[]));
    if (data.length < PAGE) break;
  }

  const byPoi = new Map<string, MetricRow[]>();
  for (const r of rows) {
    const arr = byPoi.get(r.poi_id);
    if (arr) arr.push(r);
    else byPoi.set(r.poi_id, [r]);
  }

  const out = new Map<string, PoiClosureStats>();
  for (const [poiId, series] of byPoi) {
    const ordered = [...series].sort((a, b) => a.period.localeCompare(b.period));
    const sales = ordered.filter((r) => Number(r.value ?? 0) > 0);
    const firstSale = sales[0]?.period ?? null;
    const lastSale = sales[sales.length - 1]?.period ?? null;

    let closedMonths = 0;
    let preOpeningMonths = 0;
    let run = 0;
    let longestClosedRun = 0;
    for (const r of ordered) {
      const isZero = Number(r.value ?? 0) === 0;
      if (!isZero) { run = 0; continue; }
      if (firstSale == null || r.period < firstSale) {
        preOpeningMonths += 1;
      } else {
        closedMonths += 1;
        run += 1;
        if (run > longestClosedRun) longestClosedRun = run;
      }
    }

    out.set(poiId, {
      poiId, firstSale, lastSale, closedMonths, preOpeningMonths, longestClosedRun,
    });
  }
  return out;
};
