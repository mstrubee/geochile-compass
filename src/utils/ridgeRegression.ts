/**
 * Regresión Ridge con cross-validation leave-one-out para selección de lambda.
 *
 * Implementación matemática pura sin dependencias. Funciona para datasets
 * pequeños (~200 muestras × ~20 features), que es exactamente nuestro caso
 * (68 locales × 16 features territoriales).
 *
 * Modelo:
 *   y = Xβ + ε
 *   β̂ = (XᵀX + λI)⁻¹ Xᵀy
 *
 * Ridge añade el término λI para regularizar y evitar overfitting cuando
 * features están correlacionados (ej. densidad e ingreso son correlacionados
 * positivamente en el contexto chileno).
 *
 * El intercept se maneja agregando una columna de 1s a X y NO regularizando
 * el primer coeficiente (la convención estándar).
 *
 * Estandarización: X se estandariza (media=0, std=1) antes de entrenar. Los
 * coeficientes y contribuciones se reportan en escala estandarizada para
 * comparabilidad entre features.
 */

export interface StandardizedX {
  X: number[][]; // matriz n × p (sin intercept)
  means: number[]; // p valores
  stds: number[]; // p valores (con piso 1e-9 si var=0)
  featureNames: string[];
}

/* ---------- Matrix helpers ---------- */

const transpose = (m: number[][]): number[][] => {
  if (!m.length) return [];
  const rows = m.length;
  const cols = m[0].length;
  const out: number[][] = Array(cols)
    .fill(0)
    .map(() => Array(rows).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      out[j][i] = m[i][j];
    }
  }
  return out;
};

const matMul = (A: number[][], B: number[][]): number[][] => {
  const n = A.length;
  const m = B[0].length;
  const p = B.length;
  const out: number[][] = Array(n)
    .fill(0)
    .map(() => Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < p; k++) {
      const aik = A[i][k];
      for (let j = 0; j < m; j++) out[i][j] += aik * B[k][j];
    }
  }
  return out;
};

const matVecMul = (A: number[][], v: number[]): number[] => {
  const n = A.length;
  const m = v.length;
  const out: number[] = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < m; j++) s += A[i][j] * v[j];
    out[i] = s;
  }
  return out;
};

/**
 * Inversa de matriz cuadrada por eliminación de Gauss-Jordan con pivoteo
 * parcial. Suficiente para tamaños ≤ 30×30.
 */
const matInverse = (M: number[][]): number[][] => {
  const n = M.length;
  // Crea matriz aumentada [M | I]
  const aug: number[][] = M.map((row, i) => {
    const r = [...row];
    for (let j = 0; j < n; j++) r.push(i === j ? 1 : 0);
    return r;
  });

  for (let i = 0; i < n; i++) {
    // Pivoteo: encontrar el pivote más grande
    let maxRow = i;
    let maxVal = Math.abs(aug[i][i]);
    for (let k = i + 1; k < n; k++) {
      const a = Math.abs(aug[k][i]);
      if (a > maxVal) {
        maxVal = a;
        maxRow = k;
      }
    }
    if (maxVal < 1e-12) {
      throw new Error("Matriz singular en Ridge regression");
    }
    if (maxRow !== i) {
      [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];
    }
    // Normalizar pivote
    const pivot = aug[i][i];
    for (let j = 0; j < 2 * n; j++) aug[i][j] /= pivot;
    // Eliminar columna i en demás filas
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = aug[k][i];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) aug[k][j] -= factor * aug[i][j];
    }
  }
  // Extraer la mitad derecha
  return aug.map((row) => row.slice(n));
};

/* ---------- Estandarización ---------- */

export const standardize = (X: number[][], featureNames: string[]): StandardizedX => {
  const n = X.length;
  const p = X[0]?.length ?? 0;
  const means = Array(p).fill(0);
  const stds = Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i][j];
    means[j] = s / Math.max(1, n);
  }
  for (let j = 0; j < p; j++) {
    let ss = 0;
    for (let i = 0; i < n; i++) ss += (X[i][j] - means[j]) ** 2;
    stds[j] = Math.max(1e-9, Math.sqrt(ss / Math.max(1, n - 1)));
  }
  const Xs: number[][] = Array(n)
    .fill(0)
    .map((_, i) => Array(p).fill(0).map((__, j) => (X[i][j] - means[j]) / stds[j]));
  return { X: Xs, means, stds, featureNames };
};

export const standardizePoint = (
  x: number[],
  means: number[],
  stds: number[],
): number[] => x.map((v, j) => (v - means[j]) / stds[j]);

/* ---------- Ridge core ---------- */

export interface RidgeFit {
  beta: number[];        // Coeficientes en escala estandarizada (incluye intercept[0])
  yMean: number;         // Media de y para "centrar" predicciones
  alpha: number;         // λ usado
  cvRmse: number;        // RMSE de CV LOO
  rSquared: number;      // R² in-sample
}

/**
 * Entrena Ridge en X estandarizado + y centrado.
 * Devuelve coeficientes (sin intercept porque y se centra previamente).
 */
export const ridgeFit = (Xs: number[][], y: number[], alpha: number): number[] => {
  const n = Xs.length;
  const p = Xs[0]?.length ?? 0;
  if (n === 0 || p === 0) return [];

  // X' X + λI
  const Xt = transpose(Xs);
  const XtX = matMul(Xt, Xs);
  for (let j = 0; j < p; j++) XtX[j][j] += alpha;
  const XtX_inv = matInverse(XtX);
  // β = (X'X + λI)⁻¹ X' y
  const Xty = matVecMul(Xt, y);
  return matVecMul(XtX_inv, Xty);
};

/**
 * Cross-validation leave-one-out. Para el caso n=68, esto requiere n
 * inversiones de matriz. Cada inversión es O(p³) = 16³ ≈ 4096 ops. Total
 * ~280k ops. Despreciable (< 50ms en browser/Deno).
 */
export const ridgeCvLoo = (Xs: number[][], y: number[], alpha: number): number => {
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

/**
 * Encuentra el λ óptimo via grid search sobre escala log.
 */
export const ridgeFitWithCv = (
  Xs: number[][],
  y: number[],
  alphaCandidates: number[] = [0.01, 0.1, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500],
): RidgeFit => {
  const n = Xs.length;
  if (n < 5) {
    throw new Error(`Ridge necesita al menos 5 muestras (recibido: ${n})`);
  }
  let bestAlpha = alphaCandidates[0];
  let bestRmse = Infinity;
  for (const a of alphaCandidates) {
    const rmse = ridgeCvLoo(Xs, y, a);
    if (rmse < bestRmse) {
      bestRmse = rmse;
      bestAlpha = a;
    }
  }
  // Fit final con el alpha ganador, sobre todo el dataset.
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  const yC = y.map((v) => v - yMean);
  const beta = ridgeFit(Xs, yC, bestAlpha);

  // R² in-sample
  const yPred: number[] = Xs.map((row) => {
    let s = yMean;
    for (let j = 0; j < beta.length; j++) s += beta[j] * row[j];
    return s;
  });
  const ssRes = y.reduce((acc, yi, i) => acc + (yi - yPred[i]) ** 2, 0);
  const ssTot = y.reduce((acc, yi) => acc + (yi - yMean) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return {
    beta: [yMean, ...beta], // [0]=intercept = ȳ
    yMean,
    alpha: bestAlpha,
    cvRmse: bestRmse,
    rSquared: r2,
  };
};

/* ---------- Predicción y contribuciones ---------- */

export const ridgePredict = (xStd: number[], fit: RidgeFit): number => {
  let s = fit.yMean;
  // fit.beta[0] = intercept (= yMean), beta[1..p] = features
  for (let j = 0; j < xStd.length; j++) s += fit.beta[j + 1] * xStd[j];
  return s;
};

/**
 * Para un POI dado: contribución de cada feature respecto al promedio del
 * chain. Σ contributions = predicción - yMean.
 */
export const ridgeContributions = (
  xStd: number[],
  fit: RidgeFit,
  featureNames: string[],
): Array<{ feature: string; contribution: number; xStd: number; coef: number }> => {
  const out: Array<{ feature: string; contribution: number; xStd: number; coef: number }> = [];
  for (let j = 0; j < xStd.length; j++) {
    const coef = fit.beta[j + 1];
    out.push({
      feature: featureNames[j],
      contribution: coef * xStd[j], // delta vs yMean en la misma unidad de y
      xStd: xStd[j],
      coef,
    });
  }
  return out;
};

/* ---------- Distancia entre POIs (peers) ---------- */

/**
 * Distancia euclidiana en feature space estandarizado.
 * Devuelve los k más cercanos (excluyendo el propio POI).
 */
export const findPeers = (
  poiIdx: number,
  Xs: number[][],
  k: number = 5,
): Array<{ idx: number; distance: number }> => {
  const target = Xs[poiIdx];
  const dists: Array<{ idx: number; distance: number }> = [];
  for (let i = 0; i < Xs.length; i++) {
    if (i === poiIdx) continue;
    let sq = 0;
    for (let j = 0; j < target.length; j++) {
      sq += (Xs[i][j] - target[j]) ** 2;
    }
    dists.push({ idx: i, distance: Math.sqrt(sq) });
  }
  dists.sort((a, b) => a.distance - b.distance);
  return dists.slice(0, k);
};
