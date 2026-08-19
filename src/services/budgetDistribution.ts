/**
 * budgetDistribution.ts
 * ─────────────────────
 * Reparte un presupuesto ANUAL (un solo número por local) en 12 metas
 * mensuales.
 *
 * Por qué no dividir por 12: la red tiene estacionalidad real y medible.
 * Sobre los 91 meses de historia, diciembre y enero pesan ~1,05 veces el mes
 * promedio y abril 0,905 — un 15% de diferencia entre puntas. Repartir en
 * partes iguales haría que el local aparezca "bajo presupuesto" cada abril y
 * "sobre presupuesto" cada diciembre por puro calendario, no por desempeño.
 *
 * Los factores NO están hardcodeados: se calculan desde las ventas reales
 * (ver `computeSeasonalFactors`), así se actualizan solos a medida que entra
 * más historia.
 */
import type { ImportRow } from "@/types/poiMetrics";

/** Factores por mes calendario (1..12). 1.0 = mes promedio. */
export type SeasonalFactors = Record<number, number>;

const FLAT: SeasonalFactors = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [i + 1, 1]),
) as SeasonalFactors;

/**
 * Calcula los factores estacionales desde una serie de ventas reales.
 *
 * Se normaliza CADA AÑO contra su propio promedio antes de agregar, para que
 * el crecimiento de la red no se cuele como si fuera estacionalidad: sin eso,
 * en una red que crece los meses tardíos del año parecen "mejores" solo por
 * ser posteriores.
 */
export const computeSeasonalFactors = (
  observations: Array<{ period: string; value: number }>,
): SeasonalFactors => {
  // Total de la red por mes (YYYY-MM).
  const byMonth = new Map<string, number>();
  for (const o of observations) {
    const ym = o.period.slice(0, 7);
    byMonth.set(ym, (byMonth.get(ym) ?? 0) + o.value);
  }

  // Promedio de cada año, contando solo años completos (12 meses) para no
  // sesgar con un año parcial.
  const byYear = new Map<string, Map<number, number>>();
  for (const [ym, total] of byMonth) {
    const [y, m] = ym.split("-");
    if (!byYear.has(y)) byYear.set(y, new Map());
    byYear.get(y)!.set(Number(m), total);
  }

  const ratios = new Map<number, number[]>();
  for (const [, months] of byYear) {
    if (months.size < 12) continue;
    const avg = [...months.values()].reduce((a, b) => a + b, 0) / months.size;
    if (avg <= 0) continue;
    for (const [m, total] of months) {
      if (!ratios.has(m)) ratios.set(m, []);
      ratios.get(m)!.push(total / avg);
    }
  }

  if (ratios.size < 12) return FLAT;

  const factors: SeasonalFactors = { ...FLAT };
  for (const [m, vals] of ratios) {
    factors[m] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }

  // Renormalizar para que el promedio de los 12 factores sea exactamente 1:
  // así repartir un total anual conserva el total.
  const mean = Object.values(factors).reduce((a, b) => a + b, 0) / 12;
  if (mean > 0) for (const m of Object.keys(factors)) factors[Number(m)] /= mean;

  return factors;
};

/**
 * Detecta si los períodos de un año representan un TOTAL ANUAL (una sola
 * columna, típicamente el año suelto: "2027") o metas ya mensuales.
 * Regla: un año con un único período se trata como total anual; con dos o más,
 * se asume que el archivo ya viene desglosado y no se toca.
 */
const annualYears = (periods: string[]): Set<string> => {
  const perYear = new Map<string, Set<string>>();
  for (const p of periods) {
    const y = p.slice(0, 4);
    if (!perYear.has(y)) perYear.set(y, new Set());
    perYear.get(y)!.add(p);
  }
  const annual = new Set<string>();
  for (const [y, ps] of perYear) if (ps.size === 1) annual.add(y);
  return annual;
};

export interface DistributionResult {
  rows: ImportRow[];
  /** Años que se repartieron (venían como total anual). */
  distributedYears: string[];
  /** Años que ya venían mensualizados y se dejaron intactos. */
  monthlyYears: string[];
  /**
   * Aviso cuando el año declarado al importar no coincide con el que traen las
   * columnas del archivo. No se corrige en silencio: manda el año declarado,
   * pero se avisa para que se pueda revisar el archivo.
   */
  yearMismatch: string | null;
}

export interface DistributeOptions {
  /**
   * Año del presupuesto, declarado explícitamente al importar. Manda sobre lo
   * que digan los encabezados: un archivo con la columna "2027" cargado como
   * presupuesto 2028 se guarda en 2028. Evita que un encabezado mal escrito
   * mande metas al año equivocado sin que nadie lo note.
   */
  targetYear?: number;
}

/**
 * Expande los totales anuales de cada fila en 12 metas mensuales.
 * Las filas cuyo año ya viene desglosado pasan sin cambios.
 */
export const distributeAnnualBudget = (
  rows: ImportRow[],
  factors: SeasonalFactors,
  options?: DistributeOptions,
): DistributionResult => {
  const allPeriods = [...new Set(rows.flatMap((r) => r.metrics.map((m) => m.period)))];
  const annual = annualYears(allPeriods);
  const fileYears = [...new Set(allPeriods.map((p) => p.slice(0, 4)))].sort();
  const monthly = fileYears.filter((y) => !annual.has(y));
  const target = options?.targetYear ? String(options.targetYear) : null;

  // ¿El archivo habla de un año distinto al declarado?
  const yearMismatch =
    target && fileYears.length > 0 && !fileYears.includes(target)
      ? `El archivo trae datos de ${fileYears.join(", ")} pero se está importando como presupuesto ${target}. Se guardó en ${target}.`
      : null;

  if (annual.size === 0 && !target) {
    return { rows, distributedYears: [], monthlyYears: monthly, yearMismatch };
  }

  const out = rows.map((row) => {
    const metrics: ImportRow["metrics"] = [];
    for (const m of row.metrics) {
      const fileYear = m.period.slice(0, 4);
      const esAnual = annual.has(fileYear);

      if (!esAnual) {
        // Ya viene mensualizado: se respeta el mes, pero el año declarado manda.
        metrics.push(target ? { ...m, period: `${target}-${m.period.slice(5)}` } : m);
        continue;
      }
      // Total anual: se divide en 12 según el peso real de cada mes.
      const year = target ?? fileYear;
      for (let mes = 1; mes <= 12; mes++) {
        metrics.push({
          key: m.key,
          period: `${year}-${String(mes).padStart(2, "0")}-01`,
          value: (m.value / 12) * factors[mes],
        });
      }
    }
    return { ...row, metrics };
  });

  const distributed = target && annual.size > 0 ? [target] : [...annual].sort();
  return { rows: out, distributedYears: distributed, monthlyYears: monthly, yearMismatch };
};
