/**
 * salesProjectionService.ts
 * =========================
 * Proyección de potencial de ventas para una ubicación nueva (isócrona)
 * usando el método de "comparable stores" (análogo a valuación inmobiliaria).
 *
 * Algoritmo:
 *   1. Calcula el vector de features de la nueva ubicación desde IsochroneAnalysis.
 *   2. Carga features + ventas reales de todos los POIs del folder.
 *   3. Encuentra los K=5 POIs más similares (distancia euclidiana normalizada).
 *   4. Proyecta ventas = media ponderada de los comparables (w ∝ 1/distancia).
 *   5. Genera rango de confianza (percentiles 25/75 del set de comparables).
 *
 * Extensible: el folderId permite usar cualquier cadena, no solo Autoplanet.
 */

import { supabase } from "@/integrations/supabase/client";
import type { IsochroneAnalysis } from "@/utils/isochroneAnalysis";
import type { ParqueIsochroneStats } from "@/hooks/useParqueIsochroneStats";
import { loadUfMap } from "@/services/ufService";

// ── Tipos públicos ────────────────────────────────────────────────────────────

export interface ComparableStore {
  poiId:         string;
  name:          string;
  distanceScore: number;   // 0-1 (0 = idéntico, 1 = muy diferente)
  actualUf:      number;   // ventas mensuales reales (UF)
  actualClp:     number;   // ventas mensuales reales (CLP)
  weight:        number;   // peso en la proyección (0-1)
  keyDiffs: Array<{
    feature: string;
    label:   string;
    newVal:  number;
    compVal: number;
    delta:   number;       // % diferencia (positivo = nueva ubicación es mejor)
  }>;
}

export interface ProjectionResult {
  /** Estimación central en UF/mes */
  estimatedUf:   number;
  estimatedClp:  number;
  /** Rango conservador (p25) y optimista (p75) */
  lowUf:         number;
  highUf:        number;
  lowClp:        number;
  highClp:       number;
  /** Comparables usados (ordenados por similitud) */
  comparables:   ComparableStore[];
  /** Número de POIs del folder con ventas */
  nWithSales:    number;
  /** Factores clave de la proyección */
  keyFactors: Array<{ label: string; value: string; impact: "positive" | "negative" | "neutral" }>;
  /** Nombre del folder/negocio */
  folderName:    string;
  /** Año objetivo de las ventas comparables */
  targetYear:    number;
}

export interface ProjectionInput {
  folderId:    string;
  isoAnalysis: IsochroneAnalysis;
  parque?:     ParqueIsochroneStats | null;
}

// ── Feature keys usados para similitud ───────────────────────────────────────
// Subconjunto robusto — features que tienen cobertura alta en todos los POIs.

const SIMILARITY_FEATURES = [
  "pop_total", "pop_density_avg",
  "nse_high_pct", "nse_mid_pct",
  "income_avg",
  "complement_score",
  "n_competition_int",
  "parque_n_vehiculos",
] as const;

const FEATURE_LABELS: Record<string, string> = {
  pop_total:           "Población",
  pop_density_avg:     "Densidad",
  nse_high_pct:        "% NSE alto",
  nse_mid_pct:         "% NSE medio",
  income_avg:          "Ingreso promedio",
  complement_score:    "Atractores complementarios",
  n_competition_int:   "Competencia interna",
  parque_n_vehiculos:  "Vehículos en isócrona",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convierte IsochroneAnalysis + parque en un vector de features numéricas. */
function extractFeatures(
  iso: IsochroneAnalysis,
  parque: ParqueIsochroneStats | null | undefined,
): Record<string, number> {
  return {
    pop_total:          iso.totals.pop,
    pop_density_avg:    iso.density.popPerKm2,
    nse_high_pct:       extractNseHighPct(iso),
    nse_mid_pct:        extractNseMidPct(iso),
    income_avg:         iso.totals.incomeAvgPerHh,
    complement_score:   iso.territorialPoints.total,
    n_competition_int:  0,  // desconocido para nueva ubicación
    parque_n_vehiculos: parque?.vehiculos ?? 0,
  };
}

function extractNseHighPct(iso: IsochroneAnalysis): number {
  // NSE alto = ABC1 + C1 + C2 del classDistribution GSE
  const dist = iso.gse?.classDistribution ?? {};
  const high = (dist["ABC1"] ?? 0) + (dist["C1"] ?? 0) + (dist["C2"] ?? 0);
  return high / 100;
}

function extractNseMidPct(iso: IsochroneAnalysis): number {
  const dist = iso.gse?.classDistribution ?? {};
  return (dist["C3"] ?? 0) / 100;
}

/** Normalización min-max, devuelve 0 para constantes. */
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

  return {
    normRows: rows.map((r) => norm(r.features)),
    normNew:  norm(newPoint),
  };
}

/** Distancia euclidiana. */
function euclidean(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

// ── Función principal ─────────────────────────────────────────────────────────

export async function computeSalesProjection(
  input: ProjectionInput,
): Promise<ProjectionResult> {
  const { folderId, isoAnalysis, parque } = input;

  // 1. Cargar datos del folder
  const [folderRes, cacheRes, perfRes] = await Promise.all([
    supabase.from("poi_folders").select("name").eq("id", folderId).maybeSingle(),
    supabase.from("poi_features_cache")
      .select("poi_id, features")
      .eq("folder_id", folderId),
    supabase.from("poi_performance_analysis")
      .select("poi_id, actual_monthly_uf, actual_monthly_clp, predicted_monthly_uf_model_a")
      .eq("folder_id", folderId),
  ]);

  const folderName = folderRes.data?.name ?? "Tienda";
  const cacheRows  = cacheRes.data  ?? [];
  const perfRows   = perfRes.data   ?? [];

  // Cargar nombres de POIs
  const poiIds = perfRows.map((r) => r.poi_id).filter(Boolean) as string[];
  const poisRes = poiIds.length
    ? await supabase.from("pois").select("id, name").in("id", poiIds)
    : { data: [] };
  const nameById = new Map((poisRes.data ?? []).map((p) => [p.id, p.name]));

  // 2. UF actual para conversión CLP↔UF
  const ufMap = await loadUfMap();
  const currentUfEntry = [...ufMap.entries()].sort((a, b) => b[0].localeCompare(a[0]))[0];
  const currentUf = currentUfEntry?.[1] ?? 37_000;

  // 3. Cruzar features + ventas reales
  const featureById = new Map(cacheRows.map((r) => [r.poi_id, r.features as Record<string, number>]));

  const comparable: Array<{
    poiId: string;
    features: Record<string, number>;
    actualUf: number;
    actualClp: number;
  }> = [];

  for (const p of perfRows) {
    if (!p.poi_id || p.actual_monthly_uf == null) continue;
    const features = featureById.get(p.poi_id);
    if (!features) continue;
    comparable.push({
      poiId:     p.poi_id,
      features,
      actualUf:  p.actual_monthly_uf,
      actualClp: p.actual_monthly_clp ?? p.actual_monthly_uf * currentUf,
    });
  }

  // 4. Vector de features para la nueva ubicación
  const newFeatures = extractFeatures(isoAnalysis, parque);
  const targetYear = new Date().getFullYear() - 1; // año anterior por defecto

  if (comparable.length === 0) {
    return emptyProjection(folderName, targetYear);
  }

  // 5. Normalizar y calcular distancias
  const { normRows, normNew } = normalizeFeatures(
    comparable,
    newFeatures,
    SIMILARITY_FEATURES,
  );

  const distances = normRows.map((row, i) => ({
    idx:      i,
    distance: euclidean(row, normNew),
    poiId:    comparable[i].poiId,
  }));

  // Top-K más similares (K=5 o menos si hay pocos)
  const K = Math.min(5, comparable.length);
  const topK = distances
    .sort((a, b) => a.distance - b.distance)
    .slice(0, K);

  // 6. Pesos inversamente proporcionales a la distancia
  const maxDist = topK[topK.length - 1].distance || 1;
  const weights = topK.map((t) => {
    const norm = 1 - t.distance / (maxDist * 1.01); // 0..1
    return Math.max(0.05, norm); // mínimo 5% de peso
  });
  const totalW = weights.reduce((a, b) => a + b, 0);
  const normWeights = weights.map((w) => w / totalW);

  // 7. Proyección ponderada
  const sortedUf = topK.map((t) => comparable[t.idx].actualUf).sort((a, b) => a - b);
  const estimatedUf = topK.reduce((s, t, i) => s + comparable[t.idx].actualUf * normWeights[i], 0);

  // Rango p25-p75 del set de comparables (no de la proyección exacta)
  const p25 = sortedUf[Math.floor(sortedUf.length * 0.25)] ?? sortedUf[0];
  const p75 = sortedUf[Math.floor(sortedUf.length * 0.75)] ?? sortedUf[sortedUf.length - 1];

  // 8. Construir objetos ComparableStore
  const comparableStores: ComparableStore[] = topK.map((t, i) => {
    const comp = comparable[t.idx];
    const normVec = normRows[t.idx];
    const keyDiffs = SIMILARITY_FEATURES
      .map((k, ki) => ({
        feature: k,
        label:   FEATURE_LABELS[k] ?? k,
        newVal:  newFeatures[k] ?? 0,
        compVal: comp.features[k] ?? 0,
        rawDelta: normNew[ki] - normVec[ki], // en escala normalizada
      }))
      .filter((d) => Math.abs(d.rawDelta) > 0.1) // solo diffs significativas
      .sort((a, b) => Math.abs(b.rawDelta) - Math.abs(a.rawDelta))
      .slice(0, 3)
      .map((d) => ({
        feature: d.feature,
        label:   d.label,
        newVal:  d.newVal,
        compVal: d.compVal,
        delta:   d.rawDelta * 100,
      }));

    return {
      poiId:         comp.poiId,
      name:          nameById.get(comp.poiId) ?? `POI ${i + 1}`,
      distanceScore: Math.min(1, t.distance / 2),
      actualUf:      comp.actualUf,
      actualClp:     comp.actualClp,
      weight:        normWeights[i],
      keyDiffs,
    };
  });

  // 9. Factores clave de la proyección
  const keyFactors = buildKeyFactors(newFeatures, comparable);

  return {
    estimatedUf:  Math.round(estimatedUf * 10) / 10,
    estimatedClp: Math.round(estimatedUf * currentUf),
    lowUf:        Math.round(p25 * 10) / 10,
    highUf:       Math.round(p75 * 10) / 10,
    lowClp:       Math.round(p25 * currentUf),
    highClp:      Math.round(p75 * currentUf),
    comparables:  comparableStores,
    nWithSales:   comparable.length,
    keyFactors,
    folderName,
    targetYear,
  };
}

// ── Helpers adicionales ───────────────────────────────────────────────────────

function buildKeyFactors(
  newF: Record<string, number>,
  comparables: Array<{ features: Record<string, number>; actualUf: number }>,
): ProjectionResult["keyFactors"] {
  if (comparables.length === 0) return [];

  const avgF: Record<string, number> = {};
  for (const k of Object.keys(newF)) {
    avgF[k] = comparables.reduce((s, c) => s + (c.features[k] ?? 0), 0) / comparables.length;
  }

  const factors: ProjectionResult["keyFactors"] = [];

  // Población vs promedio
  if (avgF["pop_total"] > 0) {
    const pct = ((newF["pop_total"] - avgF["pop_total"]) / avgF["pop_total"]) * 100;
    if (Math.abs(pct) > 10) {
      factors.push({
        label:  `Población ${Math.abs(pct).toFixed(0)}% ${pct > 0 ? "mayor" : "menor"} al promedio`,
        value:  Intl.NumberFormat("es-CL").format(Math.round(newF["pop_total"])),
        impact: pct > 0 ? "positive" : "negative",
      });
    }
  }

  // NSE alto
  const nseHigh = (newF["nse_high_pct"] ?? 0) * 100;
  const avgNseHigh = (avgF["nse_high_pct"] ?? 0) * 100;
  if (Math.abs(nseHigh - avgNseHigh) > 5) {
    factors.push({
      label:  `NSE alto ${nseHigh.toFixed(0)}% (promedio red: ${avgNseHigh.toFixed(0)}%)`,
      value:  `${nseHigh.toFixed(1)}%`,
      impact: nseHigh > avgNseHigh ? "positive" : "negative",
    });
  }

  // Parque automotor
  const parque = newF["parque_n_vehiculos"] ?? 0;
  const avgParque = avgF["parque_n_vehiculos"] ?? 0;
  if (avgParque > 0 && parque > 0) {
    const pct = ((parque - avgParque) / avgParque) * 100;
    if (Math.abs(pct) > 15) {
      factors.push({
        label:  `Parque vehicular ${Math.abs(pct).toFixed(0)}% ${pct > 0 ? "mayor" : "menor"}`,
        value:  Intl.NumberFormat("es-CL").format(Math.round(parque)),
        impact: pct > 0 ? "positive" : "negative",
      });
    }
  }

  // Complementarios
  const compl = newF["complement_score"] ?? 0;
  const avgCompl = avgF["complement_score"] ?? 0;
  if (avgCompl > 0) {
    const pct = ((compl - avgCompl) / avgCompl) * 100;
    if (Math.abs(pct) > 20) {
      factors.push({
        label:  `Atractores complementarios ${Math.abs(pct).toFixed(0)}% ${pct > 0 ? "mayor" : "menor"}`,
        value:  compl.toFixed(1),
        impact: pct > 0 ? "positive" : "negative",
      });
    }
  }

  if (factors.length === 0) {
    factors.push({ label: "Perfil similar al promedio de la red", value: "—", impact: "neutral" });
  }

  return factors;
}

function emptyProjection(folderName: string, targetYear: number): ProjectionResult {
  return {
    estimatedUf: 0, estimatedClp: 0,
    lowUf: 0, highUf: 0, lowClp: 0, highClp: 0,
    comparables: [], nWithSales: 0,
    keyFactors: [{ label: "Sin datos de ventas en la red para proyectar", value: "—", impact: "neutral" }],
    folderName, targetYear,
  };
}
