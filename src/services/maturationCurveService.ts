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
  /**
   * Fracción del nivel EN RÉGIMEN que alcanza el local en cada año de vida:
   * rampFactors[0] = año de apertura, [1] = segundo año, …
   *
   * Es la corrección de fondo: la estimación sale de comparables ya maduros,
   * o sea es el potencial EN RÉGIMEN de la ubicación. Un local recién abierto
   * no rinde eso desde el primer día —lo alcanza tras un par de años—, así que
   * arrancar la proyección en el 100% duplicaba el año de apertura.
   */
  rampFactors: number[];
  /** Crecimiento por año de vida, derivado de rampFactors. */
  rates: number[];
  /** Locales con apertura real usados para derivarla. */
  sampleSize: number;
  /** true si son los valores de respaldo (sin datos suficientes). */
  isFallback: boolean;
  /** true si la fijó el admin a mano, en vez de derivarse de los datos. */
  isCustom: boolean;
}

/**
 * Respaldo cuando no hay aperturas observadas: patrón medido en la red de
 * Autoplanet — se abre a la mitad del régimen y se madura hacia el año 2.
 */
const FALLBACK_RAMP = [0.49, 0.63, 1.0];

/** Año de vida en que se considera alcanzado el régimen. */
export const MATURITY_YEAR = FALLBACK_RAMP.length - 1;

/** Crecimiento año a año implícito en una rampa. */
const ratesFromRamp = (ramp: number[]): number[] => {
  const out: number[] = [];
  for (let i = 1; i < ramp.length; i++) {
    if (ramp[i - 1] > 0) out.push(Math.round((ramp[i] / ramp[i - 1] - 1) * 1000) / 1000);
  }
  return out;
};

/** Rampa fijada a mano por el admin, si existe y es válida. */
export const fetchCustomRamp = async (
  folderId: string,
): Promise<number[] | null> => {
  const { data } = await supabase
    .from("analysis_settings")
    .select("maturation_ramp")
    .eq("folder_id", folderId)
    .maybeSingle();
  const raw = (data as { maturation_ramp?: unknown } | null)?.maturation_ramp;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const nums = raw.map(Number).filter((n) => Number.isFinite(n) && n > 0);
  return nums.length === raw.length ? nums : null;
};

/** Guarda la rampa del admin. `null` vuelve a derivarla de los datos. */
export const saveCustomRamp = async (
  folderId: string,
  ramp: number[] | null,
): Promise<void> => {
  const { error } = await supabase
    .from("analysis_settings")
    .upsert(
      { folder_id: folderId, maturation_ramp: ramp } as never,
      { onConflict: "folder_id" },
    );
  if (error) throw error;
};

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Curva vigente para la carpeta.
 *
 * Con `ignoreCustom` se salta la fijada por el admin y devuelve la que sale de
 * los locales: sirve para mostrarla como recomendación al lado de la que él
 * definió.
 */
export const fetchMaturationCurve = async (
  folderId: string,
  { ignoreCustom = false }: { ignoreCustom?: boolean } = {},
): Promise<MaturationCurve> => {
  const fallback: MaturationCurve = {
    rampFactors: FALLBACK_RAMP,
    rates: ratesFromRamp(FALLBACK_RAMP),
    sampleSize: 0,
    isFallback: true,
    isCustom: false,
  };
  try {
    // Una curva fijada por el admin manda sobre la derivada: puede conocer el
    // negocio mejor que la muestra disponible.
    const custom = ignoreCustom ? null : await fetchCustomRamp(folderId);
    if (custom) {
      return {
        rampFactors: custom,
        rates: ratesFromRamp(custom),
        sampleSize: 0,
        isFallback: false,
        isCustom: true,
      };
    }
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

    // Nivel en régimen de cada local: promedio de sus años ya maduros.
    const ramps: Array<Record<number, number>> = [];
    for (const s of perStore) {
      const mature = Object.entries(s)
        .filter(([y]) => Number(y) >= MATURITY_YEAR)
        .map(([, v]) => v);
      if (mature.length === 0) continue;
      const steady = mature.reduce((a, b) => a + b, 0) / mature.length;
      if (steady <= 0) continue;
      const f: Record<number, number> = {};
      for (const [y, v] of Object.entries(s)) f[Number(y)] = v / steady;
      ramps.push(f);
    }
    if (ramps.length < 2) return fallback;

    const rampFactors: number[] = [];
    for (let y = 0; y <= MATURITY_YEAR; y++) {
      const xs = ramps.filter((r) => r[y] != null).map((r) => r[y]);
      if (xs.length < 2) break;
      rampFactors.push(Math.round(median(xs) * 1000) / 1000);
    }
    if (rampFactors.length < 2) return fallback;
    // El último año de la rampa ES el régimen por definición.
    rampFactors[rampFactors.length - 1] = 1;

    return {
      rampFactors,
      rates: ratesFromRamp(rampFactors),
      sampleSize: ramps.length,
      isFallback: false,
      isCustom: false,
    };
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
