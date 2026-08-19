/**
 * salesProjectionService.ts
 * =========================
 * Proyección de potencial de ventas para una ubicación nueva (isócrona)
 * usando el método de "comparable stores" (análogo a valuación inmobiliaria).
 *
 * Algoritmo:
 *   1. Calcula vector de features de la nueva ubicación desde IsochroneAnalysis.
 *   2. Carga features + ventas reales/predichas de todos los POIs del folder.
 *      Prioridad: actual_monthly_uf → predicted_monthly_uf_model_a → model_b.
 *   3. Encuentra los K≤5 POIs más similares (distancia euclidiana normalizada).
 *   4. Proyecta ventas = media ponderada de los comparables (w ∝ 1/distancia).
 *   5. Proyección a 5 años con tasa de crecimiento configurable.
 *
 * Extensible: el folderId permite usar cualquier cadena, no solo Autoplanet.
 */

import type { Feature, MultiPolygon, Polygon } from "geojson";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import { supabase } from "@/integrations/supabase/client";
import type { IsochroneAnalysis } from "@/utils/isochroneAnalysis";
import type { ParqueIsochroneStats } from "@/hooks/useParqueIsochroneStats";
import { loadUfMap } from "@/services/ufService";
import { computeComplementScoreInPolygon } from "@/services/poiFeaturePayloadBuilder";

// ── Tipos públicos ────────────────────────────────────────────────────────────

export interface YearProjection {
  year:       number;
  uf:         number;  // UF/mes
  clp:        number;  // CLP/mes
  isBase:     boolean; // true = año base (datos reales/predichos del modelo)
  isCurrent:  boolean; // true = año calendario en curso
}

export interface ComparableStore {
  poiId:         string;
  name:          string;
  distanceScore: number;
  ufPerMonth:    number;  // UF/mes (actual o predicha)
  clpPerMonth:   number;
  isActual:      boolean; // true si usa ventas reales; false si usa predicción del modelo
  weight:        number;
  keyDiffs: Array<{
    feature: string;
    label:   string;
    newVal:  number;
    compVal: number;
    delta:   number;
  }>;
}

export interface ProjectionResult {
  estimatedUf:   number;
  estimatedClp:  number;
  lowUf:         number;
  highUf:        number;
  lowClp:        number;
  highClp:       number;
  /** Proyección a 5 años desde el año base */
  fiveYearProjection: YearProjection[];
  comparables:   ComparableStore[];
  nWithSales:    number;  // con ventas reales
  nWithPredicted: number; // solo con predicción del modelo
  keyFactors: Array<{ label: string; value: string; impact: "positive" | "negative" | "neutral" }>;
  folderName:    string;
  baseYear:      number;  // año de los datos de referencia
  currentYear:   number;  // año calendario en curso
  /** Tasa de crecimiento anual aplicada (0.03 = 3%) */
  growthRate:    number;
  /** Si no hay datos reales, se usaron predicciones del modelo Ridge */
  usedPredictions: boolean;
  /** Mensaje diagnóstico para mostrar en la UI */
  diagnosticMsg: string | null;
}

export interface ProjectionInput {
  folderId:    string;
  isoAnalysis: IsochroneAnalysis;
  /**
   * Polígono de la banda analizada. Necesario para contar la competencia
   * interna (locales de la misma carpeta dentro del área); sin él ese feature
   * queda en 0 y el modelo compara contra comparables que sí lo traen medido.
   */
  isoFeature?: Feature<Polygon | MultiPolygon> | null;
  parque?:     ParqueIsochroneStats | null;
  /** Tasa de crecimiento anual para la proyección (default 0.03 = 3%) */
  growthRate?: number;
  /** Años a proyectar hacia adelante (default 5) */
  horizonYears?: number;
}

/** Crecimiento anual por defecto de la proyección (3%). */
export const DEFAULT_GROWTH_RATE = 0.03;

// ── Feature keys para similitud ───────────────────────────────────────────────

const SIMILARITY_FEATURES = [
  "pop_total", "pop_density_avg",
  "nse_high_pct", "nse_mid_pct",
  "income_avg",
  "complement_score",
  "n_competition_int",
  "parque_n_vehiculos",
] as const;

const FEATURE_LABELS: Record<string, string> = {
  pop_total:          "Población",
  pop_density_avg:    "Densidad",
  nse_high_pct:       "% NSE alto",
  nse_mid_pct:        "% NSE medio",
  income_avg:         "Ingreso promedio",
  complement_score:   "Atractores complementarios",
  n_competition_int:  "Competencia interna",
  parque_n_vehiculos: "Vehículos en isócrona",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractFeatures(
  iso: IsochroneAnalysis,
  parque: ParqueIsochroneStats | null | undefined,
  nCompetitionInt: number,
  complementScore: number | null,
): Record<string, number> {
  return {
    pop_total:          iso.totals.pop,
    pop_density_avg:    iso.density.popPerKm2,
    nse_high_pct:       extractNseHighPct(iso),
    nse_mid_pct:        extractNseMidPct(iso),
    income_avg:         iso.totals.incomeAvgPerHh,
    // null = sin definición común con los comparables; se excluye más abajo.
    complement_score:   complementScore ?? NaN,
    n_competition_int:  nCompetitionInt,
    parque_n_vehiculos: parque?.vehiculos ?? 0,
  };
}

/**
 * Deja fuera los features que no aportan a la similitud:
 *  - los que no se pudieron medir en la ubicación nueva (NaN), y
 *  - los que valen lo mismo en TODOS los comparables (varianza cero): no
 *    distinguen entre candidatos y solo inflan la distancia, aplanando el
 *    peso relativo de los vecinos.
 */
function selectUsableFeatures(
  rows: Array<{ features: Record<string, number> }>,
  newPoint: Record<string, number>,
  keys: readonly string[],
): string[] {
  return keys.filter((k) => {
    const v = newPoint[k];
    if (!Number.isFinite(v)) return false;
    const vals = rows.map((r) => r.features[k] ?? 0);
    return vals.some((x) => x !== vals[0]);
  });
}

/**
 * Locales de la propia carpeta que caen dentro de la isócrona (canibalización).
 * Los comparables del caché traen este valor medido, así que dejarlo en 0
 * hacía que toda ubicación nueva pareciera libre de competencia propia.
 */
async function countInternalCompetition(
  folderId: string,
  isoFeature: Feature<Polygon | MultiPolygon> | null | undefined,
): Promise<number> {
  if (!isoFeature) return 0;
  const { data, error } = await supabase
    .from("pois")
    .select("lat, lng")
    .eq("folder_id", folderId)
    // Un local cerrado dejó de competir: contarlo inflaba la competencia
    // interna del área y castigaba la proyección de una ubicación que en
    // realidad quedó más despejada.
    .is("deleted_at", null);
  if (error || !data) return 0;
  let n = 0;
  for (const p of data) {
    if (p.lat == null || p.lng == null) continue;
    try {
      if (booleanPointInPolygon(point([p.lng, p.lat]), isoFeature as never)) n += 1;
    } catch {
      // Un punto con geometría inválida no debe tumbar la proyección.
    }
  }
  return n;
}

// Los comparables del caché ponderan por POBLACIÓN (ver compute-poi-features:
// `popWeightedNseHigh / popTotal`). Acá se usa la misma ponderación: con la
// distribución por hogares, ambos lados medían cosas distintas y el vecino más
// cercano se elegía sobre un espacio deformado.
function extractNseHighPct(iso: IsochroneAnalysis): number {
  const dist = iso.gse?.classDistributionByPop ?? {};
  return ((dist["ABC1"] ?? 0) + (dist["C1"] ?? 0) + (dist["C2"] ?? 0)) / 100;
}

function extractNseMidPct(iso: IsochroneAnalysis): number {
  const dist = iso.gse?.classDistributionByPop ?? {};
  return (dist["C3"] ?? 0) / 100;
}

function normalizeFeatures(
  rows: Array<{ features: Record<string, number> }>,
  newPoint: Record<string, number>,
  keys: readonly string[],
): { normRows: number[][]; normNew: number[] } {
  const mins: Record<string, number> = {};
  const maxs: Record<string, number> = {};
  const allPoints = [...rows.map((r) => r.features), newPoint];
  for (const k of keys) {
    const vals = allPoints.map((p) => p[k] ?? 0).filter(Number.isFinite);
    mins[k] = Math.min(...vals);
    maxs[k] = Math.max(...vals);
  }
  const norm = (p: Record<string, number>) =>
    keys.map((k) => {
      const v = p[k] ?? 0;
      const range = maxs[k] - mins[k];
      return range > 0 ? (v - mins[k]) / range : 0;
    });
  return { normRows: rows.map((r) => norm(r.features)), normNew: norm(newPoint) };
}

function euclidean(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

// ── Función principal ─────────────────────────────────────────────────────────

export async function computeSalesProjection(
  input: ProjectionInput,
): Promise<ProjectionResult> {
  const {
    folderId, isoAnalysis, isoFeature, parque,
    growthRate    = DEFAULT_GROWTH_RATE,
    horizonYears  = 5,
  } = input;

  const currentYear = new Date().getFullYear();

  // ── 1. Cargar datos del folder ──────────────────────────────────────────────
  const [folderRes, cacheRes, perfRes] = await Promise.all([
    supabase.from("poi_folders").select("name").eq("id", folderId).maybeSingle(),
    supabase.from("poi_features_cache")
      .select("poi_id, features")
      .eq("folder_id", folderId),
    supabase.from("poi_performance_analysis")
      .select("poi_id, actual_monthly_uf, actual_monthly_clp, predicted_monthly_uf_model_a, predicted_monthly_uf_model_b, target_year, folder_id")
      .eq("folder_id", folderId),
  ]);

  const folderName  = folderRes.data?.name ?? "Tienda";
  const cacheRows   = cacheRes.data  ?? [];
  const perfRows    = perfRes.data   ?? [];

  // Diagnóstico
  const diagParts: string[] = [];
  if (cacheRows.length === 0) diagParts.push(`Sin features en caché para esta carpeta`);
  if (perfRows.length  === 0) diagParts.push(`Sin análisis de performance (ejecuta "Calcular performance")`);

  // Cargar nombres y estado operativo de los POIs
  const poiIds  = perfRows.map((r) => r.poi_id).filter(Boolean) as string[];
  const poisRes = poiIds.length
    ? await supabase.from("pois").select("id, name, operational_status").in("id", poiIds)
    : { data: [] };
  const nameById = new Map((poisRes.data ?? []).map((p) => [p.id, p.name]));

  // Solo los cerrados DEFINITIVAMENTE se excluyen: su trayectoria terminó y
  // los últimos meses suelen ser de caída, así que no representan lo que
  // rendiría el emplazamiento.
  //
  // Los cerrados TEMPORALMENTE sí cuentan: los meses sin operación ya se
  // descartan al promediar, de modo que su cifra refleja solo los meses que
  // estuvo abierto —evidencia válida de esa ubicación—. Y si el cierre fue
  // largo, el mínimo de meses del cálculo de performance ya lo deja fuera de
  // ese año por sí solo.
  const closedPoiIds = new Set(
    (poisRes.data ?? [])
      .filter(
        (p) =>
          (p as { operational_status?: string }).operational_status ===
          "cerrado_definitivo",
      )
      .map((p) => p.id),
  );

  // ── 2. UF actual para conversión CLP↔UF ────────────────────────────────────
  const ufMap = await loadUfMap();
  const currentUfEntry = [...ufMap.entries()].sort((a, b) => b[0].localeCompare(a[0]))[0];
  const currentUf = currentUfEntry?.[1] ?? 37_000;

  // ── 3. Cruzar features + ventas — con FALLBACK a predicción del modelo ──────
  const featureById = new Map(cacheRows.map((r) => [r.poi_id, r.features as Record<string, number>]));

  interface ComparableRaw {
    poiId:    string;
    features: Record<string, number>;
    ufPerMonth: number;
    clpPerMonth: number;
    isActual: boolean;
    baseYear: number;
  }

  const comparable: ComparableRaw[] = [];
  let nWithSales = 0;
  let nWithPredicted = 0;
  let maxBaseYear = currentYear - 1; // fallback = año anterior

  let nExcludedClosed = 0;

  for (const p of perfRows) {
    if (!p.poi_id) continue;
    if (closedPoiIds.has(p.poi_id)) { nExcludedClosed += 1; continue; }
    const features = featureById.get(p.poi_id);
    if (!features) continue;

    // Prioridad: real > predicción modelo A > predicción modelo B
    const ufReal   = p.actual_monthly_uf;
    const ufPredA  = p.predicted_monthly_uf_model_a;
    const ufPredB  = p.predicted_monthly_uf_model_b;
    const baseYear = p.target_year ?? (currentYear - 1);

    let ufVal: number | null = null;
    let isActual = false;

    if (ufReal != null && ufReal > 0) {
      ufVal = ufReal; isActual = true; nWithSales++;
    } else if (ufPredA != null && ufPredA > 0) {
      ufVal = ufPredA; nWithPredicted++;
    } else if (ufPredB != null && ufPredB > 0) {
      ufVal = ufPredB; nWithPredicted++;
    }

    if (ufVal == null || ufVal <= 0) continue;

    if (baseYear > maxBaseYear) maxBaseYear = baseYear;
    comparable.push({
      poiId:    p.poi_id,
      features,
      ufPerMonth:  ufVal,
      clpPerMonth: (p.actual_monthly_clp && p.actual_monthly_clp > 0)
                     ? p.actual_monthly_clp
                     : ufVal * currentUf,
      isActual,
      baseYear,
    });
  }

  // Que la exclusión sea visible: si no, la red parecería más chica sin motivo.
  if (nExcludedClosed > 0) {
    diagParts.push(
      `${nExcludedClosed} local${nExcludedClosed === 1 ? "" : "es"} cerrado${nExcludedClosed === 1 ? "" : "s"} definitivamente excluido${nExcludedClosed === 1 ? "" : "s"} de los comparables`,
    );
  }

  if (comparable.length === 0) {
    const msg = diagParts.length > 0 ? diagParts.join(" · ") : "No hay datos de ventas ni predicciones en la red";
    return emptyProjection(folderName, maxBaseYear, currentYear, growthRate, horizonYears, msg);
  }

  const usedPredictions = nWithSales === 0;

  // ── 4. Vector de features de la nueva ubicación ────────────────────────────
  const [nCompetitionInt, complementScore] = await Promise.all([
    countInternalCompetition(folderId, isoFeature),
    isoFeature
      ? computeComplementScoreInPolygon(folderId, isoFeature.geometry)
      : Promise.resolve(null),
  ]);
  const newFeatures = extractFeatures(isoAnalysis, parque, nCompetitionInt, complementScore);

  // ── 5. Normalizar y calcular distancias ────────────────────────────────────
  const usableFeatures = selectUsableFeatures(comparable, newFeatures, SIMILARITY_FEATURES);
  const { normRows, normNew } = normalizeFeatures(comparable, newFeatures, usableFeatures);
  const distances = normRows.map((row, i) => ({
    idx: i, distance: euclidean(row, normNew), poiId: comparable[i].poiId,
  }));

  const K    = Math.min(5, comparable.length);
  const topK = distances.sort((a, b) => a.distance - b.distance).slice(0, K);

  // ── 6. Pesos inversamente proporcionales a la distancia ───────────────────
  const maxDist    = topK[topK.length - 1].distance || 1;
  const weights    = topK.map((t) => Math.max(0.05, 1 - t.distance / (maxDist * 1.01)));
  const totalW     = weights.reduce((a, b) => a + b, 0);
  const normWeights = weights.map((w) => w / totalW);

  // ── 7. Proyección central y rango ─────────────────────────────────────────
  const sortedUf   = topK.map((t) => comparable[t.idx].ufPerMonth).sort((a, b) => a - b);
  const estimatedUf = topK.reduce((s, t, i) => s + comparable[t.idx].ufPerMonth * normWeights[i], 0);
  const p25 = sortedUf[Math.max(0, Math.floor(sortedUf.length * 0.25))] ?? sortedUf[0];
  const p75 = sortedUf[Math.min(sortedUf.length - 1, Math.floor(sortedUf.length * 0.75))] ?? sortedUf[sortedUf.length - 1];

  // ── 8. Proyección a N años ────────────────────────────────────────────────
  // El año base es el año de los datos (maxBaseYear).
  // El año en curso es currentYear.
  // Proyectamos desde el año base hasta baseYear + horizonYears.
  const fiveYearProjection: YearProjection[] = [];
  for (let i = 0; i <= horizonYears; i++) {
    const yr  = maxBaseYear + i;
    const uf  = estimatedUf * Math.pow(1 + growthRate, i);
    fiveYearProjection.push({
      year:      yr,
      uf:        Math.round(uf * 10) / 10,
      clp:       Math.round(uf * currentUf),
      isBase:    i === 0,
      isCurrent: yr === currentYear,
    });
  }

  // ── 9. Construir ComparableStore ──────────────────────────────────────────
  const comparableStores: ComparableStore[] = topK.map((t, i) => {
    const comp    = comparable[t.idx];
    const normVec = normRows[t.idx];
    // Debe recorrer `usableFeatures`: `normNew`/`normVec` se construyeron con
    // esa lista, así que usar la completa desalinearía los índices.
    const keyDiffs = usableFeatures
      .map((k, ki) => ({
        feature: k, label: FEATURE_LABELS[k] ?? k,
        newVal:  newFeatures[k] ?? 0,
        compVal: comp.features[k] ?? 0,
        rawDelta: normNew[ki] - normVec[ki],
      }))
      .filter((d) => Math.abs(d.rawDelta) > 0.1)
      .sort((a, b) => Math.abs(b.rawDelta) - Math.abs(a.rawDelta))
      .slice(0, 3)
      .map((d) => ({ feature: d.feature, label: d.label, newVal: d.newVal, compVal: d.compVal, delta: d.rawDelta * 100 }));

    return {
      poiId:         comp.poiId,
      name:          nameById.get(comp.poiId) ?? `Local ${i + 1}`,
      distanceScore: Math.min(1, t.distance / 2),
      ufPerMonth:    comp.ufPerMonth,
      clpPerMonth:   comp.clpPerMonth,
      isActual:      comp.isActual,
      weight:        normWeights[i],
      keyDiffs,
    };
  });

  // ── 10. Factores clave ────────────────────────────────────────────────────
  // Solo los comparables efectivamente usados: son los que sostienen la
  // estimación. Contra el promedio de TODA la red, la referencia incluía
  // locales que el modelo descartó por poco parecidos.
  const keyFactors = buildKeyFactors(newFeatures, topK.map((k) => comparable[k.idx]));

  const diagNotes = [
    usedPredictions
      ? "Usando predicciones del modelo Ridge (sin ventas reales cargadas)"
      : null,
    nExcludedClosed > 0
      ? `${nExcludedClosed} cerrado${nExcludedClosed === 1 ? "" : "s"} definitivamente excluido${nExcludedClosed === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean) as string[];
  const diagnosticMsg = diagNotes.length > 0 ? diagNotes.join(" · ") : null;

  return {
    estimatedUf:    Math.round(estimatedUf * 10) / 10,
    estimatedClp:   Math.round(estimatedUf * currentUf),
    lowUf:          Math.round(p25 * 10) / 10,
    highUf:         Math.round(p75 * 10) / 10,
    lowClp:         Math.round(p25 * currentUf),
    highClp:        Math.round(p75 * currentUf),
    fiveYearProjection,
    comparables:    comparableStores,
    nWithSales,
    nWithPredicted,
    keyFactors,
    folderName,
    baseYear:       maxBaseYear,
    currentYear,
    growthRate,
    usedPredictions,
    diagnosticMsg,
  };
}

// ── Helpers adicionales ───────────────────────────────────────────────────────

/**
 * Diferencias con los comparables usados.
 *
 * Referencia = MEDIANA, no promedio: la distribución de población por isócrona
 * es muy asimétrica (unas pocas isócronas urbanas enormes arrastran la media
 * muy por encima de la mayoría), así que contra el promedio casi cualquier
 * ubicación aparecía "por debajo de la red" y el dato dejaba de informar.
 */
function buildKeyFactors(
  newF: Record<string, number>,
  comparables: Array<{ features: Record<string, number>; ufPerMonth: number }>,
): ProjectionResult["keyFactors"] {
  if (comparables.length === 0) return [];
  const medianOf = (k: string): number => {
    const xs = comparables.map((c) => c.features[k] ?? 0).sort((a, b) => a - b);
    const m = Math.floor(xs.length / 2);
    return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
  };
  const avgF: Record<string, number> = {};
  for (const k of Object.keys(newF)) avgF[k] = medianOf(k);
  const factors: ProjectionResult["keyFactors"] = [];

  if (avgF["pop_total"] > 0) {
    const pct = ((newF["pop_total"] - avgF["pop_total"]) / avgF["pop_total"]) * 100;
    if (Math.abs(pct) > 10) factors.push({
      label:  `Población ${Math.abs(pct).toFixed(0)}% ${pct > 0 ? "mayor" : "menor"} que sus comparables`,
      value:  Intl.NumberFormat("es-CL").format(Math.round(newF["pop_total"])),
      impact: pct > 0 ? "positive" : "negative",
    });
  }
  const nseHigh = (newF["nse_high_pct"] ?? 0) * 100;
  const avgNseHigh = (avgF["nse_high_pct"] ?? 0) * 100;
  if (Math.abs(nseHigh - avgNseHigh) > 5) factors.push({
    label:  `NSE alto ${nseHigh.toFixed(0)}% (comparables: ${avgNseHigh.toFixed(0)}%)`,
    value:  `${nseHigh.toFixed(1)}%`,
    impact: nseHigh > avgNseHigh ? "positive" : "negative",
  });
  const parque = newF["parque_n_vehiculos"] ?? 0;
  const avgParque = avgF["parque_n_vehiculos"] ?? 0;
  if (avgParque > 0 && parque > 0) {
    const pct = ((parque - avgParque) / avgParque) * 100;
    if (Math.abs(pct) > 15) factors.push({
      label:  `Parque vehicular ${Math.abs(pct).toFixed(0)}% ${pct > 0 ? "mayor" : "menor"}`,
      value:  Intl.NumberFormat("es-CL").format(Math.round(parque)),
      impact: pct > 0 ? "positive" : "negative",
    });
  }
  if (factors.length === 0) {
    factors.push({ label: "Perfil similar al de sus comparables", value: "—", impact: "neutral" });
  }
  return factors;
}

function emptyProjection(
  folderName: string, baseYear: number, currentYear: number,
  growthRate: number, horizonYears: number, diagnosticMsg: string,
): ProjectionResult {
  return {
    estimatedUf: 0, estimatedClp: 0,
    lowUf: 0, highUf: 0, lowClp: 0, highClp: 0,
    fiveYearProjection: [],
    comparables: [], nWithSales: 0, nWithPredicted: 0,
    keyFactors: [{ label: diagnosticMsg, value: "—", impact: "neutral" }],
    folderName, baseYear, currentYear, growthRate, usedPredictions: false, diagnosticMsg,
  };
}
