/**
 * gastoEndogeno.ts
 * ================
 * Cálculo del Gasto Potencial Mensual Endógeno de Hogares para canasta Autoplanet.
 *
 * Metodología: EPF (Encuesta Presupuesto Familiar 2021-2022), actualizada XBREIN.
 * Coeficiente = gasto mensual promedio en productos/servicios automotrices
 *               declarado por hogares de cada GSE que pertenecen al mercado objetivo.
 *
 * Mercado objetivo: ABC1, C1, C2, C3, D (se excluye E por bajo gasto en automotriz).
 *
 * Referencias:
 *   - Diapositiva 2.1.5 "Gasto Potencial Mensual Endógeno de Hogares ($)" – informes GeoMarketing
 *   - EPF INE 2021-2022 + actualización XBREIN a valores 2025 (~+12% inflación)
 */

import type { GseClass } from "@/types/gse";
import type { IsochroneAnalysis } from "./isochroneAnalysis";

// ── Coeficientes EPF Autoplanet (CLP por hogar/mes) ──────────────────────────

/** Gasto mensual promedio en canasta Autoplanet por GSE (CLP, valores ~2025). */
export const EPF_AUTOPLANET: Partial<Record<GseClass, number>> = {
  ABC1: 49_237,
  C1:   35_000,  // estimado — entre ABC1 y C2
  C2:   25_057,
  C3:   12_732,
  D:     4_117,
  E:         0,  // fuera del mercado objetivo
};

export const GSE_TARGET: GseClass[] = ["ABC1", "C1", "C2", "C3", "D"];
export const GSE_COLORS: Partial<Record<GseClass, string>> = {
  ABC1: "#1e40af",
  C1:   "#3b82f6",
  C2:   "#0ea5e9",
  C3:   "#eab308",
  D:    "#f97316",
  E:    "#6b7280",
};

// ── Tipos de resultado ────────────────────────────────────────────────────────

export interface GastoEndogenoRow {
  gse:           GseClass;
  hogares:       number;       // hogares estimados en la isócrona
  coeficiente:   number;       // CLP / hogar / mes (EPF)
  gastoMensual:  number;       // CLP totales / mes
  pctDelTotal:   number;       // % sobre el total objetivo
  esObjetivo:    boolean;      // pertenece al mercado objetivo
}

export interface GastoEndogenoResult {
  rows:                 GastoEndogenoRow[];
  totalHogaresObjetivo: number;    // hogares ABC1+C1+C2+C3+D
  totalHogaresTotales:  number;    // todos los hogares (incl. E)
  gastoMensualObjetivo: number;    // CLP/mes mercado objetivo
  gastoMensualTotal:    number;    // CLP/mes todos (incl. E)
  gastoPromPorHogar:    number;    // CLP/mes por hogar objetivo
  source:               "gse" | "nse_fallback" | "no_data";
}

// ── Lógica de cálculo ─────────────────────────────────────────────────────────

/**
 * Calcula el gasto endógeno desde un IsochroneAnalysis ya computado.
 * Usa `gse.classDistribution` (% por clase) × `totals.hh` (hogares totales).
 * Si no hay datos GSE, usa NSE como fallback con distribución estimada.
 */
export function calcGastoEndogeno(analysis: IsochroneAnalysis): GastoEndogenoResult {
  const totalHh = analysis.totals.hh ?? 0;
  const dist = analysis.gse?.classDistribution ?? {};

  if (totalHh === 0) {
    return emptyResult("no_data");
  }

  // Si no hay distribución GSE, estimar por NSE promedio
  const hasDist = Object.keys(dist).length > 0;
  const source: GastoEndogenoResult["source"] = hasDist ? "gse" : "nse_fallback";

  // Distribución de hogares por clase
  let classDist: Partial<Record<GseClass, number>> = {};

  if (hasDist) {
    classDist = dist as Partial<Record<GseClass, number>>;
  } else {
    // Fallback: estimar por NSE score promedio (si hay commune data)
    classDist = estimateDistByNse(analysis);
  }

  // Calcular hogares por clase
  const rows: GastoEndogenoRow[] = [];
  let gastoObjetivo = 0;
  let gastoTotal = 0;
  let hhObjetivo = 0;
  let hhTotal = 0;

  const allClasses: GseClass[] = ["ABC1", "C1", "C2", "C3", "D", "E"];
  for (const gse of allClasses) {
    const pct    = (classDist[gse] ?? 0) / 100;
    const hogares    = Math.round(totalHh * pct);
    const coef   = EPF_AUTOPLANET[gse] ?? 0;
    const gasto  = hogares * coef;

    const isTarget = GSE_TARGET.includes(gse);

    rows.push({ gse, hogares, coeficiente: coef, gastoMensual: gasto, pctDelTotal: 0, esObjetivo: isTarget });

    gastoTotal += gasto;
    hhTotal    += hogares;
    if (isTarget) { gastoObjetivo += gasto; hhObjetivo += hogares; }
  }

  // Calcular % del total
  for (const r of rows) {
    r.pctDelTotal = gastoObjetivo > 0 ? (r.gastoMensual / gastoObjetivo) * 100 : 0;
  }

  return {
    rows,
    totalHogaresObjetivo: hhObjetivo,
    totalHogaresTotales:  hhTotal || totalHh,
    gastoMensualObjetivo: gastoObjetivo,
    gastoMensualTotal:    gastoTotal,
    gastoPromPorHogar:    hhObjetivo > 0 ? Math.round(gastoObjetivo / hhObjetivo) : 0,
    source,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyResult(source: GastoEndogenoResult["source"]): GastoEndogenoResult {
  const allClasses: GseClass[] = ["ABC1", "C1", "C2", "C3", "D", "E"];
  return {
    rows: allClasses.map(gse => ({
      gse, hogares: 0, coeficiente: EPF_AUTOPLANET[gse] ?? 0,
      gastoMensual: 0, pctDelTotal: 0, esObjetivo: GSE_TARGET.includes(gse),
    })),
    totalHogaresObjetivo: 0,
    totalHogaresTotales:  0,
    gastoMensualObjetivo: 0,
    gastoMensualTotal:    0,
    gastoPromPorHogar:    0,
    source,
  };
}

/** Estimación de distribución GSE por NSE score promedio (fallback sin manzanas). */
function estimateDistByNse(
  analysis: IsochroneAnalysis,
): Partial<Record<GseClass, number>> {
  // Usar la distribución de las comunas ponderada por hogares en la iso
  const NSE_SCORE: Record<string, number> = { ABC1: 5, C2: 4, C3: 3, D: 2, E: 1 };
  const nseValues = analysis.communes
    .filter(c => c.nse != null)
    .map(c => ({ nse: NSE_SCORE[c.nse as string] ?? 3, weight: c.hhInIso }));

  if (!nseValues.length) return defaultNationalDist();

  // Calcular NSE promedio ponderado
  const totalW = nseValues.reduce((s, x) => s + x.weight, 0);
  if (totalW === 0) return defaultNationalDist();

  const avgNse = nseValues.reduce((s, x) => s + x.nse * x.weight, 0) / totalW;

  // Mapear NSE promedio a distribución GSE estimada
  // NSE 1=E, 2=D, 3=C3, 4=C2, 5=ABC1
  if (avgNse >= 4.5) return { ABC1: 40, C1: 20, C2: 25, C3: 12, D: 2, E: 1 };
  if (avgNse >= 3.5) return { ABC1: 10, C1: 15, C2: 35, C3: 28, D: 9, E: 3 };
  if (avgNse >= 2.5) return { ABC1: 4,  C1: 8,  C2: 22, C3: 35, D: 24, E: 7 };
  if (avgNse >= 1.5) return { ABC1: 1,  C1: 3,  C2: 10, C3: 28, D: 40, E: 18 };
  return                     { ABC1: 0,  C1: 1,  C2: 5,  C3: 15, D: 35, E: 44 };
}

/** Distribución nacional promedio de Chile (aproximada). */
function defaultNationalDist(): Partial<Record<GseClass, number>> {
  return { ABC1: 3, C1: 8, C2: 22, C3: 30, D: 27, E: 10 };
}

// ── Formato ───────────────────────────────────────────────────────────────────

export const fmtCLPMillones = (v: number) => {
  if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000)     return `$${(v / 1_000_000).toFixed(1)}M`;
  return `$${new Intl.NumberFormat("es-CL").format(Math.round(v))}`;
};

export const fmtCLPK = (v: number) =>
  `$${new Intl.NumberFormat("es-CL").format(Math.round(v))}`;
