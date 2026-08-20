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
  /**
   * Similitud (0..1, 1 = idéntico) por grupo de variables — ver
   * `SIMILARITY_GROUPS`. Es la base de la tabla que compara este comparable
   * contra la ubicación nueva dimensión por dimensión, para que el ajuste
   * manual del analista se apoye en algo más fino que un % de similitud único.
   */
  groupScores: Array<{ key: string; label: string; similarity: number }>;
}

/**
 * Canibalización aplicada a la estimación.
 *
 * El castigo es RELATIVO, no absoluto, y esa es la decisión de fondo:
 * `estimatedUf` sale del promedio ponderado de comparables reales, cuyas ventas
 * YA reflejan la canibalización que ellos sufren. Descontar el solape absoluto
 * de la ubicación nueva sobre esa cifra contaría la canibalización dos veces.
 *
 * Así que se compara la fracción exclusiva de la ubicación nueva contra la
 * fracción exclusiva PROMEDIO de sus comparables: si solapa igual que ellos, el
 * castigo es cero; si solapa más, se castiga solo la diferencia. Y si solapa
 * menos, sube — el efecto es simétrico porque el sesgo también lo es.
 */
export interface CannibalizationAdjust {
  /** % de población solapada con locales propios (0..100). */
  popPct: number;
  /** % de área solapada. Informativo. */
  areaPct: number;
  /** % del parque automotriz solapado. Informativo. */
  vehiculosPct: number;
  /** Población, área (km²) y vehículos dentro del solape. */
  overlapPop: number;
  overlapAreaKm2: number;
  overlapVehiculos: number;
  /** Fracción exclusiva de la ubicación nueva (1 - popPct/100). */
  exclusiveShare: number;
  /** Fracción exclusiva promedio ponderada de los comparables. */
  comparablesExclusiveShare: number;
  /** Multiplicador aplicado a la estimación: exclusiveShare / comparables. */
  relativeFactor: number;
  /** UF/mes que se pierden por canibalización respecto de los comparables. */
  lostUf: number;
  /** CLP/mes perdidos. */
  lostClp: number;
  /** Locales propios con los que se solapa, mayor solape primero. */
  overlaps: Array<{ name: string; areaKm2: number }>;
  /** true si algún vecino no tenía isócrona guardada y quedó sin medir. */
  incomplete: boolean;
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
  /**
   * Canibalización con locales propios. `null` si no se pudo medir (sin
   * isócronas guardadas de los vecinos, o sin polígono de la isócrona nueva).
   */
  cannibalization: CannibalizationAdjust | null;
  /**
   * Techo aplicado por existir un local propio dentro de la isócrona. `null`
   * si no hay ninguno o si ninguno tiene venta real medida. `appliedUf` no
   * nulo significa que el estimado se limitó.
   */
  localityCap: {
    stores: Array<{ name: string; ufPerMonth: number }>;
    capUf: number;
    appliedUf: number | null;
    reason: string;
  } | null;
  /** Estimación ANTES del ajuste por canibalización, para poder contrastar. */
  estimatedUfBeforeCannibalization: number;
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
  /**
   * Canibalización ya medida por `cannibalizationService`. Se pasa desde afuera
   * en vez de calcularse acá porque necesita las manzanas GSE y el GeoJSON del
   * parque, que el panel y el informe ya tienen cargados: recalcularlos dentro
   * duplicaría trabajo pesado.
   */
  cannibalization?: {
    popPct: number; areaPct: number; vehiculosPct: number;
    overlapPop: number; overlapAreaKm2: number; overlapVehiculos: number;
    overlaps: Array<{ name: string; areaKm2: number }>;
    incomplete: boolean;
  } | null;
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

/**
 * Agrupa `SIMILARITY_FEATURES` en las dimensiones con las que se lee un local
 * en la práctica, cada una ponderada según cuánto explica realmente las
 * ventas de los 64 locales de Autoplanet (leave-one-out, sesión ago-2026):
 *
 *   Parque automotriz         → r² individual 3.3%, pero 28% en locales
 *                                aislados sin canibalización — es el driver
 *                                principal una vez que se controla por eso
 *                                (converge con el estudio de xbrein: 39-26%).
 *   NSE / gasto endógeno      → nse_high/low_pct 8.1-8.5%, income_avg 6.0%:
 *                                el bloque individualmente más explicativo.
 *   Flujo y entorno comercial → complement_score, 0.0% aislado — se mantiene
 *                                con peso bajo a propósito de ese resultado.
 *   Tamaño de mercado         → pop_total 0.2%: casi no discrimina sola.
 *   Competencia               → cannibalization_factor 3.6% marginal, pero es
 *                                la variable que evita comparar un local
 *                                canibalizado contra uno que no lo está.
 *
 * No son pesos ajustados a los datos (eso ya se probó y no generaliza fuera
 * de muestra — ver validate-potential-model.ts): son una regla de bolsillo
 * para RANKEAR comparables, pensada para que el analista compare manzanas
 * con manzanas antes de aplicar su propio criterio (el "Ajuste manual").
 */
export interface SimilarityGroup {
  key:      string;
  label:    string;
  weight:   number; // relativo; se renormaliza según qué features estén disponibles
  features: readonly string[];
}

export const SIMILARITY_GROUPS: readonly SimilarityGroup[] = [
  { key: "parque",      label: "Parque automotriz",            weight: 0.30, features: ["parque_n_vehiculos"] },
  { key: "nse",         label: "NSE y gasto endógeno",         weight: 0.25, features: ["nse_high_pct", "nse_mid_pct", "income_avg"] },
  { key: "flujo",       label: "Flujo y entorno comercial",    weight: 0.15, features: ["complement_score"] },
  { key: "mercado",     label: "Tamaño de mercado",            weight: 0.15, features: ["pop_total", "pop_density_avg"] },
  { key: "competencia", label: "Competencia",                  weight: 0.15, features: ["n_competition_int"] },
] as const;

/** Peso de cada feature usable = peso de su grupo repartido entre las
 *  features de ese grupo que sí están disponibles para esta comparación. */
function featureWeights(keys: readonly string[]): number[] {
  return keys.map((k) => {
    const group = SIMILARITY_GROUPS.find((g) => g.features.includes(k));
    if (!group) return 0;
    const presentInGroup = group.features.filter((f) => keys.includes(f)).length;
    return presentInGroup > 0 ? group.weight / presentInGroup : 0;
  });
}

/**
 * Similitud 0..1 por grupo entre un comparable y la ubicación nueva, sobre
 * los mismos vectores normalizados 0..1 usados para la distancia general.
 * RMS en vez de suma para que un grupo con 3 features no "pese más" en la
 * lectura visual solo por tener más variables.
 */
function computeGroupScores(
  normVec: number[],
  normNewVec: number[],
  keys: readonly string[],
): Array<{ key: string; label: string; similarity: number }> {
  return SIMILARITY_GROUPS.map((g) => {
    const idxs = keys
      .map((k, i) => (g.features.includes(k) ? i : -1))
      .filter((i) => i >= 0);
    if (idxs.length === 0) return { key: g.key, label: g.label, similarity: NaN };
    let sumSq = 0;
    for (const i of idxs) sumSq += (normVec[i] - normNewVec[i]) ** 2;
    const rms = Math.sqrt(sumSq / idxs.length);
    return { key: g.key, label: g.label, similarity: Math.max(0, 1 - rms) };
  });
}

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
/**
 * Locales PROPIOS que caen dentro de la isócrona.
 *
 * Devuelve la lista, no solo el conteo, porque su venta real es la referencia
 * más informativa que existe para una ubicación nueva en la misma zona: si ya
 * hay un local propio adentro, el nuevo comparte ese mercado. Ver el techo de
 * realidad en el paso 7c.
 */
async function findInternalStores(
  folderId: string,
  isoFeature: Feature<Polygon | MultiPolygon> | null | undefined,
): Promise<Array<{ poiId: string; name: string }>> {
  if (!isoFeature) return [];
  const { data, error } = await supabase
    .from("pois")
    .select("id, name, lat, lng")
    .eq("folder_id", folderId)
    // Un local cerrado dejó de competir: contarlo inflaba la competencia
    // interna del área y castigaba la proyección de una ubicación que en
    // realidad quedó más despejada.
    .is("deleted_at", null);
  if (error || !data) return [];
  const out: Array<{ poiId: string; name: string }> = [];
  for (const p of data) {
    if (p.lat == null || p.lng == null) continue;
    try {
      if (booleanPointInPolygon(point([p.lng, p.lat]), isoFeature as never)) {
        out.push({ poiId: p.id as string, name: (p.name as string) ?? "" });
      }
    } catch {
      // Un punto con geometría inválida no debe tumbar la proyección.
    }
  }
  return out;
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

/**
 * Antes era euclidiana plana: las 8 features pesaban lo mismo, así que
 * `n_competition_int` (0.0% explicativo aislado) tenía el mismo voto que
 * `parque_n_vehiculos`. Ahora cada feature pesa según `SIMILARITY_GROUPS`.
 */
function weightedEuclidean(a: number[], b: number[], weights: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += weights[i] * (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

// ── Función principal ─────────────────────────────────────────────────────────

export async function computeSalesProjection(
  input: ProjectionInput,
): Promise<ProjectionResult> {
  const {
    folderId, isoAnalysis, isoFeature, parque,
    cannibalization: canniInput = null,
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
  const [internalStores, complementScore] = await Promise.all([
    findInternalStores(folderId, isoFeature),
    isoFeature
      ? computeComplementScoreInPolygon(folderId, isoFeature.geometry)
      : Promise.resolve(null),
  ]);
  const nCompetitionInt = internalStores.length;
  const newFeatures = extractFeatures(isoAnalysis, parque, nCompetitionInt, complementScore);

  // ── 5. Normalizar y calcular distancias ────────────────────────────────────
  const usableFeatures = selectUsableFeatures(comparable, newFeatures, SIMILARITY_FEATURES);
  const groupWeights = featureWeights(usableFeatures);
  const { normRows, normNew } = normalizeFeatures(comparable, newFeatures, usableFeatures);
  const distances = normRows.map((row, i) => ({
    idx: i, distance: weightedEuclidean(row, normNew, groupWeights), poiId: comparable[i].poiId,
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

  // ── 7b. Canibalización, relativa a los comparables ─────────────────────────
  const estimatedUfRaw = estimatedUf;
  let cannibalization: CannibalizationAdjust | null = null;
  let estimatedUfAdj = estimatedUf;

  if (canniInput) {
    const exclusiveShare = Math.max(0, 1 - canniInput.popPct / 100);

    // Fracción exclusiva promedio de los comparables usados, ponderada por el
    // mismo peso con que entran a la estimación. `cannibalization_factor` es
    // justamente pop_exclusive / pop_total, medido por compute-poi-features.
    // Un comparable sin el dato se toma como 1 (sin solape): es lo que valía
    // antes de que existiera la medición, así que no introduce un salto.
    const compShare = topK.reduce((acc, t, i) => {
      const f = comparable[t.idx].features["cannibalization_factor"];
      const v = Number.isFinite(f) && f > 0 ? f : 1;
      return acc + v * normWeights[i];
    }, 0);

    const comparablesExclusiveShare = compShare > 0 ? compShare : 1;
    const relativeFactor = comparablesExclusiveShare > 0
      ? exclusiveShare / comparablesExclusiveShare
      : 1;

    estimatedUfAdj = estimatedUf * relativeFactor;
    const lostUf = estimatedUf - estimatedUfAdj;

    cannibalization = {
      popPct: canniInput.popPct,
      areaPct: canniInput.areaPct,
      vehiculosPct: canniInput.vehiculosPct,
      overlapPop: canniInput.overlapPop,
      overlapAreaKm2: canniInput.overlapAreaKm2,
      overlapVehiculos: canniInput.overlapVehiculos,
      exclusiveShare,
      comparablesExclusiveShare,
      relativeFactor,
      lostUf: Math.round(lostUf * 10) / 10,
      lostClp: Math.round(lostUf * currentUf),
      overlaps: canniInput.overlaps,
      incomplete: canniInput.incomplete,
    };
  }

  // ── 7c. Techo de realidad por local propio dentro de la isócrona ──────────
  /**
   * Si ya hay un local PROPIO dentro de la isócrona, el nuevo se reparte ese
   * mercado con él. Proyectar por encima de lo que vende el local que ya está
   * ahí no es defendible: significaría que el segundo local de la misma zona
   * vende más que el primero, con el mercado ya atendido.
   *
   * Por qué hace falta además de la canibalización del paso 7b: esa solo aplica
   * cuando se pudo MEDIR el solape, y medirlo exige que los vecinos tengan su
   * isócrona guardada. Cuando no la tienen, `canniInput` viene null y antes no
   * se aplicaba castigo NI se avisaba — el default peligroso era "no medido =
   * sin competencia". Este techo usa solo el punto del local dentro del
   * polígono, que siempre se puede evaluar.
   *
   * Se aplica como TECHO, no como reemplazo: si el estimado ya venía por debajo
   * de la venta del local interno, se deja tal cual.
   */
  let localityCap: {
    stores: Array<{ name: string; ufPerMonth: number }>;
    capUf: number;
    appliedUf: number | null;
    reason: string;
  } | null = null;

  if (internalStores.length > 0) {
    const conVenta = internalStores
      .map((st) => {
        const cmp = comparable.find((c) => c.poiId === st.poiId);
        return cmp && cmp.isActual ? { name: st.name, ufPerMonth: cmp.ufPerMonth } : null;
      })
      .filter((x): x is { name: string; ufPerMonth: number } => x !== null);

    if (conVenta.length > 0) {
      // Techo = el mejor local propio de adentro. Si hay más de uno, el mayor
      // es el más exigente de superar y el más informativo del techo real.
      const capUf = Math.max(...conVenta.map((x) => x.ufPerMonth));
      const excede = estimatedUfAdj > capUf;
      localityCap = {
        stores: conVenta,
        capUf: Math.round(capUf * 10) / 10,
        appliedUf: excede ? Math.round(capUf * 10) / 10 : null,
        reason: excede
          ? `El estimado (${Math.round(estimatedUfAdj)} UF/mes) superaba la venta real de ${conVenta.length === 1 ? "el local propio" : "los locales propios"} dentro de la isócrona (${Math.round(capUf)} UF/mes). Se limitó a ese valor: un segundo local en la misma zona no puede proyectarse por encima del que ya opera ahí.`
          : `Hay ${conVenta.length === 1 ? "un local propio" : `${conVenta.length} locales propios`} dentro de la isócrona (${conVenta.map((x) => `${x.name}: ${Math.round(x.ufPerMonth)} UF/mes`).join(", ")}). El estimado queda por debajo, así que no se limitó.`,
      };
      if (excede) estimatedUfAdj = capUf;
    }
  }

  // ── 8. Proyección a N años ────────────────────────────────────────────────
  // El año base es el año de los datos (maxBaseYear).
  // El año en curso es currentYear.
  // Proyectamos desde el año base hasta baseYear + horizonYears.
  const fiveYearProjection: YearProjection[] = [];
  for (let i = 0; i <= horizonYears; i++) {
    const yr  = maxBaseYear + i;
    const uf  = estimatedUfAdj * Math.pow(1 + growthRate, i);
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
      groupScores:   computeGroupScores(normVec, normNew, usableFeatures),
    };
  });

  // ── 10. Factores clave ────────────────────────────────────────────────────
  // Solo los comparables efectivamente usados: son los que sostienen la
  // estimación. Contra el promedio de TODA la red, la referencia incluía
  // locales que el modelo descartó por poco parecidos.
  const keyFactors = buildKeyFactors(newFeatures, topK.map((k) => comparable[k.idx]));

  const diagNotes = [
    cannibalization && cannibalization.popPct > 0.5
      ? `Canibalización: ${cannibalization.popPct.toFixed(0)}% de la población ya cubierta por ${cannibalization.overlaps.length} local${cannibalization.overlaps.length === 1 ? "" : "es"} propio${cannibalization.overlaps.length === 1 ? "" : "s"}`
      : null,
    cannibalization?.incomplete
      ? "Canibalización parcial: falta la isócrona guardada de algún local cercano"
      : null,
    usedPredictions
      ? "Usando predicciones del modelo Ridge (sin ventas reales cargadas)"
      : null,
    nExcludedClosed > 0
      ? `${nExcludedClosed} cerrado${nExcludedClosed === 1 ? "" : "s"} definitivamente excluido${nExcludedClosed === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean) as string[];
  const diagnosticMsg = diagNotes.length > 0 ? diagNotes.join(" · ") : null;

  return {
    estimatedUf:    Math.round(estimatedUfAdj * 10) / 10,
    estimatedClp:   Math.round(estimatedUfAdj * currentUf),
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
    cannibalization,
    localityCap,
    estimatedUfBeforeCannibalization: Math.round(estimatedUfRaw * 10) / 10,
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
    comparables: [], nWithSales: 0, nWithPredicted: 0, localityCap: null,
    keyFactors: [{ label: diagnosticMsg, value: "—", impact: "neutral" }],
    folderName, baseYear, currentYear, growthRate, usedPredictions: false, diagnosticMsg,
    cannibalization: null,
    estimatedUfBeforeCannibalization: 0,
  };
}
