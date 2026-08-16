import type { GseClass } from "@/types/gse";

/**
 * Ingreso mensual por hogar (CLP) según clase GSE.
 *
 * Es la tabla canónica: la usan tanto el análisis de isócronas como el
 * constructor de features de los locales comparables. Si ambos lados no usan
 * la MISMA tabla, el modelo de proyección compara magnitudes distintas y elige
 * mal los comparables — ver `salesProjectionService`.
 *
 * Los valores de ABC1/C2/C3/D/E replican `NSE_INCOME` (src/data/communes.ts),
 * que es la escala con la que ya venía operando el sistema.
 *
 * OJO — C1: `NSE_INCOME` solo tiene 5 niveles y colapsaba C1 junto a ABC1, o
 * sea le asignaba $5.200.000 a un hogar C1. Acá se separa con un valor
 * interpolado entre ABC1 y C2. Es una ESTIMACIÓN, no un dato de fuente: si
 * tienes la cifra real (AIM / INE), reemplázala aquí y recalcula el caché de
 * features de los comparables.
 */
export const GSE_INCOME: Record<GseClass, number> = {
  ABC1: 5_200_000,
  C1:   3_300_000, // estimado — interpolado entre ABC1 y C2
  C2:   2_100_000,
  C3:     960_000,
  D:      580_000,
  E:      420_000,
};

/**
 * Ingreso promedio por hogar a partir de una distribución GSE en porcentajes.
 * Devuelve null si la distribución está vacía.
 */
export const incomeFromGseDistribution = (
  distribution: Partial<Record<GseClass, number>>,
): number | null => {
  let weighted = 0;
  let totalPct = 0;
  for (const [cls, pct] of Object.entries(distribution) as Array<[GseClass, number]>) {
    if (!pct) continue;
    weighted += GSE_INCOME[cls] * pct;
    totalPct += pct;
  }
  return totalPct > 0 ? weighted / totalPct : null;
};
