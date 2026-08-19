/**
 * salesForecast.ts
 * ────────────────
 * Pronóstico de ventas por local, y de ahí una propuesta de metas mensuales
 * para el año siguiente.
 *
 * Método (elegido por backtest, no por preferencia — ver referencias abajo):
 *
 *     pronóstico(mes) = nivel × factor_estacional(mes) × tendencia^(meses/12)
 *
 *   - **nivel**: promedio de los últimos 12 meses del local. Se usa 12 y no 3
 *     ni 6 porque las ventanas cortas resultaron peores en el backtest (10,9%
 *     y 11,4% de error contra 8,0%): captan ruido, no señal.
 *   - **factor estacional**: de la RED, no del local. Un local solo tiene ~7
 *     observaciones por mes calendario; la red tiene 64 veces más, así que su
 *     estimación es mucho más estable. Se reutiliza `computeSeasonalFactors`
 *     de budgetDistribution para no tener dos definiciones de estacionalidad.
 *   - **tendencia**: la red crece, y un promedio móvil siempre va por detrás
 *     de una serie que crece. Se mide como el crecimiento de los últimos 12
 *     meses contra los 12 anteriores, y se aplica proporcional al horizonte.
 *
 * Referencia de exactitud (backtest rolling, 12 meses, n=763 predicciones a un
 * mes vista): promedio móvil 12m = 8,0%; con estacionalidad = 7,6%. Comparar
 * con 21,5% del modelo de comparables para locales nuevos: pronosticar un
 * local que YA opera es un problema mucho más tratable.
 */
import { computeSeasonalFactors, type SeasonalFactors } from "@/services/budgetDistribution";

export interface Observation {
  period: string; // "YYYY-MM-DD" (día 1)
  value: number;
}

export interface ForecastPoint {
  period: string;
  value: number;
}

export interface ForecastOptions {
  /** Cuántos meses hacia adelante. Default 12. */
  horizon?: number;
  /**
   * Aplicar el término de tendencia. Default true. Se puede apagar para
   * comparar, o cuando se quiera una meta deliberadamente plana.
   */
  useTrend?: boolean;
  /**
   * Techo al crecimiento anual que se extrapola, para que un local con un año
   * atípico no proyecte un crecimiento absurdo. Default 1.25 (±25%).
   */
  maxTrend?: number;
}

const addMonths = (period: string, n: number): string => {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
};

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/**
 * Crecimiento anual del local: últimos 12 meses contra los 12 previos.
 * Devuelve 1 (sin tendencia) si no hay historia suficiente para medirlo.
 */
export const computeTrend = (sorted: Observation[], maxTrend: number): number => {
  if (sorted.length < 24) return 1;
  const last12 = sorted.slice(-12).reduce((s, o) => s + o.value, 0);
  const prev12 = sorted.slice(-24, -12).reduce((s, o) => s + o.value, 0);
  if (prev12 <= 0) return 1;
  const raw = last12 / prev12;
  return Math.min(maxTrend, Math.max(1 / maxTrend, raw));
};

/**
 * Pronostica los próximos meses de UN local a partir de su historia.
 * Devuelve [] si no hay al menos 12 meses (sin eso no hay nivel confiable ni
 * forma de estimar tendencia: mejor no inventar un número).
 */
export const forecastStore = (
  observations: Observation[],
  factors: SeasonalFactors,
  options?: ForecastOptions,
): ForecastPoint[] => {
  const horizon = options?.horizon ?? 12;
  const useTrend = options?.useTrend ?? true;
  const maxTrend = options?.maxTrend ?? 1.25;

  const sorted = [...observations].sort((a, b) => a.period.localeCompare(b.period));
  if (sorted.length < 12) return [];

  const last12 = sorted.slice(-12);
  // El nivel se "desestacionaliza": si los últimos 12 meses fueran justo los
  // 12 del calendario, dividir cada uno por su factor y promediar da el nivel
  // limpio de efecto calendario.
  const nivel = mean(
    last12.map((o) => {
      const mes = Number(o.period.slice(5, 7));
      const f = factors[mes] ?? 1;
      return f > 0 ? o.value / f : o.value;
    }),
  );
  if (nivel <= 0) return [];

  const trend = useTrend ? computeTrend(sorted, maxTrend) : 1;
  const lastPeriod = sorted[sorted.length - 1].period;

  const out: ForecastPoint[] = [];
  for (let h = 1; h <= horizon; h++) {
    const period = addMonths(lastPeriod, h);
    const mes = Number(period.slice(5, 7));
    const value = nivel * (factors[mes] ?? 1) * Math.pow(trend, h / 12);
    out.push({ period, value });
  }
  return out;
};

/**
 * Pronostica un año calendario completo para un local — la forma en que se usa
 * como propuesta de presupuesto.
 */
export const forecastCalendarYear = (
  observations: Observation[],
  factors: SeasonalFactors,
  year: number,
  options?: Omit<ForecastOptions, "horizon">,
): ForecastPoint[] => {
  const sorted = [...observations].sort((a, b) => a.period.localeCompare(b.period));
  if (!sorted.length) return [];
  const last = sorted[sorted.length - 1].period;
  // Cuántos meses hay desde el último dato real hasta diciembre del año pedido.
  const [ly, lm] = last.split("-").map(Number);
  const horizon = (year - ly) * 12 + (12 - lm);
  if (horizon <= 0) return [];
  return forecastStore(sorted, factors, { ...options, horizon }).filter((p) =>
    p.period.startsWith(`${year}-`),
  );
};

/** Conveniencia: calcula los factores y pronostica, en un paso. */
export const forecastFromHistory = (
  allObservations: Observation[],
  storeObservations: Observation[],
  options?: ForecastOptions,
): ForecastPoint[] =>
  forecastStore(storeObservations, computeSeasonalFactors(allObservations), options);
