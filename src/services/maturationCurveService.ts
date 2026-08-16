import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_GROWTH_RATE } from "@/services/salesProjectionService";

/**
 * Curva de maduración: cuánto crece un local en cada año de vida.
 *
 * El 3% por defecto es la tasa de un local EN RÉGIMEN. Uno recién abierto
 * crece mucho más rápido los primeros años, así que aplicar 3% plano desde el
 * año uno subestima la rampa.
 *
 * Se deriva de los locales de la red que abrieron DENTRO de la ventana de
 * datos. La distinción importa: en la mayoría, la primera venta registrada
 * coincide con el inicio de la serie (2019-01), o sea es el comienzo de los
 * datos y no su apertura real — tomarlos como aperturas mezclaría "años desde
 * 2019" con "años de vida del local".
 *
 * Las ventas se normalizan a UF para que la inflación no se cuele como
 * crecimiento.
 */
export interface MaturationCurve {
  /** Crecimiento por año de vida: rates[0] = del año 0 al 1, rates[1] = del 1 al 2, … */
  rates: number[];
  /** Locales con apertura real usados para derivarla. */
  sampleSize: number;
  /** true si son los valores de respaldo (sin datos suficientes). */
  isFallback: boolean;
}

/**
 * Respaldo cuando no hay aperturas observadas. Refleja el patrón medido en la
 * red de Autoplanet (rampa fuerte hasta el año 2, luego régimen).
 */
const FALLBACK_RATES = [0.27, 0.43, 0.03];

/** Años de vida a partir de los cuales se asume régimen. */
export const MATURITY_YEAR = FALLBACK_RATES.length;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const fetchMaturationCurve = async (
  folderId: string,
): Promise<MaturationCurve> => {
  const fallback: MaturationCurve = {
    rates: FALLBACK_RATES,
    sampleSize: 0,
    isFallback: true,
  };
  try {
    const { data: pois } = await supabase
      .from("pois")
      .select("id")
      .eq("folder_id", folderId)
      .is("deleted_at", null);
    if (!pois?.length) return fallback;

    const ids = pois.map((p) => p.id);
    const [{ data: metrics }, { data: ufRows }] = await Promise.all([
      supabase
        .from("poi_metrics")
        .select("poi_id, period, value")
        .eq("metric_key", "ventas")
        .in("poi_id", ids)
        .order("period", { ascending: true }),
      supabase.from("uf_values").select("period, value"),
    ]);
    if (!metrics?.length || !ufRows?.length) return fallback;

    const uf = new Map<string, number>();
    for (const r of ufRows) if (r.value) uf.set(String(r.period).slice(0, 10), Number(r.value));

    // Serie en UF, solo meses con venta.
    const byPoi = new Map<string, Array<{ period: string; uf: number }>>();
    let seriesStart = "9999-12-31";
    for (const m of metrics) {
      const v = Number(m.value ?? 0);
      if (v <= 0) continue;
      const period = String(m.period).slice(0, 10);
      const ufv = uf.get(period);
      if (!ufv) continue;
      const arr = byPoi.get(m.poi_id) ?? [];
      arr.push({ period, uf: v / ufv });
      byPoi.set(m.poi_id, arr);
      if (period < seriesStart) seriesStart = period;
    }

    // Promedio anual por año de vida, solo para aperturas reales.
    const perStore: Array<Record<number, number>> = [];
    for (const [, series] of byPoi) {
      const opening = series[0]?.period;
      if (!opening) continue;
      // Si la primera venta cae al inicio de la serie, el local ya venía
      // operando: no conocemos su apertura y no sirve para la curva.
      if (opening <= seriesStart) continue;

      const openMs = new Date(opening).getTime();
      const sums: Record<number, { sum: number; n: number }> = {};
      for (const p of series) {
        const years = Math.floor(
          (new Date(p.period).getTime() - openMs) / (365.25 * 24 * 3600 * 1000),
        );
        const b = sums[years] ?? { sum: 0, n: 0 };
        b.sum += p.uf;
        b.n += 1;
        sums[years] = b;
      }
      const avg: Record<number, number> = {};
      for (const [y, b] of Object.entries(sums)) {
        // Menos de 6 meses en un año de vida no da un promedio confiable.
        if (b.n >= 6) avg[Number(y)] = b.sum / b.n;
      }
      if (Object.keys(avg).length >= 2) perStore.push(avg);
    }

    if (perStore.length < 2) return fallback;

    const rates: number[] = [];
    for (let y = 0; y < MATURITY_YEAR; y++) {
      const gs = perStore
        .filter((s) => s[y] != null && s[y + 1] != null && s[y] > 0)
        .map((s) => s[y + 1] / s[y] - 1);
      if (gs.length < 2) break;
      rates.push(Math.round(median(gs) * 1000) / 1000);
    }
    if (rates.length === 0) return fallback;

    return { rates, sampleSize: perStore.length, isFallback: false };
  } catch {
    return fallback;
  }
};

/** Tasa a aplicar en el año `i` de la proyección (0 = año base). */
export const rateForYear = (
  curve: MaturationCurve | null,
  i: number,
  steadyRate = DEFAULT_GROWTH_RATE,
): number => {
  if (!curve || i <= 0) return steadyRate;
  return curve.rates[i - 1] ?? steadyRate;
};
