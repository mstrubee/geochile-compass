/**
 * salesPotentialModel.ts
 * ──────────────────────
 * Modelo de potencial de venta para una ubicación nueva, en DOS PASOS:
 *
 *   1. Potencial SIN canibalizar, estimado desde el territorio y entrenado
 *      SOLO con locales aislados (sin local propio cerca).
 *   2. Descuento por canibalización del sitio nuevo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ DOS PASOS (y por qué el enfoque anterior no podía funcionar)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * El modelo de comparables entrenaba con TODOS los locales mezclados y recién
 * después ajustaba por canibalización. Eso destruye la señal: un local con un
 * hermano a 2 km vende menos de lo que su territorio permitiría, así que al
 * meterlo en la misma muestra el territorio "parece" no explicar nada.
 *
 * Medido sobre los 64 locales con venta real (parque automotriz → venta):
 *
 *   | muestra                                  | r²    |
 *   |------------------------------------------|-------|
 *   | aislados (sin local propio a <5 km, n=34)| 28,0% |
 *   | con vecino propio (n=30)                 |  8,4% |
 *   | todos mezclados (n=64)                   | 2-3%  |
 *
 * MEDICIÓN DEFINITIVA (2026-08-19, con todas las correcciones aplicadas):
 * entrenando con los 30 locales Autoplanet aislados y de parque creíble, la
 * varianza explicada fuera de muestra es **11,0%**, con error medio de 18,2 MM
 * contra 18,7 MM de predecir el promedio — o sea **2,5% de mejora real**.
 *
 * Los 22,8% que aparecían en la primera medición estaban infladas por dos
 * cosas: incluían locales con parque roto, y calculaban el aislamiento solo
 * contra los 64 locales con 12 meses de venta, ignorando los que ya operan sin
 * historia completa. Corregido ambos: 11,0%.
 *
 * COMPORTAMIENTO CONOCIDO (validar con `npm run validar:potencial`):
 * - Subestima ~31% a los mejores locales (Buin 90,7 vs 132,2 real; Quilicura
 *   120,7 vs 176,2). Es la regresión a la media esperable con r² bajo.
 * - SOBREestima a los muy canibalizados: Santa Rosa da +83% (107,2 vs 58,7
 *   real). El `cannibalization_factor` mide solape de POBLACIÓN y subestima la
 *   canibalización COMERCIAL: Santa Rosa tiene 5 locales propios a <5 km y
 *   vende 40% de su potencial territorial, pero el factor dice 72% exclusivo.
 *   El paso 2 necesita calibrarse con datos reales — el cierre de Departamental
 *   (agosto 2026) es la oportunidad de medirlo.
 *
 * POR ESO: este modelo NO debe presentarse como la cifra del business case.
 * Sirve como segunda opinión junto a la mediana + p25 de la red, siempre con
 * `accuracy.looR2` a la vista.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ADVERTENCIAS QUE NO HAY QUE PERDER
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * - **La magnitud es frágil.** Con n=34, excluir los locales de parque dudoso
 *   baja el ajuste a 18,1%, y excluir además el punto más extremo lo deja en
 *   10,7%. El efecto es real y la dirección es sólida, pero el número honesto
 *   es un RANGO de 10-23%, no 28%. `accuracy.looR2` lo reporta medido sobre los
 *   datos del momento, así que hay que mirarlo y no confiar a ciegas.
 * - **Sigue explicando la minoría de la varianza.** Un 20% significa que el 80%
 *   depende de cosas que no están en los datos (superficie y formato del local,
 *   surtido, gestión). No presentar el resultado como una predicción precisa.
 * - **Agregar variables lo EMPEORA.** Con parque solo: 22,8%. Con parque +
 *   densidad comercial: 19,9%. Con parque + población: 20,2%. Por eso el modelo
 *   usa una sola variable a propósito: con 34 casos, cada variable extra
 *   sobreajusta más de lo que aporta.
 */

/** Un local con venta real conocida y su territorio, para entrenar. */
export interface TrainingStore {
  poiId: string;
  name: string;
  /**
   * Cadena a la que pertenece (folder_id). SOLO los locales de la MISMA cadena
   * cuentan como canibalizadores.
   *
   * Esto no es un detalle: la base tiene 72 locales Autoplanet y 22 Agroplanet,
   * que venden cosas distintas a clientes distintos. Tratar un Agroplanet como
   * competencia interna de un Autoplanet redujo la muestra de entrenamiento de
   * 34 a 20 locales y hundió la exactitud de ~22% a 6,8%. El chequeo vive acá
   * adentro y no en el llamador para que el error no se pueda repetir.
   */
  chainId: string;
  lat: number;
  lng: number;
  /** Venta mensual en la unidad que se quiera predecir (UF/mes o CLP/mes). */
  sales: number;
  /** Vehículos en la isócrona del local. */
  vehicles: number;
  /** Población de la isócrona — solo para detectar parque con dato roto. */
  population: number;
}

export interface PotentialModelConfig {
  /** Radio en km para considerar que un local está "aislado". Validado en 5. */
  isolationRadiusKm: number;
  /**
   * Se excluye del ENTRENAMIENTO un local cuyo ratio vehículos/habitante sea
   * menor a (mediana / este divisor): son datos de parque incompletos y
   * corromperían el ajuste. Verificado: 3 locales de la red están así
   * (Ovalle 0,019 contra 0,338 de mediana).
   */
  brokenRatioDivisor: number;
  /** Regularización ridge sobre la variable estandarizada. */
  lambda: number;
}

export const DEFAULT_POTENTIAL_CONFIG: PotentialModelConfig = {
  isolationRadiusKm: 5,
  brokenRatioDivisor: 4,
  lambda: 1,
};

export interface PotentialModel {
  /** Intercepto y pendiente sobre vehículos estandarizados. */
  intercept: number;
  slope: number;
  vehiclesMean: number;
  vehiclesSd: number;
  /** Rango de parque con que se entrenó: fuera de esto se extrapola. */
  vehiclesMin: number;
  vehiclesMax: number;
  /** Locales que entraron al entrenamiento. */
  trainedOn: Array<{ name: string; vehicles: number; sales: number }>;
  excluded: {
    notIsolated: string[];
    brokenParque: string[];
  };
  accuracy: {
    /** Varianza explicada fuera de muestra (leave-one-out). Puede ser negativa. */
    looR2: number;
    /** Error absoluto medio fuera de muestra, en la unidad de `sales`. */
    looMae: number;
    /** MAE de predecir siempre el promedio, como referencia. */
    baselineMae: number;
    n: number;
  };
}

const mean = (a: number[]): number => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const sd = (a: number[]): number => {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length) || 1;
};
const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Distancia en km entre dos puntos (haversine). */
export const distanceKm = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number => {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Ridge de una variable sobre datos ya estandarizados. */
const fitSlope = (x: number[], y: number[], lambda: number): number => {
  let xy = 0;
  let xx = 0;
  for (let i = 0; i < x.length; i++) {
    xy += x[i] * y[i];
    xx += x[i] * x[i];
  }
  return xx + lambda > 0 ? xy / (xx + lambda) : 0;
};

/**
 * Entrena el modelo del paso 1 con los locales de la red.
 *
 * Devuelve null si no quedan suficientes locales aislados con dato creíble:
 * es preferible no ofrecer un modelo a ofrecer uno sin sustento.
 */
export const fitPotentialModel = (
  stores: TrainingStore[],
  config: PotentialModelConfig = DEFAULT_POTENTIAL_CONFIG,
): PotentialModel | null => {
  const conParque = stores.filter((s) => s.vehicles > 0 && s.sales > 0);
  if (conParque.length < 10) return null;

  // Paso A: descartar locales con dato de parque incompleto — corromperían el
  // ajuste porque su ratio vehículos/habitante es imposible.
  const ratios = conParque
    .filter((s) => s.population > 0)
    .map((s) => s.vehicles / s.population);
  const medRatio = ratios.length ? median(ratios) : 0;
  const esRoto = (s: TrainingStore) =>
    medRatio > 0 && s.population > 0 && s.vehicles / s.population < medRatio / config.brokenRatioDivisor;

  const brokenParque = conParque.filter(esRoto).map((s) => s.name);
  const creibles = conParque.filter((s) => !esRoto(s));

  // Paso B: quedarse solo con los AISLADOS. Es el corazón del rediseño: un
  // local canibalizado vende menos de lo que su territorio permite, y mezclarlo
  // enmascara la relación (2-3% mezclados contra 28% aislados).
  const isAislado = (s: TrainingStore) =>
    !stores.some(
      (o) =>
        o.poiId !== s.poiId &&
        o.chainId === s.chainId && // otra cadena no caniboliza
        distanceKm(s, o) <= config.isolationRadiusKm,
    );

  const aislados = creibles.filter(isAislado);
  const notIsolated = creibles.filter((s) => !isAislado(s)).map((s) => s.name);

  if (aislados.length < 10) return null;

  const xs = aislados.map((s) => s.vehicles);
  const ys = aislados.map((s) => s.sales);
  const xm = mean(xs);
  const xsd = sd(xs);
  const ym = mean(ys);
  const ysd = sd(ys);
  const zx = xs.map((v) => (v - xm) / xsd);
  const zy = ys.map((v) => (v - ym) / ysd);

  const slopeZ = fitSlope(zx, zy, config.lambda);

  // Exactitud fuera de muestra (leave-one-out). Es el número que hay que
  // mostrar: el ajuste dentro de muestra siempre se ve mejor de lo que es.
  let ssRes = 0;
  let absErr = 0;
  for (let out = 0; out < aislados.length; out++) {
    const idx = aislados.map((_, i) => i).filter((i) => i !== out);
    const xTr = idx.map((i) => xs[i]);
    const yTr = idx.map((i) => ys[i]);
    const xmT = mean(xTr);
    const xsdT = sd(xTr);
    const ymT = mean(yTr);
    const ysdT = sd(yTr);
    const s = fitSlope(
      xTr.map((v) => (v - xmT) / xsdT),
      yTr.map((v) => (v - ymT) / ysdT),
      config.lambda,
    );
    const pred = ymT + s * ((xs[out] - xmT) / xsdT) * ysdT;
    ssRes += (ys[out] - pred) ** 2;
    absErr += Math.abs(ys[out] - pred);
  }
  const ssTot = ys.reduce((acc, v) => acc + (v - ym) ** 2, 0);

  return {
    intercept: ym,
    slope: slopeZ * ysd,
    vehiclesMean: xm,
    vehiclesSd: xsd,
    vehiclesMin: Math.min(...xs),
    vehiclesMax: Math.max(...xs),
    trainedOn: aislados.map((s) => ({ name: s.name, vehicles: s.vehicles, sales: s.sales })),
    excluded: { notIsolated, brokenParque },
    accuracy: {
      looR2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
      looMae: absErr / aislados.length,
      baselineMae: mean(ys.map((v) => Math.abs(v - ym))),
      n: aislados.length,
    },
  };
};

export interface PotentialEstimate {
  /** Paso 1: potencial del territorio, sin descontar canibalización. */
  potentialUncannibalized: number;
  /** Paso 2: ya descontada la canibalización del sitio nuevo. */
  estimate: number;
  /** Fracción del mercado que NO comparte con locales propios (1 = exclusivo). */
  exclusiveShare: number;
  /** true si el parque del sitio queda fuera del rango de entrenamiento. */
  extrapolating: boolean;
  extrapolationNote: string | null;
}

/**
 * Aplica el modelo a una ubicación nueva.
 *
 * `exclusiveShare` es la fracción de mercado que la ubicación NO comparte con
 * locales propios (1 = sin solape). Acá se multiplica directo, sin corregir
 * "relativo a los comparables" como hacía el modelo anterior: al entrenar solo
 * con locales aislados, la base ya es un potencial sin canibalizar, así que la
 * corrección relativa dejó de ser necesaria.
 */
export const estimatePotential = (
  model: PotentialModel,
  vehicles: number,
  exclusiveShare: number,
): PotentialEstimate => {
  const z = model.vehiclesSd > 0 ? (vehicles - model.vehiclesMean) / model.vehiclesSd : 0;
  // Piso en 0: una extrapolación agresiva hacia abajo no debe dar venta negativa.
  const potential = Math.max(0, model.intercept + model.slope * z);

  const share = Math.min(1, Math.max(0, exclusiveShare));
  const fuera = vehicles < model.vehiclesMin || vehicles > model.vehiclesMax;

  return {
    potentialUncannibalized: potential,
    estimate: potential * share,
    exclusiveShare: share,
    extrapolating: fuera,
    extrapolationNote: fuera
      ? `El parque de la ubicación (${Math.round(vehicles).toLocaleString("es-CL")} vehículos) está fuera del rango con que se entrenó el modelo (${Math.round(model.vehiclesMin).toLocaleString("es-CL")} a ${Math.round(model.vehiclesMax).toLocaleString("es-CL")}). La estimación extrapola y no tiene respaldo en los datos.`
      : null,
  };
};
