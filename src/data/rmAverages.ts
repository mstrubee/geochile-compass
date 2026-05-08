/**
 * Promedios de la Región Metropolitana (referencia para comparativos en
 * el panel de análisis de isócronas). Valores aproximados a partir de
 * INE Censo 2017 + CASEN.
 */
export const RM_AVERAGES = {
  popPerKm2: 458,
  hhPerKm2: 148,
  incomeAvgPerHh: 1_350_000, // CLP
  educYears: 11.6,
  hacin: 0.45, // hab/dorm índice
  nseDistribution: {
    ABC1: 11,
    C2: 17,
    C3: 25,
    D: 35,
    E: 12,
  } as Record<"ABC1" | "C2" | "C3" | "D" | "E", number>,
};
