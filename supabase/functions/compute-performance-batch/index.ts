// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * compute-performance-batch
 * -------------------------
 * Entrena un modelo Ridge sobre los POIs de una carpeta:
 *   - X: features territoriales de poi_features_cache (~16 dims)
 *   - y: promedio mensual de ventas en UF del último año cerrado
 *
 * Por cada POI guarda en poi_performance_analysis:
 *   - actual_monthly_clp / actual_monthly_uf
 *   - predicted_monthly_clp / predicted_monthly_uf
 *   - residual_clp / residual_pct
 *   - top_drivers: top-N contribuciones por feature (en UF)
 *   - peer_poi_ids: 5 más similares en feature space
 *   - temporal_decomposition: pre/crisis/recovery/ttm en UF
 *   - temporal_state: 'recovered_growing' | 'stable' | etc.
 *
 * Auth: requiere bearer del admin (RLS permite escribir solo a admin).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/* ============================================================
 * Sección 1: matemática Ridge (copia exacta de src/utils/ridgeRegression.ts)
 * ============================================================ */

const transpose = (m: number[][]): number[][] => {
  if (!m.length) return [];
  const rows = m.length;
  const cols = m[0].length;
  const out: number[][] = Array(cols).fill(0).map(() => Array(rows).fill(0));
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) out[j][i] = m[i][j];
  return out;
};

const matMul = (A: number[][], B: number[][]): number[][] => {
  const n = A.length, m = B[0].length, p = B.length;
  const out: number[][] = Array(n).fill(0).map(() => Array(m).fill(0));
  for (let i = 0; i < n; i++)
    for (let k = 0; k < p; k++) {
      const aik = A[i][k];
      for (let j = 0; j < m; j++) out[i][j] += aik * B[k][j];
    }
  return out;
};

const matVecMul = (A: number[][], v: number[]): number[] => {
  const n = A.length, m = v.length;
  const out: number[] = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < m; j++) s += A[i][j] * v[j];
    out[i] = s;
  }
  return out;
};

const matInverse = (M: number[][]): number[][] => {
  const n = M.length;
  const aug: number[][] = M.map((row, i) => {
    const r = [...row];
    for (let j = 0; j < n; j++) r.push(i === j ? 1 : 0);
    return r;
  });
  for (let i = 0; i < n; i++) {
    let maxRow = i, maxVal = Math.abs(aug[i][i]);
    for (let k = i + 1; k < n; k++) {
      const a = Math.abs(aug[k][i]);
      if (a > maxVal) { maxVal = a; maxRow = k; }
    }
    if (maxVal < 1e-12) throw new Error("Matriz singular en Ridge");
    if (maxRow !== i) [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];
    const pivot = aug[i][i];
    for (let j = 0; j < 2 * n; j++) aug[i][j] /= pivot;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = aug[k][i];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) aug[k][j] -= factor * aug[i][j];
    }
  }
  return aug.map((row) => row.slice(n));
};

const standardize = (X: number[][]) => {
  const n = X.length, p = X[0]?.length ?? 0;
  const means = Array(p).fill(0), stds = Array(p).fill(0);
  for (let j = 0; j < p; j++) { let s = 0; for (let i = 0; i < n; i++) s += X[i][j]; means[j] = s / Math.max(1, n); }
  for (let j = 0; j < p; j++) { let ss = 0; for (let i = 0; i < n; i++) ss += (X[i][j] - means[j]) ** 2; stds[j] = Math.max(1e-9, Math.sqrt(ss / Math.max(1, n - 1))); }
  const Xs: number[][] = Array(n).fill(0).map((_, i) => Array(p).fill(0).map((__, j) => (X[i][j] - means[j]) / stds[j]));
  return { Xs, means, stds };
};

const ridgeFit = (Xs: number[][], y: number[], alpha: number): number[] => {
  const p = Xs[0]?.length ?? 0;
  if (p === 0) return [];
  const Xt = transpose(Xs);
  const XtX = matMul(Xt, Xs);
  for (let j = 0; j < p; j++) XtX[j][j] += alpha;
  const XtX_inv = matInverse(XtX);
  const Xty = matVecMul(Xt, y);
  return matVecMul(XtX_inv, Xty);
};

const ridgeCvLoo = (Xs: number[][], y: number[], alpha: number): number => {
  const n = Xs.length;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const Xtrain = Xs.filter((_, k) => k !== i);
    const ytrain = y.filter((_, k) => k !== i);
    const yMean = ytrain.reduce((a, b) => a + b, 0) / ytrain.length;
    const ytrainC = ytrain.map((v) => v - yMean);
    const beta = ridgeFit(Xtrain, ytrainC, alpha);
    let pred = yMean;
    for (let j = 0; j < beta.length; j++) pred += beta[j] * Xs[i][j];
    sse += (y[i] - pred) ** 2;
  }
  return Math.sqrt(sse / n);
};

const ridgeFitWithCv = (Xs: number[][], y: number[]) => {
  const alphaCandidates = [0.01, 0.1, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
  if (Xs.length < 5) throw new Error(`Ridge necesita ≥5 muestras (recibido: ${Xs.length})`);
  let bestAlpha = alphaCandidates[0], bestRmse = Infinity;
  for (const a of alphaCandidates) {
    const rmse = ridgeCvLoo(Xs, y, a);
    if (rmse < bestRmse) { bestRmse = rmse; bestAlpha = a; }
  }
  const yMean = y.reduce((a, b) => a + b, 0) / Xs.length;
  const yC = y.map((v) => v - yMean);
  const beta = ridgeFit(Xs, yC, bestAlpha);
  const yPred: number[] = Xs.map((row) => {
    let s = yMean;
    for (let j = 0; j < beta.length; j++) s += beta[j] * row[j];
    return s;
  });
  const ssRes = y.reduce((acc, yi, i) => acc + (yi - yPred[i]) ** 2, 0);
  const ssTot = y.reduce((acc, yi) => acc + (yi - yMean) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { yMean, beta, alpha: bestAlpha, cvRmse: bestRmse, rSquared: r2 };
};

/* ============================================================
 * Sección 2: Detección de shocks (z-score robusto)
 * ============================================================ */

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mad = (xs: number[]): number => {
  if (!xs.length) return 0;
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
};
const mean = (xs: number[]): number => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

interface SeriesPoint { period: string; uf: number; clp: number; }

const detectRegimes = (series: SeriesPoint[]) => {
  if (series.length < 18) {
    return { hasInsufficient: true, regimes: [] as Array<{ kind: string; from: string; to: string; uf_mean: number; clp_mean: number }>, recoveryRatio: null as number | null, shortAccel: null as number | null };
  }
  // z-score robusto por mes-del-año
  const byMonth = new Map<number, number[]>();
  for (const p of series) {
    const m = parseInt(p.period.slice(5, 7), 10);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(p.uf);
  }
  const stats = new Map<number, { med: number; mad: number }>();
  byMonth.forEach((vals, m) => stats.set(m, { med: median(vals), mad: mad(vals) }));

  const shockMask = series.map((p) => {
    const m = parseInt(p.period.slice(5, 7), 10);
    const s = stats.get(m)!;
    if (s.mad === 0) return p.uf < s.med * 0.7;
    const z = (p.uf - s.med) / (1.4826 * s.mad);
    return z < -1.5;
  });

  // run más largo de shocks (gap-merge de 1 mes)
  let bestStart = -1, bestEnd = -1, bestSize = 0;
  let i = 0;
  while (i < shockMask.length) {
    if (!shockMask[i]) { i++; continue; }
    let start = i, end = i, cursor = i + 1;
    while (cursor < shockMask.length) {
      if (shockMask[cursor]) { end = cursor; cursor++; }
      else if (cursor + 1 < shockMask.length && shockMask[cursor + 1]) { end = cursor + 1; cursor += 2; }
      else break;
    }
    const size = end - start + 1;
    if (size >= 2 && size > bestSize) { bestStart = start; bestEnd = end; bestSize = size; }
    i = cursor;
  }

  const regimes: Array<{ kind: string; from: string; to: string; uf_mean: number; clp_mean: number }> = [];
  if (bestStart >= 0) {
    if (bestStart > 0) {
      const slice = series.slice(0, bestStart);
      regimes.push({ kind: "pre_shock", from: slice[0].period, to: slice[slice.length - 1].period, uf_mean: mean(slice.map(p => p.uf)), clp_mean: mean(slice.map(p => p.clp)) });
    }
    const crisis = series.slice(bestStart, bestEnd + 1);
    regimes.push({ kind: "crisis", from: crisis[0].period, to: crisis[crisis.length - 1].period, uf_mean: mean(crisis.map(p => p.uf)), clp_mean: mean(crisis.map(p => p.clp)) });
    if (bestEnd + 1 < series.length) {
      const rec = series.slice(bestEnd + 1);
      regimes.push({ kind: "recovery", from: rec[0].period, to: rec[rec.length - 1].period, uf_mean: mean(rec.map(p => p.uf)), clp_mean: mean(rec.map(p => p.clp)) });
    }
  } else {
    regimes.push({ kind: "recovery", from: series[0].period, to: series[series.length - 1].period, uf_mean: mean(series.map(p => p.uf)), clp_mean: mean(series.map(p => p.clp)) });
  }

  // TTM: últimos 12 meses
  const ttmSlice = series.slice(-12);
  if (ttmSlice.length === 12) {
    regimes.push({ kind: "ttm", from: ttmSlice[0].period, to: ttmSlice[ttmSlice.length - 1].period, uf_mean: mean(ttmSlice.map(p => p.uf)), clp_mean: mean(ttmSlice.map(p => p.clp)) });
  }

  const pre = regimes.find((r) => r.kind === "pre_shock");
  const recovery = regimes.find((r) => r.kind === "recovery");
  const recoveryRatio = pre && pre.uf_mean > 0 && recovery ? recovery.uf_mean / pre.uf_mean : null;

  let shortAccel: number | null = null;
  if (series.length >= 15) {
    const last3 = series.slice(-3).map(p => p.uf);
    const prior12 = series.slice(-15, -3).map(p => p.uf);
    if (mean(prior12) > 0) shortAccel = mean(last3) / mean(prior12) - 1;
  }

  return { hasInsufficient: false, regimes, recoveryRatio, shortAccel };
};

const classifyState = (det: ReturnType<typeof detectRegimes>): string => {
  if (det.hasInsufficient) return "insufficient_data";
  const r = det.recoveryRatio;
  const a = det.shortAccel ?? 0;
  if (r == null) return "stable";
  if (r < 0.7) return "at_risk";
  if (r < 0.95) return "not_recovered";
  if (r < 1.05) return a < -0.05 ? "decelerating" : "stable";
  return a < -0.05 ? "decelerating" : "recovered_growing";
};

/* ============================================================
 * Sección 3: handler
 * ============================================================ */

/**
 * Features que entran al modelo. SOLO territoriales.
 *
 * IMPORTANTE: NO incluir features temporales derivados del historial de
 * ventas del propio POI (ej. "promedio UF año previo", "tendencia 12m",
 * etc.). Eso sería data leakage masivo: el modelo aprendería "ventas 2025
 * ≈ ventas 2024 × inflación" y obtendría R² ~98% trivialmente, sin aportar
 * nada al objetivo del módulo.
 *
 * El propósito del modelo es medir el efecto del ENTORNO TERRITORIAL en
 * las ventas, para identificar locales que sub/sobre-rinden respecto a
 * lo que su entorno predice. Si quisieras forecasting puro de ventas, ese
 * sería otro módulo (ARIMA o similar).
 *
 * Excluimos también features que serían redundantes: cells_count,
 * cannibalization_factor, pop_exclusive (subsumido por pop_total).
 */
const FEATURE_KEYS = [
  "pop_total",
  "pop_density_avg",
  "nse_high_pct",
  "nse_mid_pct",
  "nse_low_pct",
  "income_avg",
  "traffic_idx",
  "n_competition_int",
  "n_competition_ext",
  "dist_competition_m",
  "complement_score",
  "n_anchors",
  "n_complement_medium",
  "n_complement_low",
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
  dist_competition_m: "Distancia competidor más cercano",
  complement_score: "Comercio complementario",
  n_anchors: "Anclas (alto flujo)",
  n_complement_medium: "Complementarios medio",
  n_complement_low: "Complementarios bajo",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "missing auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });

    const body = (await req.json().catch(() => ({}))) as { folder_id?: string; target_year?: number };
    const folderId = body.folder_id;
    if (!folderId) {
      return new Response(JSON.stringify({ error: "folder_id requerido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1) Cargar config (config_version, métrica clave)
    const { data: settings, error: settingsErr } = await supabase
      .from("analysis_settings")
      .select("*")
      .eq("folder_id", folderId)
      .maybeSingle();
    if (settingsErr) throw settingsErr;
    if (!settings) {
      return new Response(JSON.stringify({ error: "Sin analysis_settings para esta carpeta" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const configVersion = settings.config_version as number;

    // 2) Determinar el último año cerrado: si estamos en 2026 → 2025
    const now = new Date();
    const targetYear = body.target_year ?? now.getUTCFullYear() - 1;

    // 3) Cargar features de todos los POIs de la carpeta
    const { data: featRows, error: featErr } = await supabase
      .from("poi_features_cache")
      .select("poi_id, features, is_rm")
      .eq("folder_id", folderId)
      .eq("config_version", configVersion);
    if (featErr) throw featErr;
    if (!featRows || featRows.length === 0) {
      return new Response(JSON.stringify({ error: "No hay features cacheados. Corre 'Calcular features territoriales' primero." }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const poiIds = featRows.map((r: any) => r.poi_id as string);

    // 4) Cargar UF — normalizamos period a "YYYY-MM-DD" porque a veces
    // Supabase devuelve dates como ISO con timestamp completo según el cliente.
    const normalizeDateStr = (d: any): string => {
      if (typeof d !== "string") return String(d).slice(0, 10);
      // Si tiene 'T' (timestamp ISO) o más de 10 chars, recortar al día
      return d.length > 10 ? d.slice(0, 10) : d;
    };

    const { data: ufRows, error: ufErr } = await supabase
      .from("uf_values").select("period, value");
    if (ufErr) throw ufErr;
    const ufMap = new Map<string, number>();
    for (const r of (ufRows ?? []) as any[]) {
      ufMap.set(normalizeDateStr(r.period), Number(r.value));
    }

    // Helper: lookup con tolerancia ±2 meses si el período exacto no existe.
    const lookupUfFuzzy = (period: string): number | null => {
      const exact = ufMap.get(period);
      if (exact && exact > 0) return exact;
      const [y, m] = period.split("-").map(Number);
      if (!isFinite(y) || !isFinite(m)) return null;
      for (let delta = 1; delta <= 2; delta++) {
        for (const sign of [-1, 1]) {
          const ym = y * 12 + (m - 1) + sign * delta;
          const yy = Math.floor(ym / 12);
          const mm = (ym % 12) + 1;
          const candidate = `${yy}-${String(mm).padStart(2, "0")}-01`;
          const v = ufMap.get(candidate);
          if (v && v > 0) return v;
        }
      }
      return null;
    };

    // 5) Cargar TODAS las métricas de los POIs (típicamente 'ventas').
    // Paginar: Supabase corta a 1000 filas por defecto y aquí hay miles.
    const PAGE = 1000;
    const metricRows: any[] = [];
    let metricPages = 0;
    {
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("poi_metrics")
          .select("poi_id, metric_key, period, value")
          .in("poi_id", poiIds)
          .order("period", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        metricRows.push(...data);
        metricPages++;
        if (data.length < PAGE) break;
        from += PAGE;
      }
    }

    // Determinar la métrica primaria: la más frecuente. Casi siempre 'ventas'.
    const metricCounts = new Map<string, number>();
    for (const r of (metricRows ?? []) as any[]) {
      metricCounts.set(r.metric_key, (metricCounts.get(r.metric_key) ?? 0) + 1);
    }
    let primaryMetric = "ventas";
    let maxCount = 0;
    metricCounts.forEach((c, k) => { if (c > maxCount) { maxCount = c; primaryMetric = k; } });

    // Indexar series por POI — ahora con period normalizado y UF fuzzy
    let droppedNoUf = 0;
    let droppedNoValue = 0;
    const seriesByPoi = new Map<string, SeriesPoint[]>();
    for (const r of (metricRows ?? []) as any[]) {
      if (r.metric_key !== primaryMetric) continue;
      const period = normalizeDateStr(r.period);
      const clp = Number(r.value);
      if (!isFinite(clp) || clp <= 0) { droppedNoValue++; continue; }
      const ufRate = lookupUfFuzzy(period);
      if (!ufRate) { droppedNoUf++; continue; }
      const arr = seriesByPoi.get(r.poi_id) ?? [];
      arr.push({ period, clp, uf: clp / ufRate });
      seriesByPoi.set(r.poi_id, arr);
    }
    seriesByPoi.forEach((arr) => arr.sort((a, b) => a.period.localeCompare(b.period)));

    // 6) Construir target y por POI: promedio mensual UF del último año cerrado.
    //    Aceptar al menos 10 de 12 meses (estándar industria, tolerante a 1-2
    //    meses faltantes por errores operacionales / locales recién abiertos).
    const yearStart = `${targetYear}-01-01`;
    const yearEnd = `${targetYear}-12-31`;
    const MIN_MONTHS_FOR_TARGET = 10;

    interface PoiCalc {
      poi_id: string;
      features: number[]; // ordenados según FEATURE_KEYS (territoriales)
      ufTargetMean: number | null;
      clpTargetMean: number | null;
      monthsInTarget: number;
      hasValidTarget: boolean;
      series: SeriesPoint[];
    }
    let droppedNoFeatures = 0;
    let droppedTooFewMonths = 0;
    const calcs: PoiCalc[] = [];
    for (const f of (featRows ?? []) as any[]) {
      const series = seriesByPoi.get(f.poi_id) ?? [];
      const inYear = series.filter((p) => p.period >= yearStart && p.period <= yearEnd);
      const territorialVec = FEATURE_KEYS.map((k) => Number(f.features?.[k] ?? 0));
      const allTerritorialZero = territorialVec.every((v) => v === 0);
      if (allTerritorialZero) droppedNoFeatures++;
      const validTarget = inYear.length >= MIN_MONTHS_FOR_TARGET;
      if (!validTarget) droppedTooFewMonths++;
      calcs.push({
        poi_id: f.poi_id,
        features: territorialVec,
        ufTargetMean: validTarget ? mean(inYear.map(p => p.uf)) : null,
        clpTargetMean: validTarget ? mean(inYear.map(p => p.clp)) : null,
        monthsInTarget: inYear.length,
        hasValidTarget: validTarget,
        series,
      });
    }

    // 7) Filtrar features constantes o casi-constantes en el set de entrenamiento.
    //    Una columna sin varianza no aporta información y al estandarizar inflama ruido.
    const trainSet = calcs.filter((c) => c.hasValidTarget);

    const droppedFeatures: string[] = [];
    const keptFeatureIdx: number[] = [];
    const keptFeatureKeys: string[] = [];
    if (trainSet.length > 0) {
      for (let j = 0; j < FEATURE_KEYS.length; j++) {
        const col = trainSet.map((c) => c.features[j]);
        const m = col.reduce((s, v) => s + v, 0) / col.length;
        let ss = 0;
        for (const v of col) ss += (v - m) ** 2;
        const sd = Math.sqrt(ss / Math.max(1, col.length - 1));
        // Tolerancia: sd absoluta y relativa a la media.
        const relSd = Math.abs(m) > 1e-9 ? sd / Math.abs(m) : sd;
        if (sd < 1e-9 || relSd < 1e-6) {
          droppedFeatures.push(FEATURE_KEYS[j]);
        } else {
          keptFeatureIdx.push(j);
          keptFeatureKeys.push(FEATURE_KEYS[j]);
        }
      }
    }

    // Diagnóstico exhaustivo en logs (visibles en Supabase Edge Functions → Logs)
    console.log(`[performance-batch] Diagnóstico:
  - Features cacheados: ${featRows?.length ?? 0}
  - Filas métricas cargadas (paginado): ${metricRows.length} en ${metricPages} páginas
  - Métrica primaria: ${primaryMetric} (${maxCount} filas)
  - UF en cache: ${ufMap.size} períodos
  - Muestras métricas descartadas:
      sin valor / valor 0: ${droppedNoValue}
      sin UF (incluso fuzzy ±2m): ${droppedNoUf}
  - POIs con features territoriales todos en 0: ${droppedNoFeatures}
  - POIs con < ${MIN_MONTHS_FOR_TARGET} meses de target: ${droppedTooFewMonths}
  - POIs aptos para entrenamiento: ${trainSet.length}
  - Features territoriales: ${FEATURE_KEYS.length}
  - Features descartados por varianza ~0: ${droppedFeatures.length} [${droppedFeatures.join(", ")}]
  - Features usados en el modelo: ${keptFeatureKeys.length} [${keptFeatureKeys.join(", ")}]
  - Target year: ${targetYear}`);

    if (trainSet.length < 5) {
      return new Response(JSON.stringify({
        error: `Solo ${trainSet.length} POIs aptos para entrenar (mínimo 5). Ver logs de diagnóstico.`,
        diagnostic: {
          features_cached: featRows?.length ?? 0,
          metrics_rows: metricRows?.length ?? 0,
          primary_metric: primaryMetric,
          uf_periods: ufMap.size,
          dropped_no_value: droppedNoValue,
          dropped_no_uf: droppedNoUf,
          dropped_no_features: droppedNoFeatures,
          dropped_too_few_months: droppedTooFewMonths,
          target_year: targetYear,
        }
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Vector reducido por POI usando solo las columnas conservadas.
    const selectVec = (raw: number[]): number[] => keptFeatureIdx.map((j) => raw[j]);

    const X_train = trainSet.map((c) => selectVec(c.features));
    const y_train = trainSet.map((c) => c.ufTargetMean as number);
    const { Xs: Xs_train, means, stds } = standardize(X_train);
    const fit = ridgeFitWithCv(Xs_train, y_train);

    console.log(`[performance-batch] Modelo entrenado: r²=${fit.rSquared.toFixed(4)} cv_rmse=${fit.cvRmse.toFixed(2)} UF lambda=${fit.alpha} sd(y)=${(Math.sqrt(y_train.reduce((s,v)=>s+(v-y_train.reduce((a,b)=>a+b,0)/y_train.length)**2,0)/(y_train.length-1))).toFixed(2)} UF`);

    // 8) Helper: estandarizar un punto y predecir
    const standardizePoint = (x: number[]): number[] =>
      x.map((v, j) => (v - means[j]) / Math.max(1e-9, stds[j]));
    const predict = (xStd: number[]): number => {
      let s = fit.yMean;
      for (let j = 0; j < xStd.length; j++) s += fit.beta[j] * xStd[j];
      return s;
    };

    // 9) Calcular contribuciones, peers y temporal_decomposition por cada POI
    //    (incluso los nuevos sin año completo — para ellos solo predecimos drivers)
    const allXs = calcs.map((c) => standardizePoint(selectVec(c.features)));
    const findPeers = (idx: number, k = 5) => {
      const target = allXs[idx];
      const dists: Array<{ idx: number; distance: number }> = [];
      for (let i = 0; i < allXs.length; i++) {
        if (i === idx) continue;
        let sq = 0;
        for (let j = 0; j < target.length; j++) sq += (allXs[i][j] - target[j]) ** 2;
        dists.push({ idx: i, distance: Math.sqrt(sq) });
      }
      dists.sort((a, b) => a.distance - b.distance);
      return dists.slice(0, k);
    };

    let upserted = 0;
    const errors: string[] = [];

    for (let i = 0; i < calcs.length; i++) {
      const c = calcs[i];
      try {
        const xStd = allXs[i];
        const predictedUf = predict(xStd);
        const predictedClp = c.series.length > 0
          ? predictedUf * (ufMap.get(c.series[c.series.length - 1].period) ?? 38000)
          : predictedUf * 38000;

        const residualUf = c.ufTargetMean != null ? c.ufTargetMean - predictedUf : null;
        const residualClp = c.clpTargetMean != null && residualUf != null
          ? residualUf * (ufMap.get(`${targetYear}-12-01`) ?? 38000)
          : null;
        const residualPct = c.ufTargetMean != null && c.ufTargetMean > 0 && residualUf != null
          ? (residualUf / c.ufTargetMean) * 100
          : null;

        // Top drivers por contribución absoluta — solo features realmente usados.
        const contributions = keptFeatureKeys.map((feature, j) => {
          const coef = fit.beta[j];
          const contributionUf = coef * xStd[j];
          const ufRate = ufMap.get(`${targetYear}-12-01`) ?? 38000;
          return {
            feature,
            label: FEATURE_LABELS[feature] ?? feature,
            contribution_uf: Number(contributionUf.toFixed(2)),
            contribution_clp: Math.round(contributionUf * ufRate),
            z: Number(xStd[j].toFixed(3)),
          };
        });
        contributions.sort((a, b) => Math.abs(b.contribution_uf) - Math.abs(a.contribution_uf));
        const topDrivers = contributions.slice(0, 5);

        // Peers
        const peers = findPeers(i, 5).map((p) => calcs[p.idx].poi_id);

        // Temporal decomposition
        const det = detectRegimes(c.series);
        const state = c.hasValidTarget ? classifyState(det) : "insufficient_data";
        const decomposition: any = { regimes: det.regimes, recovery_ratio: det.recoveryRatio, short_term_acceleration: det.shortAccel };

        const lastUfRate = c.series.length > 0 ? ufMap.get(c.series[c.series.length - 1].period) ?? 38000 : 38000;

        const { error: upErr } = await supabase
          .from("poi_performance_analysis")
          .upsert({
            poi_id: c.poi_id,
            folder_id: folderId,
            target_year: targetYear,
            actual_monthly_clp: c.clpTargetMean != null ? Math.round(c.clpTargetMean) : null,
            actual_monthly_uf: c.ufTargetMean != null ? Number(c.ufTargetMean.toFixed(2)) : null,
            predicted_monthly_clp: Math.round(predictedClp),
            predicted_monthly_uf: Number(predictedUf.toFixed(2)),
            residual_clp: residualClp != null ? Math.round(residualClp) : null,
            residual_pct: residualPct != null ? Number(residualPct.toFixed(2)) : null,
            top_drivers: topDrivers,
            peer_poi_ids: peers,
            temporal_state: state,
            temporal_decomposition: decomposition,
            config_version: configVersion,
            computed_at: new Date().toISOString(),
          }, { onConflict: "poi_id" });
        if (upErr) errors.push(`${c.poi_id}: ${upErr.message}`);
        else upserted++;
      } catch (e) {
        errors.push(`${c.poi_id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return new Response(JSON.stringify({
      ok: errors.length === 0,
      upserted,
      train_set_size: trainSet.length,
      total_pois: calcs.length,
      target_year: targetYear,
      r_squared: fit.rSquared,
      cv_rmse: fit.cvRmse,
      lambda: fit.alpha,
      errors: errors.slice(0, 10),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("compute-performance-batch fatal:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
