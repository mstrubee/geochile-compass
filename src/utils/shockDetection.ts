/**
 * Detección automática de regímenes (shocks y recuperación) en una serie
 * temporal de ventas.
 *
 * Algoritmo:
 *  1. Calcular z-score robusto por mes-del-año (controla estacionalidad):
 *     para cada mes m ∈ {1..12}, computar mediana y MAD (median absolute
 *     deviation) sobre los valores de ese mes a lo largo de los años, y
 *     z = (x - mediana) / (1.4826 * MAD).
 *  2. Marcar como "shock" cualquier punto con z < -1.5.
 *  3. Agrupar shocks contiguos (con gap ≤ 1 mes) en "períodos de crisis".
 *  4. La recuperación es desde el fin del último shock hasta el último
 *     dato disponible.
 *
 * Ventajas vs fechas hardcoded:
 *  - Funciona para locales que abrieron después del COVID (donde no
 *    había shock, no se inventa uno).
 *  - Captura shocks regionales no nacionales (e.g. Concepción vs Stgo).
 *  - Puede detectar futuros shocks sin código nuevo.
 *
 * Limitación: requiere ≥18 meses de datos para resultados confiables.
 */

import type { TemporalState } from "@/types/analysis";

export interface SeriesPoint {
  period: string; // "YYYY-MM-01"
  value: number; // monto (UF preferido, CLP también funciona)
}

export interface DetectedRegime {
  kind: "pre_shock" | "crisis" | "recovery";
  from: string;
  to: string;
  mean: number;
  median: number;
  count: number;
}

export interface ShockDetectionResult {
  regimes: DetectedRegime[];
  shockPeriods: string[]; // todos los meses individuales marcados shock
  hasInsufficientData: boolean;
  /** Ratio recuperación / pre-shock (1.0 = recuperado, > 1.0 = creciendo). */
  recoveryRatio: number | null;
  /** Aceleración últimos 3m vs media de 12m anteriores. */
  shortTermAcceleration: number | null;
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
};

const mad = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const m = median(xs);
  const devs = xs.map((x) => Math.abs(x - m));
  return median(devs);
};

const mean = (xs: number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

const monthOf = (period: string): number => parseInt(period.slice(5, 7), 10);
const yearOf = (period: string): number => parseInt(period.slice(0, 4), 10);

const periodsBetween = (a: string, b: string): number => {
  const ya = yearOf(a);
  const ma = monthOf(a);
  const yb = yearOf(b);
  const mb = monthOf(b);
  return (yb - ya) * 12 + (mb - ma);
};

/**
 * Detecta regímenes en la serie. Espera serie ordenada cronológicamente.
 */
export const detectShocks = (
  series: SeriesPoint[],
  options: { zThreshold?: number; minRunLength?: number } = {},
): ShockDetectionResult => {
  const { zThreshold = -1.5, minRunLength = 2 } = options;
  if (series.length < 18) {
    return {
      regimes: [],
      shockPeriods: [],
      hasInsufficientData: true,
      recoveryRatio: null,
      shortTermAcceleration: null,
    };
  }

  // 1) Agrupar por mes-del-año para z-score robusto.
  const byMonth = new Map<number, number[]>();
  for (const p of series) {
    const m = monthOf(p.period);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(p.value);
  }
  const stats = new Map<number, { med: number; mad: number }>();
  byMonth.forEach((vals, m) => {
    stats.set(m, { med: median(vals), mad: mad(vals) });
  });

  // 2) Marcar shocks: z < threshold, robusto.
  const shockMask: boolean[] = series.map((p) => {
    const s = stats.get(monthOf(p.period))!;
    if (s.mad === 0) {
      // Sin variabilidad: usar caída relativa como fallback.
      return p.value < s.med * 0.7;
    }
    const z = (p.value - s.med) / (1.4826 * s.mad);
    return z < zThreshold;
  });

  // 3) Agrupar runs contiguos (gap ≤ 1) para evitar fragmentar la crisis.
  const shockPeriods: string[] = [];
  series.forEach((p, i) => {
    if (shockMask[i]) shockPeriods.push(p.period);
  });

  // Detectar regímenes secuenciales:
  //   pre_shock = todo antes del primer shock
  //   crisis    = primer run grande de shocks (fusionando gaps cortos)
  //   recovery  = desde fin de crisis hasta el último dato
  const regimes: DetectedRegime[] = [];

  // Encontrar el run más largo de shocks (con gap-merge).
  type Run = { startIdx: number; endIdx: number; size: number };
  let bestRun: Run | null = null;
  let i = 0;
  while (i < shockMask.length) {
    if (!shockMask[i]) {
      i++;
      continue;
    }
    let start = i;
    let end = i;
    let cursor = i + 1;
    while (cursor < shockMask.length) {
      if (shockMask[cursor]) {
        end = cursor;
        cursor++;
      } else if (cursor + 1 < shockMask.length && shockMask[cursor + 1]) {
        // Gap de 1 mes: fusionar.
        end = cursor + 1;
        cursor += 2;
      } else {
        break;
      }
    }
    const size = end - start + 1;
    if (size >= minRunLength && (!bestRun || size > bestRun.size)) {
      bestRun = { startIdx: start, endIdx: end, size };
    }
    i = cursor;
  }

  if (bestRun) {
    // Pre-shock
    if (bestRun.startIdx > 0) {
      const slice = series.slice(0, bestRun.startIdx);
      const vals = slice.map((p) => p.value);
      regimes.push({
        kind: "pre_shock",
        from: slice[0].period,
        to: slice[slice.length - 1].period,
        mean: mean(vals),
        median: median(vals),
        count: slice.length,
      });
    }
    // Crisis
    const crisis = series.slice(bestRun.startIdx, bestRun.endIdx + 1);
    const cVals = crisis.map((p) => p.value);
    regimes.push({
      kind: "crisis",
      from: crisis[0].period,
      to: crisis[crisis.length - 1].period,
      mean: mean(cVals),
      median: median(cVals),
      count: crisis.length,
    });
    // Recovery
    if (bestRun.endIdx + 1 < series.length) {
      const rec = series.slice(bestRun.endIdx + 1);
      const rVals = rec.map((p) => p.value);
      regimes.push({
        kind: "recovery",
        from: rec[0].period,
        to: rec[rec.length - 1].period,
        mean: mean(rVals),
        median: median(rVals),
        count: rec.length,
      });
    }
  } else {
    // No hubo crisis detectable: toda la serie es "recovery" (estable).
    regimes.push({
      kind: "recovery",
      from: series[0].period,
      to: series[series.length - 1].period,
      mean: mean(series.map((p) => p.value)),
      median: median(series.map((p) => p.value)),
      count: series.length,
    });
  }

  // Ratios derivados
  const pre = regimes.find((r) => r.kind === "pre_shock");
  const recovery = regimes.find((r) => r.kind === "recovery");
  const recoveryRatio =
    pre && pre.mean > 0 && recovery ? recovery.mean / pre.mean : null;

  // Aceleración corto plazo: media últimos 3m / media meses 4..15.
  let shortTermAcceleration: number | null = null;
  if (series.length >= 15) {
    const last3 = series.slice(-3).map((p) => p.value);
    const prior12 = series.slice(-15, -3).map((p) => p.value);
    if (mean(prior12) > 0) {
      shortTermAcceleration = mean(last3) / mean(prior12) - 1;
    }
  }

  return {
    regimes,
    shockPeriods,
    hasInsufficientData: false,
    recoveryRatio,
    shortTermAcceleration,
  };
};

/**
 * Clasifica el estado del local a partir de la detección.
 *  · recovered_growing: ratio ≥ 1.05 y aceleración ≥ 0
 *  · stable:            0.95 ≤ ratio < 1.05
 *  · decelerating:      ratio ≥ 0.95 y aceleración < -0.05
 *  · not_recovered:     0.7 ≤ ratio < 0.95
 *  · at_risk:           ratio < 0.7  (más de 30% bajo pre-shock)
 *  · insufficient_data: < 18 meses
 */
export const classifyTemporalState = (det: ShockDetectionResult): TemporalState => {
  if (det.hasInsufficientData) return "insufficient_data";
  const r = det.recoveryRatio;
  const a = det.shortTermAcceleration ?? 0;
  if (r == null) return "stable"; // sin pre_shock → no hay base
  if (r < 0.7) return "at_risk";
  if (r < 0.95) return "not_recovered";
  if (r < 1.05) return a < -0.05 ? "decelerating" : "stable";
  return a < -0.05 ? "decelerating" : "recovered_growing";
};
