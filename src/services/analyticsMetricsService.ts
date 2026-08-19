import { supabase } from "@/integrations/supabase/client";
import { loadUfMap } from "@/services/ufService";

/**
 * Métricas de eficiencia comercial por local.
 *
 * ── Por qué esta sección existe ──────────────────────────────────────────────
 * La validación leave-one-out sobre los 64 locales con venta real mostró que el
 * modelo de comparables explica 2,5% de la varianza y que NINGÚN feature
 * disponible —territorial o de parque— predice mejor que la mediana de la red.
 * O sea que lo que determina la venta no está en las variables que se miden hoy.
 *
 * Entonces el valor no está en predecir sino en exponer la DISPERSIÓN: la tasa
 * de captura varía 17× entre locales (La Calera captura 33% del gasto de su
 * área, 10 de Julio el 1,0%). Los extremos son donde está el aprendizaje, y
 * quien puede formular la hipótesis que falta es el equipo comercial, no el
 * modelo.
 */

/** Superficie asumida mientras no exista el dato real (decisión de Matias). */
export const ASSUMED_SQM_STANDARD = 425;
/** Un Express es la mitad de un local estándar. */
export const ASSUMED_SQM_EXPRESS = ASSUMED_SQM_STANDARD / 2;

export interface LocalMetrics {
  poiId: string;
  name: string;
  zona: string | null;
  isExpress: boolean;
  sqm: number;

  /** Venta real. null si el local no tiene ventas cargadas. */
  ufMonth: number | null;
  clpMonth: number | null;

  // Territorio
  population: number | null;
  households: number | null;
  incomeAvg: number | null;
  vehicles: number | null;
  spendTotalClp: number | null;
  spendTargetClp: number | null;
  isoMinutes: number | null;

  // ── Grupo 1: eficiencia ────────────────────────────────────────────────────
  /** UF/mes por cada 1.000 habitantes de la isócrona. */
  ufPer1000Pop: number | null;
  /** % del gasto endógeno del área que captura el local. */
  captureRatePct: number | null;
  /** UF/mes por m². */
  ufPerSqm: number | null;
  /**
   * UF/mes por cada 1.000 vehículos del parque en la isócrona.
   * `null` cuando la cobertura de la capa de parque en esa zona es insuficiente
   * (ver `vehiclesCoverageOk`), porque el ratio sería puro artefacto.
   */
  ufPer1000Vehicles: number | null;
  /** Vehículos por habitante. Sirve para juzgar la cobertura del dato. */
  vehiclesPerCapita: number | null;
  /** false si la capa de parque claramente no cubre la zona. */
  vehiclesCoverageOk: boolean;
  /** Índice 100 = mediana de su Zona. */
  zoneIndex: number | null;
  /** Venta menos la predicha por el modelo Ridge, en UF. Positivo = rinde más. */
  residualUf: number | null;
  residualPct: number | null;
  /** % de población exclusiva (100 = sin canibalización). */
  exclusivePopPct: number | null;
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const ratio = (a: number | null, b: number | null, scale = 1): number | null =>
  a != null && b != null && b > 0 ? (a / b) * scale : null;

/**
 * Piso de vehículos por habitante para confiar en el dato de parque.
 *
 * La tasa de motorización real de Chile ronda 0,25–0,30 veh/hab y la mediana de
 * la red es 0,332. Siete locales quedan bajo 0,10 —Ovalle marca 0,019 y
 * Casablanca 0,012—, o sea que la capa H3 de parque no cubre esas zonas. Sin
 * este filtro Ovalle aparecía como el local MÁS eficiente de la red (1.415
 * UF/1.000 veh contra una mediana de 39), que es un artefacto del denominador
 * incompleto, no una lectura del negocio.
 */
const MIN_VEHICLES_PER_CAPITA = 0.10;

/**
 * Métricas de los locales de una carpeta.
 *
 * Se traen las tres fuentes en paralelo y se cruzan en memoria: son ~70 filas,
 * y un join embebido dejaría fuera los locales sin performance o sin features,
 * que son justamente los que hay que ver para saber que faltan datos.
 */
export const fetchLocalMetrics = async (folderId: string): Promise<LocalMetrics[]> => {
  const [poisRes, perfRes, featRes, attrRes, ufMap] = await Promise.all([
    supabase.from("pois").select("id, name").eq("folder_id", folderId).is("deleted_at", null),
    supabase
      .from("poi_performance_analysis")
      .select("poi_id, actual_monthly_uf, actual_monthly_clp, predicted_monthly_uf_model_a, residual_uf_model_a, residual_pct_model_a")
      .eq("folder_id", folderId),
    supabase.from("poi_features_cache").select("poi_id, features, iso_minutes").eq("folder_id", folderId),
    supabase.from("poi_attributes").select("poi_id, attr_key, attr_value"),
    loadUfMap(),
  ]);

  /**
   * UF vigente para convertir la venta a pesos.
   *
   * `actual_monthly_clp` está NULL en los 64 locales con venta —solo se guardó
   * en UF—, así que el gasto del área (que está en CLP) no se podía comparar
   * contra nada. Se convierte con la UF más reciente, igual que hace
   * `computeSalesProjection`, para que ambos lados de la razón queden en la
   * misma unidad.
   */
  const currentUf =
    [...ufMap.entries()].sort((a, b) => b[0].localeCompare(a[0]))[0]?.[1] ?? 40_000;

  const perfById = new Map((perfRes.data ?? []).map((r) => [r.poi_id, r]));
  const featById = new Map((featRes.data ?? []).map((r) => [r.poi_id, r]));
  const zonaById = new Map<string, string>();
  for (const a of attrRes.data ?? []) {
    if (a.attr_key === "Zona" && a.attr_value) zonaById.set(a.poi_id as string, a.attr_value as string);
  }

  const base: LocalMetrics[] = (poisRes.data ?? []).map((p) => {
    const perf = perfById.get(p.id) as Record<string, unknown> | undefined;
    const featRow = featById.get(p.id) as { features?: Record<string, unknown>; iso_minutes?: number } | undefined;
    const f = featRow?.features ?? {};

    const ufMonth = num(perf?.actual_monthly_uf);
    const clpMonth = num(perf?.actual_monthly_clp);
    const population = num(f["pop_total"]);
    const vehicles = num(f["parque_n_vehiculos"]);
    const spendTotalClp = num(f["gasto_endogeno_total_clp"]);
    const spendTargetClp = num(f["gasto_endogeno_objetivo_clp"]);
    const exclusive = num(f["cannibalization_factor"]);

    // Sin el dato real de superficie se asume el estándar; Express es la mitad.
    // Hoy ningún local está sincerado como Express, así que esta columna es
    // constante — sirve para "venta por m²", no para discriminar.
    const isExpress = /express/i.test(p.name ?? "");
    const sqm = isExpress ? ASSUMED_SQM_EXPRESS : ASSUMED_SQM_STANDARD;

    const vehiclesPerCapita = ratio(vehicles, population);
    const vehiclesCoverageOk =
      vehiclesPerCapita != null && vehiclesPerCapita >= MIN_VEHICLES_PER_CAPITA;

    return {
      poiId: p.id as string,
      name: (p.name as string) ?? "(sin nombre)",
      zona: zonaById.get(p.id as string) ?? null,
      isExpress,
      sqm,
      ufMonth,
      clpMonth: clpMonth ?? (ufMonth != null ? ufMonth * currentUf : null),
      population,
      households: num(f["hh_total"]),
      incomeAvg: num(f["income_avg"]),
      vehicles,
      spendTotalClp,
      spendTargetClp,
      isoMinutes: featRow?.iso_minutes ?? null,
      ufPer1000Pop: ratio(ufMonth, population, 1000),
      // El gasto del área está en CLP, así que la venta también debe ir en CLP.
      // Se usa la derivada de UF porque la columna en pesos viene vacía.
      captureRatePct: ratio(
        clpMonth ?? (ufMonth != null ? ufMonth * currentUf : null),
        spendTotalClp, 100,
      ),
      ufPerSqm: ratio(ufMonth, sqm),
      ufPer1000Vehicles: vehiclesCoverageOk ? ratio(ufMonth, vehicles, 1000) : null,
      vehiclesPerCapita,
      vehiclesCoverageOk,
      zoneIndex: null, // se completa abajo: necesita la mediana de cada zona
      residualUf: num(perf?.residual_uf_model_a),
      residualPct: num(perf?.residual_pct_model_a),
      exclusivePopPct: exclusive != null ? exclusive * 100 : null,
    };
  });

  // ── Índice de zona: 100 = mediana de la zona del local ──────────────────────
  // Aísla el efecto regional, que es el más grande que se pudo medir: las zonas
  // van de 2.241 a 2.783 UF de promedio.
  const byZone = new Map<string, number[]>();
  for (const m of base) {
    if (!m.zona || m.ufMonth == null) continue;
    const arr = byZone.get(m.zona) ?? [];
    arr.push(m.ufMonth);
    byZone.set(m.zona, arr);
  }
  const medianOf = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const i = Math.floor(s.length / 2);
    return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
  };
  const zoneMedian = new Map([...byZone].map(([z, xs]) => [z, medianOf(xs)]));
  for (const m of base) {
    const med = m.zona ? zoneMedian.get(m.zona) : undefined;
    if (med && med > 0 && m.ufMonth != null) m.zoneIndex = (m.ufMonth / med) * 100;
  }

  return base;
};

/** Estadísticas de una columna, para mostrar la posición de cada local. */
export interface ColumnStats {
  min: number; p25: number; median: number; p75: number; max: number; n: number;
}

export const statsOf = (values: Array<number | null>): ColumnStats | null => {
  const xs = values.filter((v): v is number => v != null).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const at = (q: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * q))];
  const i = Math.floor(xs.length / 2);
  return {
    min: xs[0],
    p25: at(0.25),
    median: xs.length % 2 ? xs[i] : (xs[i - 1] + xs[i]) / 2,
    p75: at(0.75),
    max: xs[xs.length - 1],
    n: xs.length,
  };
};

/** Percentil de un valor dentro de una distribución (0..100). */
export const percentileOf = (value: number, values: Array<number | null>): number | null => {
  const xs = values.filter((v): v is number => v != null);
  if (xs.length === 0) return null;
  return (xs.filter((x) => x <= value).length / xs.length) * 100;
};
