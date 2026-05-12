// ============================================================================
// Edge function: compute-performance-batch
// Phase 4: 2 modelos paralelos (A sin nota, B con nota) + selección automática
//          de features con forward selection + features de parque automotor.
// ============================================================================
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PAGE = 1000;
const MIN_MONTHS_FOR_TARGET = 10;
const ALPHAS = [0.01, 0.1, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
const FORWARD_SEL_MIN_IMPROVEMENT = 0.005; // 0.5% mínimo
const FORWARD_SEL_MAX_FEATURES = 8;

// ----------------------------------------------------------------------------
// Features candidatos. La selección automática elige cuáles entran al modelo.
// ----------------------------------------------------------------------------
const TERRITORIAL_FEATURE_KEYS = [
  "pop_total", "pop_density_avg", "nse_high_pct", "nse_mid_pct", "nse_low_pct",
  "income_avg", "traffic_idx", "n_competition_int", "n_competition_ext",
  "dist_competition_m", "complement_score", "n_anchors",
  "n_complement_medium", "n_complement_low",
];

const PARQUE_FEATURE_KEYS = [
  "parque_n_vehiculos", "parque_edad_media", "parque_edad_p25", "parque_edad_p75",
  "parque_pct_5_15_anos", "parque_pct_mayores_15",
  "parque_pct_japonesas", "parque_pct_chinas_coreanas",
  "parque_pct_europeas", "parque_pct_us",
  "parque_diversidad_hhi",
  "parque_top_marca_1_pct", "parque_top_marca_2_pct", "parque_top_marca_3_pct",
];

const ENGINEERED_FEATURE_KEYS = [
  "log_parque_n_vehiculos", // log1p(n_vehiculos) — el lineal satura rápido
];

// Modelo A: territoriales + parque (sin nota de gestión)
const MODEL_A_FEATURES = [
  ...TERRITORIAL_FEATURE_KEYS,
  ...PARQUE_FEATURE_KEYS,
  ...ENGINEERED_FEATURE_KEYS,
];

// Modelo B: A + nota de gestión (cuando está disponible)
const MODEL_B_FEATURES = [
  ...MODEL_A_FEATURES,
  "management_score",
];

const FEATURE_LABELS: Record<string, string> = {
  pop_total: "Población total",
  pop_density_avg: "Densidad",
  nse_high_pct: "% NSE alto",
  nse_mid_pct: "% NSE medio",
  nse_low_pct: "% NSE bajo",
  income_avg: "Ingreso promedio",
  traffic_idx: "Tráfico vehicular",
  n_competition_int: "Competencia interna",
  n_competition_ext: "Competencia externa",
  dist_competition_m: "Distancia competidor",
  complement_score: "Comercio complementario",
  n_anchors: "Anclas",
  n_complement_medium: "Complementarios medio",
  n_complement_low: "Complementarios bajo",
  parque_n_vehiculos: "Vehículos en isócrona",
  log_parque_n_vehiculos: "Vehículos en isócrona (log)",
  parque_edad_media: "Edad media parque",
  parque_edad_p25: "Edad parque p25",
  parque_edad_p75: "Edad parque p75",
  parque_pct_5_15_anos: "% parque 5-15 años",
  parque_pct_mayores_15: "% parque >15 años",
  parque_pct_japonesas: "% marcas japonesas",
  parque_pct_chinas_coreanas: "% marcas chinas/coreanas",
  parque_pct_europeas: "% marcas europeas",
  parque_pct_us: "% marcas norteamericanas",
  parque_diversidad_hhi: "HHI marcas",
  parque_top_marca_1_pct: "% marca top 1",
  parque_top_marca_2_pct: "% marca top 2",
  parque_top_marca_3_pct: "% marca top 3",
  management_score: "Nota de gestión (ponderada)",
};

// ----------------------------------------------------------------------------
// Tipos
// ----------------------------------------------------------------------------
interface SeriesPoint { period: string; clp: number; uf: number; }
interface PoiCalc {
  poi_id: string;
  features: Record<string, number | null>;
  ufTargetMean: number | null;
  hasValidTarget: boolean;
  managementScore: number | null;
}
interface ModelResult {
  r2: number;
  cvRmse: number;
  alpha: number;
  beta: number[];
  intercept: number;
  featuresUsed: string[];
  featureMeans: number[];
  featureStds: number[];
  nTrain: number;
  predictions: Map<string, number>;
}

// ----------------------------------------------------------------------------
// Ridge
// ----------------------------------------------------------------------------
const ridgeSolve = (X: number[][], y: number[], alpha: number): number[] => {
  const p = X[0].length;
  // XtX + αI
  const A: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = 0; j < p; j++) {
      let s = 0;
      for (let k = 0; k < X.length; k++) s += X[k][i] * X[k][j];
      A[i][j] = s + (i === j ? alpha : 0);
    }
  }
  // Xty
  const b = new Array(p).fill(0);
  for (let i = 0; i < p; i++) {
    let s = 0;
    for (let k = 0; k < X.length; k++) s += X[k][i] * y[k];
    b[i] = s;
  }
  return gaussSolve(A, b);
};

const gaussSolve = (Aorig: number[][], borig: number[]): number[] => {
  const n = Aorig.length;
  const A = Aorig.map(r => r.slice());
  const b = borig.slice();
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) maxRow = k;
    }
    [A[i], A[maxRow]] = [A[maxRow], A[i]];
    [b[i], b[maxRow]] = [b[maxRow], b[i]];
    if (Math.abs(A[i][i]) < 1e-12) continue;
    for (let k = i + 1; k < n; k++) {
      const f = A[k][i] / A[i][i];
      for (let j = i; j < n; j++) A[k][j] -= f * A[i][j];
      b[k] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
    x[i] = Math.abs(A[i][i]) < 1e-12 ? 0 : s / A[i][i];
  }
  return x;
};

const standardize = (X: number[][]): { Xs: number[][]; means: number[]; stds: number[]; } => {
  const n = X.length, p = X[0].length;
  const means = new Array(p).fill(0);
  const stds = new Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i][j];
    means[j] = s / n;
  }
  for (let j = 0; j < p; j++) {
    let ss = 0;
    for (let i = 0; i < n; i++) ss += (X[i][j] - means[j]) ** 2;
    stds[j] = Math.sqrt(ss / Math.max(1, n - 1));
  }
  const Xs = X.map(row => row.map((v, j) => stds[j] < 1e-9 ? 0 : (v - means[j]) / stds[j]));
  return { Xs, means, stds };
};

const cvRmseLOO = (Xs: number[][], y: number[], alpha: number): number => {
  const n = y.length;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const Xt: number[][] = [], yt: number[] = [];
    for (let k = 0; k < n; k++) if (k !== i) { Xt.push(Xs[k]); yt.push(y[k]); }
    const ym = yt.reduce((a, b) => a + b, 0) / yt.length;
    const ytCentered = yt.map(v => v - ym);
    const beta = ridgeSolve(Xt, ytCentered, alpha);
    let pred = ym;
    for (let j = 0; j < beta.length; j++) pred += Xs[i][j] * beta[j];
    sse += (y[i] - pred) ** 2;
  }
  return Math.sqrt(sse / n);
};

/** Fit Ridge con CV-LOO sobre grid de alphas y devolver mejor. */
const fitRidgeWithCV = (
  X: number[][],
  y: number[],
  featureNames: string[]
): ModelResult => {
  if (X.length === 0 || X[0].length === 0) {
    return {
      r2: 0, cvRmse: 0, alpha: 0, beta: [], intercept: y.reduce((a, b) => a + b, 0) / Math.max(1, y.length),
      featuresUsed: [], featureMeans: [], featureStds: [], nTrain: y.length,
      predictions: new Map(),
    };
  }
  const { Xs, means, stds } = standardize(X);
  // Drop constants
  const keepIdx: number[] = [];
  for (let j = 0; j < stds.length; j++) if (stds[j] > 1e-9) keepIdx.push(j);
  const Xs2 = Xs.map(row => keepIdx.map(j => row[j]));
  const meansKept = keepIdx.map(j => means[j]);
  const stdsKept = keepIdx.map(j => stds[j]);
  const namesKept = keepIdx.map(j => featureNames[j]);

  let bestAlpha = ALPHAS[0], bestRmse = Infinity;
  for (const a of ALPHAS) {
    const r = cvRmseLOO(Xs2, y, a);
    if (r < bestRmse) { bestRmse = r; bestAlpha = a; }
  }
  const ym = y.reduce((a, b) => a + b, 0) / y.length;
  const yCentered = y.map(v => v - ym);
  const beta = ridgeSolve(Xs2, yCentered, bestAlpha);

  // In-sample R²
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < y.length; i++) {
    let pred = ym;
    for (let j = 0; j < beta.length; j++) pred += Xs2[i][j] * beta[j];
    ssRes += (y[i] - pred) ** 2;
    ssTot += (y[i] - ym) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return {
    r2, cvRmse: bestRmse, alpha: bestAlpha, beta,
    intercept: ym,
    featuresUsed: namesKept,
    featureMeans: meansKept,
    featureStds: stdsKept,
    nTrain: y.length,
    predictions: new Map(),
  };
};

/** Forward selection: empieza vacío, agrega feature que mejor mejora R². */
const forwardSelection = (
  rows: { poi_id: string; values: Record<string, number | null>; }[],
  y: number[],
  candidates: string[],
): ModelResult => {
  if (rows.length === 0) {
    return fitRidgeWithCV([], y, []);
  }
  // Filtrar candidatos sin valores válidos
  const validCandidates = candidates.filter(c => {
    let nValid = 0;
    for (const r of rows) {
      const v = r.values[c];
      if (v != null && Number.isFinite(v)) nValid++;
    }
    return nValid >= rows.length * 0.8; // al menos 80% con valor
  });

  const selected: string[] = [];
  const remaining = new Set(validCandidates);
  let bestModel: ModelResult | null = null;
  let prevR2 = -Infinity;

  while (remaining.size > 0 && selected.length < FORWARD_SEL_MAX_FEATURES) {
    let bestCandidate: string | null = null;
    let bestCandidateR2 = -Infinity;
    let bestCandidateModel: ModelResult | null = null;

    for (const c of remaining) {
      const trial = [...selected, c];
      const X = rows.map(r => trial.map(f => {
        const v = r.values[f];
        return v == null || !Number.isFinite(v) ? 0 : v;
      }));
      const model = fitRidgeWithCV(X, y, trial);
      if (model.r2 > bestCandidateR2) {
        bestCandidateR2 = model.r2;
        bestCandidate = c;
        bestCandidateModel = model;
      }
    }

    if (bestCandidate == null || bestCandidateModel == null) break;
    if (bestCandidateR2 - prevR2 < FORWARD_SEL_MIN_IMPROVEMENT) {
      // No mejora suficiente, detenemos
      break;
    }
    selected.push(bestCandidate);
    remaining.delete(bestCandidate);
    bestModel = bestCandidateModel;
    prevR2 = bestCandidateR2;
  }

  if (!bestModel) {
    // Si nada mejoró, devolver modelo trivial (predice media)
    return fitRidgeWithCV([], y, []);
  }

  // Compute predicciones para todos los rows
  const predictions = new Map<string, number>();
  for (const row of rows) {
    let pred = bestModel.intercept;
    for (let j = 0; j < bestModel.featuresUsed.length; j++) {
      const fname = bestModel.featuresUsed[j];
      const v = row.values[fname];
      const valNum = v == null || !Number.isFinite(v) ? 0 : v;
      const std = bestModel.featureStds[j];
      const mean = bestModel.featureMeans[j];
      const standardized = std < 1e-9 ? 0 : (valNum - mean) / std;
      pred += standardized * bestModel.beta[j];
    }
    predictions.set(row.poi_id, pred);
  }
  bestModel.predictions = predictions;
  return bestModel;
};

// ----------------------------------------------------------------------------
// Helpers data
// ----------------------------------------------------------------------------
const normalizeDateStr = (s: string): string => {
  if (!s) return s;
  return s.length === 7 ? `${s}-01` : s.slice(0, 10);
};

const fetchPaginated = async (
  supabase: ReturnType<typeof createClient>,
  table: string,
  query: (q: any) => any,
): Promise<any[]> => {
  const all: any[] = [];
  let page = 0;
  while (true) {
    const from = page * PAGE;
    const to = from + PAGE - 1;
    let q = supabase.from(table).select("*").range(from, to);
    q = query(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    page++;
  }
  return all;
};

const computeInterpretation = (
  resA: number | null,
  resAPct: number | null,
  resB: number | null,
  resBPct: number | null,
  score: number | null,
): string => {
  if (resAPct == null) return "Sin datos suficientes para evaluar.";
  if (score == null) return "POI sin nota de gestión: solo Modelo A disponible.";
  if (resBPct == null) return "Modelo B no disponible para este POI.";
  const absA = Math.abs(resAPct);
  const absB = Math.abs(resBPct);
  const gestionExplica = absA - absB; // cuánto absorbe la nota
  const signo = resAPct >= 0 ? "sobre" : "sub";

  if (absA < 10) {
    return `El POI rinde según lo esperado por su entorno (residuo A ${resAPct.toFixed(1)}%).`;
  }
  if (gestionExplica > absA * 0.5) {
    return `${signo === "sobre" ? "Sobre" : "Sub"}rendimiento territorial (${resAPct.toFixed(1)}%) explicado en gran parte por la gestión observada (nota ${score.toFixed(1)}). Residuo final ${resBPct.toFixed(1)}%.`;
  }
  if (signo === "sobre" && resBPct > 20) {
    return `Sobrerendimiento inexplicado: ni entorno ni gestión observada lo justifican. Residuo B ${resBPct.toFixed(1)}%. Investigar.`;
  }
  if (signo === "sub" && resBPct < -20) {
    return `Subrendimiento crítico: pese a gestión nota ${score.toFixed(1)}, sigue por debajo (${resBPct.toFixed(1)}%). Intervenir.`;
  }
  return `Residuo A ${resAPct.toFixed(1)}% → B ${resBPct.toFixed(1)}% tras incorporar gestión (nota ${score.toFixed(1)}).`;
};

// ----------------------------------------------------------------------------
// Main handler
// ----------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    // Aceptar folder_id (snake_case, viene del cliente actual) o folderId (camelCase)
    const folderId: string = body.folder_id ?? body.folderId;
    const targetYear: number = body.target_year ?? body.targetYear ?? 2025;
    if (!folderId) {
      return new Response(JSON.stringify({ error: "folder_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const yearStart = `${targetYear}-01-01`;
    const yearEnd = `${targetYear}-12-31`;

    // ----------------------------------------------------------------------
    // 1) Cargar POIs de la carpeta + features cacheadas
    // ----------------------------------------------------------------------
    const { data: pois, error: errPois } = await supabase
      .from("pois")
      .select("id, name, folder_id")
      .eq("folder_id", folderId);
    if (errPois) throw errPois;
    const poiIds = (pois ?? []).map(p => p.id);

    const featRows = await fetchPaginated(
      supabase, "poi_features_cache",
      q => q.in("poi_id", poiIds),
    );

    // ----------------------------------------------------------------------
    // 2) Cargar métricas (ventas) paginado
    // ----------------------------------------------------------------------
    const metricRows = await fetchPaginated(
      supabase, "poi_metrics",
      q => q.in("poi_id", poiIds).eq("metric_key", "ventas")
        .gte("period", `${targetYear - 5}-01-01`).lte("period", yearEnd),
    );

    // ----------------------------------------------------------------------
    // 3) Cargar UF
    // ----------------------------------------------------------------------
    const { data: ufRows } = await supabase
      .from("uf_values").select("period, value");
    const ufMap = new Map<string, number>();
    for (const r of ufRows ?? []) ufMap.set(normalizeDateStr(r.period), r.value);

    const lookupUfFuzzy = (period: string): number | null => {
      const p = normalizeDateStr(period);
      if (ufMap.has(p)) return ufMap.get(p)!;
      // ±2 meses
      const [y, m] = p.split("-").map(Number);
      for (const delta of [-1, 1, -2, 2]) {
        let mm = m + delta, yy = y;
        if (mm < 1) { mm += 12; yy--; }
        if (mm > 12) { mm -= 12; yy++; }
        const key = `${yy}-${String(mm).padStart(2, "0")}-01`;
        if (ufMap.has(key)) return ufMap.get(key)!;
      }
      return null;
    };

    // ----------------------------------------------------------------------
    // 4) Cargar evaluaciones (score ponderado por POI)
    // ----------------------------------------------------------------------
    const { data: evalRows } = await supabase
      .from("poi_evaluation_summary")
      .select("poi_id, weighted_score")
      .in("poi_id", poiIds);
    const scoreMap = new Map<string, number>();
    for (const r of evalRows ?? []) {
      if (r.weighted_score != null) scoreMap.set(r.poi_id, Number(r.weighted_score));
    }

    // ----------------------------------------------------------------------
    // 5) Construir series por POI y target
    // ----------------------------------------------------------------------
    const seriesByPoi = new Map<string, SeriesPoint[]>();
    for (const m of metricRows) {
      const uf = lookupUfFuzzy(m.period);
      if (uf == null || m.value == null || Number(m.value) === 0) continue;
      const arr = seriesByPoi.get(m.poi_id) ?? [];
      arr.push({
        period: normalizeDateStr(m.period),
        clp: Number(m.value),
        uf: Number(m.value) / uf,
      });
      seriesByPoi.set(m.poi_id, arr);
    }

    // ----------------------------------------------------------------------
    // 6) Construir filas para entrenamiento
    // ----------------------------------------------------------------------
    const calcs: PoiCalc[] = [];
    for (const f of featRows) {
      const series = seriesByPoi.get(f.poi_id) ?? [];
      const inYear = series.filter(p => p.period >= yearStart && p.period <= yearEnd);
      const validTarget = inYear.length >= MIN_MONTHS_FOR_TARGET;
      const ufTargetMean = validTarget
        ? inYear.reduce((s, p) => s + p.uf, 0) / inYear.length
        : null;

      // Combinar features territoriales + parque
      const featuresAll: Record<string, number | null> = {};
      const feats = f.features ?? {};
      for (const k of TERRITORIAL_FEATURE_KEYS) {
        const v = feats[k];
        featuresAll[k] = v == null ? null : Number(v);
      }
      for (const k of PARQUE_FEATURE_KEYS) {
        const v = feats[k];
        featuresAll[k] = v == null ? null : Number(v);
      }
      // Engineered: log(n_vehiculos)
      const nVeh = featuresAll["parque_n_vehiculos"];
      featuresAll["log_parque_n_vehiculos"] = nVeh != null ? Math.log1p(nVeh) : null;
      // Score gestión (si existe)
      const score = scoreMap.get(f.poi_id);
      featuresAll["management_score"] = score != null ? score : null;

      calcs.push({
        poi_id: f.poi_id,
        features: featuresAll,
        ufTargetMean,
        hasValidTarget: validTarget,
        managementScore: score ?? null,
      });
    }

    const trainSet = calcs.filter(c => c.hasValidTarget && c.ufTargetMean != null);
    const trainSetWithScore = trainSet.filter(c => c.managementScore != null);

    // ----------------------------------------------------------------------
    // 7) Entrenar MODELO A (sin nota de gestión) — todos los POIs con target válido
    // ----------------------------------------------------------------------
    const yA = trainSet.map(c => c.ufTargetMean!);
    const rowsA = trainSet.map(c => ({ poi_id: c.poi_id, values: c.features }));
    const modelA = forwardSelection(rowsA, yA, MODEL_A_FEATURES);

    console.log(`[performance-batch] Modelo A: n=${trainSet.length}, ` +
      `R²=${(modelA.r2 * 100).toFixed(1)}%, ` +
      `λ=${modelA.alpha}, features=[${modelA.featuresUsed.join(", ")}]`);

    // ----------------------------------------------------------------------
    // 8) Entrenar MODELO B (con nota de gestión) — solo POIs evaluados
    // ----------------------------------------------------------------------
    let modelB: ModelResult | null = null;
    if (trainSetWithScore.length >= 15) {
      const yB = trainSetWithScore.map(c => c.ufTargetMean!);
      const rowsB = trainSetWithScore.map(c => ({ poi_id: c.poi_id, values: c.features }));
      modelB = forwardSelection(rowsB, yB, MODEL_B_FEATURES);
      console.log(`[performance-batch] Modelo B: n=${trainSetWithScore.length}, ` +
        `R²=${(modelB.r2 * 100).toFixed(1)}%, ` +
        `λ=${modelB.alpha}, features=[${modelB.featuresUsed.join(", ")}]`);
    } else {
      console.log(`[performance-batch] Modelo B no entrenado: solo ${trainSetWithScore.length} POIs evaluados (mínimo 15).`);
    }

    // Predicciones del Modelo B para POIs sin score (asumiendo score=0)
    const predictWithModelB = (calc: PoiCalc): number | null => {
      if (!modelB) return null;
      let pred = modelB.intercept;
      for (let j = 0; j < modelB.featuresUsed.length; j++) {
        const fname = modelB.featuresUsed[j];
        const v = fname === "management_score"
          ? (calc.managementScore ?? 0)  // POI sin nota: asume neutral
          : calc.features[fname];
        const valNum = v == null || !Number.isFinite(v) ? 0 : v;
        const std = modelB.featureStds[j];
        const mean = modelB.featureMeans[j];
        const standardized = std < 1e-9 ? 0 : (valNum - mean) / std;
        pred += standardized * modelB.beta[j];
      }
      return pred;
    };

    // ----------------------------------------------------------------------
    // 9) Construir filas para upsert
    // ----------------------------------------------------------------------
    const upsertRows: any[] = [];
    for (const calc of calcs) {
      if (!calc.hasValidTarget) continue;
      const actual = calc.ufTargetMean!;
      const predA = modelA.predictions.get(calc.poi_id) ?? null;
      const predB = predictWithModelB(calc);

      const residA = predA != null ? actual - predA : null;
      const residAPct = (residA != null && predA != null && predA > 0)
        ? (residA / predA) * 100 : null;
      const residB = predB != null ? actual - predB : null;
      const residBPct = (residB != null && predB != null && predB > 0)
        ? (residB / predB) * 100 : null;

      const interp = computeInterpretation(residA, residAPct, residB, residBPct, calc.managementScore);

      upsertRows.push({
        poi_id: calc.poi_id,
        folder_id: folderId,
        target_year: targetYear,
        config_version: 1,
        actual_monthly_uf: actual,
        // Compatibilidad: predicted_monthly_uf y residual_pct apuntan al Modelo A
        predicted_monthly_uf: predA,
        residual_pct: residAPct,
        // Modelo A explícito
        predicted_monthly_uf_model_a: predA,
        residual_uf_model_a: residA,
        residual_pct_model_a: residAPct,
        // Modelo B
        predicted_monthly_uf_model_b: predB,
        residual_uf_model_b: residB,
        residual_pct_model_b: residBPct,
        // Metadata
        model_a_r2: modelA.r2,
        model_b_r2: modelB?.r2 ?? null,
        model_a_features_used: modelA.featuresUsed,
        model_b_features_used: modelB?.featuresUsed ?? null,
        model_b_n_evaluated: trainSetWithScore.length,
        interpretation: interp,
        computed_at: new Date().toISOString(),
      });
    }

    const { error: upsertError } = await supabase
      .from("poi_performance_analysis")
      .upsert(upsertRows, { onConflict: "poi_id" });
    if (upsertError) throw upsertError;

    // ----------------------------------------------------------------------
    // 10) Respuesta
    // ----------------------------------------------------------------------
    return new Response(JSON.stringify({
      success: true,
      n_pois_processed: upsertRows.length,
      model_a: {
        r2: modelA.r2,
        cv_rmse: modelA.cvRmse,
        alpha: modelA.alpha,
        n_train: modelA.nTrain,
        features_used: modelA.featuresUsed.map(f => ({ key: f, label: FEATURE_LABELS[f] ?? f })),
      },
      model_b: modelB ? {
        r2: modelB.r2,
        cv_rmse: modelB.cvRmse,
        alpha: modelB.alpha,
        n_train: modelB.nTrain,
        features_used: modelB.featuresUsed.map(f => ({ key: f, label: FEATURE_LABELS[f] ?? f })),
      } : null,
      n_pois_with_score: trainSetWithScore.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("[performance-batch] ERROR:", e?.message, e?.stack);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
