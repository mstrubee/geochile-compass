/**
 * export-sales-projection
 * =======================
 * Expone la proyección de ventas de una isócrona guardada a un sistema externo
 * (leaseflow-pro), para usarla como `ventaMes` de un Business Case.
 *
 * Solo lectura. No escribe nada ni toca comportamiento existente.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTRATO REAL — lo que hay guardado en `projection_settings` y lo que NO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1) ¿`projection_settings.result` tiene el shape de `ProjectionResult`?
 *    SÍ, exacto. `AnalysisPanel.persistProjection()` guarda `result: res` donde
 *    `res` es el retorno literal de `computeSalesProjection()`
 *    (src/services/salesProjectionService.ts), sin transformar ni recortar.
 *
 *    PERO su `fiveYearProjection` es el valor CRUDO EN RÉGIMEN: compounding
 *    puro desde el año base, `estimatedUf * (1 + growthRate)^i`
 *    (salesProjectionService.ts, paso 8). NO tiene la rampa de maduración.
 *    `salesProjectionService.ts` no importa `maturationCurveService.ts` en
 *    ningún punto.
 *
 * 2) ¿Dónde se aplica la rampa?
 *    SOLO en el render / la exportación, client-side, NUNCA persistida. La
 *    aplica `buildProjRows()` (AnalysisPanel.tsx:1048), que se llama desde el
 *    render de `ProjectionSection` y desde el memo `projForReport` (el snapshot
 *    del PDF). `fetchMaturationCurve` aparece únicamente en `AnalysisPanel.tsx`
 *    y `MaturationCurveAdminSection.tsx` — jamás en el camino de guardado.
 *    ⇒ Esta función TIENE que aplicar la rampa ella misma. Lo hace replicando
 *      `buildProjRows` byte a byte (ver `buildProjRows` más abajo y
 *      ./maturation.ts).
 *
 *    Además de la rampa, `buildProjRows` respeta tres ajustes del analista que
 *    SÍ están persistidos en `projection_settings` y que también se aplican
 *    acá, porque son criterio sobre ESA ubicación y son lo que el usuario ve:
 *      · `rampEnabled`   false = traslado de un local ya en régimen (rampa off)
 *      · `rateOverrides` tasa fijada a mano por año (null = usar la curva)
 *      · `adjustPct`     castigo/premio manual en %, multiplicativo al final
 *    (`isExpress` NO se aplica aparte: el botón Express fija `adjustPct` al
 *     valor de la carpeta — AnalysisPanel.tsx:1320 —, así que ya viene incluido.)
 *
 * 3) ¿Cuántas entradas trae `fiveYearProjection` y cuál es el índice correcto?
 *    Trae 6, no 5: el loop es `for (i = 0; i <= horizonYears; i++)` con
 *    `horizonYears = 5` por defecto. El índice 0 es el que lleva `isBase: true`.
 *
 *    CORRECCIÓN (post-deploy, confirmado por Matias): el índice 0 SÍ hay que
 *    descartarlo. `AnalysisPanel.tsx:1078` (`buildProjRows`, la misma función
 *    que replica esta) etiqueta ese índice literalmente como `"Base"`, y recién
 *    el índice 1 es `"Año 1"` — son filas DISTINTAS en el panel que ve el
 *    usuario, no dos nombres del mismo año. La versión anterior de este
 *    comentario asumía que índice 0 = "año de apertura" = Año 1 de leaseflow;
 *    esa lectura no está respaldada por el propio label del panel y quedó
 *    descartada.
 *    ⇒ Años 1..5 del Business Case = índices 1..5 de `rows` (que trae 6
 *      elementos, 0..5, gracias a que `horizon` sale de `fiveYearProjection`).
 *
 * `ventaMes` va en MILLONES de CLP por mes, que es la unidad de `ventaMes` en
 * leaseflow-pro. `estimatedUf` va en UF/mes EN RÉGIMEN (sin rampa) para
 * contexto, ya con `adjustPct` aplicado para que reconcilie con `ventaMes`.
 */

import { getAdminClient } from "../_shared/gemini-keys.ts";
import { corsHeaders, json, requireApiKey } from "../_shared/export-auth.ts";
import {
  DEFAULT_GROWTH_RATE,
  fetchMaturationCurve,
  type MaturationCurve,
} from "./maturation.ts";

const NO_PROJECTION_MSG =
  "Esta isócrona no tiene una proyección calculada. Ábrela en Geochile Compass y generá la proyección primero.";

/** Años de vida del local que espera el Business Case de leaseflow. */
const YEARS_WANTED = 5;

// ── Shape parcial de ProjectionResult (solo lo que se consume acá) ────────────

interface YearProjection {
  year: number;
  uf: number;
  clp: number;
  isBase: boolean;
  isCurrent: boolean;
}

interface ProjectionResultLike {
  estimatedUf?: number;
  estimatedClp?: number;
  fiveYearProjection?: YearProjection[];
  comparables?: Array<{
    name?: string;
    distanceScore?: number;
    weight?: number;
  }>;
  folderName?: string;
  baseYear?: number;
  growthRate?: number;
  diagnosticMsg?: string | null;
}

interface ProjectionSettingsLike {
  adjustPct?: number;
  rateOverrides?: (number | null)[];
  rampEnabled?: boolean;
  isExpress?: boolean;
  result?: ProjectionResultLike | null;
  computedAt?: string | null;
}

// ── Réplica de buildProjRows (AnalysisPanel.tsx:1048) ────────────────────────

/**
 * Filas de la proyección, en la MISMA escala que el panel: índice 0 = año de
 * apertura (con rampa), índice i = año i+1 de vida del local.
 *
 * Mantener idéntico a `buildProjRows` en AnalysisPanel.tsx. Si divergen, el
 * Business Case de leaseflow diría algo distinto del informe de Geochile.
 */
const buildProjRows = (
  result: ProjectionResultLike,
  curve: MaturationCurve | null,
  overrides: (number | null)[],
  ramp: boolean,
): Array<{ uf: number; clp: number; ratePct: number }> => {
  const estimatedUf = Number(result.estimatedUf ?? 0);
  const estimatedClp = Number(result.estimatedClp ?? 0);
  const growthRate = Number.isFinite(Number(result.growthRate))
    ? Number(result.growthRate)
    : DEFAULT_GROWTH_RATE;

  const ufToClp = estimatedUf > 0 ? estimatedClp / estimatedUf : 0;
  const horizon = Math.max(0, (result.fiveYearProjection?.length ?? 0) - 1);
  const factors = curve?.rampFactors ?? [];
  const startFactor = ramp && factors.length > 0 ? factors[0] : 1;

  const rows: Array<{ uf: number; clp: number; ratePct: number }> = [];
  for (let i = 0; i <= horizon; i++) {
    const fallbackRate = i <= 0
      ? 0
      : Math.round((curve?.rates[i - 1] ?? growthRate) * 1000) / 10;
    const ratePct = overrides[i] ?? fallbackRate;
    const uf = i === 0
      ? estimatedUf * startFactor
      : rows[i - 1].uf * (1 + ratePct / 100);
    rows.push({ uf, clp: uf * ufToClp, ratePct });
  }
  return rows;
};

/**
 * Carpeta de POIs sobre la que se corrió la proyección.
 *
 * `projection_settings` NO guarda su id — solo `result.folderName`, que sale de
 * `poi_folders.name` (salesProjectionService.ts, paso 1). Y `folder_id` de
 * `saved_isochrones` NO sirve: apunta a `isochrone_folders`, otra tabla.
 * Así que se resuelve por nombre, normalizado (`lower(btrim())`) según
 * SQL_MIGRATION_GUARDRAILS.md §1: comparar literales exactos se rompe en
 * silencio con diferencias de caja o espacios.
 */
const resolvePoiFolderId = async (
  admin: ReturnType<typeof getAdminClient>,
  folderName: string | undefined,
): Promise<string | null> => {
  if (!admin) return null;
  const { data } = await admin
    .from("poi_folders")
    .select("id, name, parent_id");
  const rows = (data ?? []) as Array<{ id: string; name: string; parent_id: string | null }>;
  if (rows.length === 0) return null;

  const norm = (s: string) => s.trim().toLowerCase();
  const target = folderName ? norm(folderName) : "";
  const exact = rows.find((f) => norm(f.name) === target);
  if (exact) return exact.id;

  // Sin match, la referencia del panel: carpetas raíz, Autoplanet primero
  // (defaultCommercialFolder en commercialSettingsService.ts). Es una
  // aproximación, y se avisa en `maturationSource` de la respuesta.
  const roots = rows.filter((f) => !f.parent_id);
  return (
    roots.find((f) => norm(f.name) === "autoplanet")?.id ?? roots[0]?.id ?? null
  );
};

/**
 * Estadísticos de la RED (no de los comparables) para el año base.
 *
 * Por qué la red y no los comparables: se verificó con validación
 * leave-one-out sobre los 64 locales con venta real que el modelo de
 * comparables explica 2,5% de la varianza y que predecir la MEDIANA de la red
 * le gana a cualquier combinación de features disponibles (MAE 432 vs 515 UF).
 * Así que la mediana de la red es el mejor estimador puntual que tenemos, y el
 * p25 es el escenario conservador que un business case con arriendo
 * comprometido necesita mirar.
 *
 * Devuelve null si no hay suficientes locales con venta para que los
 * percentiles signifiquen algo.
 */
const networkStats = async (
  admin: ReturnType<typeof getAdminClient>,
  folderId: string | null,
  ufToClp: number,
): Promise<{ medianUf: number; p25Uf: number; n: number } | null> => {
  if (!admin || !folderId || ufToClp <= 0) return null;

  const { data: pois } = await admin
    .from("pois")
    .select("id")
    .eq("folder_id", folderId)
    .is("deleted_at", null);
  const ids = ((pois ?? []) as Array<{ id: string }>).map((p) => p.id);
  if (ids.length === 0) return null;

  // Últimos 12 meses de cada local → venta mensual promedio, en UF.
  const porLocal = new Map<string, number[]>();
  for (let i = 0; i < ids.length; i += 40) {
    const { data } = await admin
      .from("poi_metrics")
      .select("poi_id, period, value")
      .eq("metric_key", "ventas")
      .in("poi_id", ids.slice(i, i + 40))
      .order("period", { ascending: false });
    for (const r of (data ?? []) as Array<{ poi_id: string; value: number }>) {
      const arr = porLocal.get(r.poi_id) ?? [];
      if (arr.length < 12) arr.push(Number(r.value));
      porLocal.set(r.poi_id, arr);
    }
  }

  const ufs: number[] = [];
  for (const [, vals] of porLocal) {
    if (vals.length < 12) continue; // sin año completo no entra al percentil
    const promedioClp = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (promedioClp > 0) ufs.push(promedioClp / ufToClp);
  }
  if (ufs.length < 10) return null;

  ufs.sort((a, b) => a - b);
  const q = (p: number) => ufs[Math.min(ufs.length - 1, Math.floor(ufs.length * p))];
  return {
    medianUf: Math.round(q(0.5) * 10) / 10,
    p25Uf: Math.round(q(0.25) * 10) / 10,
    n: ufs.length,
  };
};

/** Población mínima y máxima de los locales que sostienen el modelo. */
const comparablePopulationRange = async (
  admin: ReturnType<typeof getAdminClient>,
): Promise<{ minPop: number; maxPop: number; n: number } | null> => {
  if (!admin) return null;
  const { data } = await admin.from("poi_features_cache").select("features");
  const pops = ((data ?? []) as Array<{ features: Record<string, number> | null }>)
    .map((r) => Number(r.features?.pop_total ?? 0))
    .filter((n) => n > 0);
  if (pops.length < 10) return null;
  return { minPop: Math.min(...pops), maxPop: Math.max(...pops), n: pops.length };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const denied = await requireApiKey(req);
  if (denied) return denied;

  let savedIsochroneId: string | undefined;
  try {
    const body = await req.json();
    savedIsochroneId = typeof body?.savedIsochroneId === "string"
      ? body.savedIsochroneId.trim()
      : undefined;
  } catch {
    return json({ error: "body inválido: se espera JSON" }, 400);
  }
  if (!savedIsochroneId) {
    return json({ error: "savedIsochroneId es requerido" }, 400);
  }

  const admin = getAdminClient();
  if (!admin) {
    return json({ error: "service role no configurado" }, 500);
  }

  // Admin client: `saved_isochrones` tiene RLS por user_id y el caller no es un
  // usuario autenticado de este proyecto (ver _shared/export-auth.ts).
  const { data: iso, error } = await admin
    .from("saved_isochrones")
    .select("id, name, folder_id, projection_settings, deleted_at")
    .eq("id", savedIsochroneId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[export-sales-projection] consulta falló", error);
    return json({ error: "error consultando la isócrona" }, 500);
  }
  if (!iso) {
    return json({ error: NO_PROJECTION_MSG }, 422);
  }

  const settings = (iso.projection_settings ?? null) as ProjectionSettingsLike | null;
  const result = settings?.result ?? null;
  // Un `computedAt` sin `result` no alcanza: sin el ProjectionResult no hay
  // nada que proyectar y el error correcto es el mismo.
  if (!settings?.computedAt || !result) {
    return json({ error: NO_PROJECTION_MSG }, 422);
  }

  const rampEnabled = settings.rampEnabled ?? true;
  const adjustPct = Number(settings.adjustPct ?? 0) || 0;
  const overrides = Array.isArray(settings.rateOverrides) ? settings.rateOverrides : [];

  const poiFolderId = await resolvePoiFolderId(admin, result.folderName);
  const curve = rampEnabled && poiFolderId
    ? await fetchMaturationCurve(admin, poiFolderId)
    : null;

  const rows = buildProjRows(result, curve, overrides, rampEnabled);
  const f = 1 + adjustPct / 100;

  // rows[0] es "Base" (ver nota 3 arriba) — se descarta. Años 1..5 del
  // Business Case = rows[1..5].
  // Si la proyección guardada tiene un horizonte más corto, se rellena
  // manteniendo la última tasa conocida en vez de cortar el array: leaseflow
  // espera 5 posiciones y un array corto rompería el Business Case.
  const ventaMes: number[] = [];
  for (let i = 0; i < YEARS_WANTED; i++) {
    const row = rows[i + 1];
    if (row) {
      ventaMes.push(row.clp * f);
      continue;
    }
    const prev = ventaMes[i - 1] ?? 0;
    const lastRate = rows.length > 0 ? rows[rows.length - 1].ratePct : adjustPct * 0;
    ventaMes.push(prev * (1 + lastRate / 100));
  }

  const nombreCarpeta = result.folderName ?? null;

  // Referencia de la red + señal de extrapolación. Aditivo: el contrato previo
  // (estimatedUf, ventaMes, etc.) no cambia.
  const red = await networkStats(admin, poiFolderId, ufToClp);

  /**
   * Rango de población en que el modelo tiene sustento.
   *
   * NO se puede decidir acá si la ubicación nueva está fuera de rango: la
   * isócrona guardada no almacena su población. Lo que sí se puede entregar es
   * el rango de los locales que sostienen el modelo, para que el informe
   * verifique la aplicabilidad antes de usar la cifra. Importa porque fuera de
   * ese rango el número no describe el caso: la red son locales urbanos
   * maduros, y extrapolar a una ubicación mucho más chica lo infla (el caso
   * Pitrufquén: ~25 mil habitantes contra un mínimo de ~41.500 en la red).
   */
  const rangoPoblacion = await comparablePopulationRange(admin);

  return json({
    locationName: iso.name,
    // Millones de CLP por mes, 3 decimales = precisión de ~mil pesos.
    ventaMes: ventaMes.map((clp) => Math.round((clp / 1_000_000) * 1000) / 1000),
    estimatedUf: Math.round(Number(result.estimatedUf ?? 0) * f * 10) / 10,
    baseYear: Number(result.baseYear ?? 0),
    growthRate: Number.isFinite(Number(result.growthRate))
      ? Number(result.growthRate)
      : DEFAULT_GROWTH_RATE,
    comparables: (result.comparables ?? []).map((c) => ({
      name: c.name ?? "",
      distanceScore: Number(c.distanceScore ?? 0),
      weight: Number(c.weight ?? 0),
    })),
    diagnosticMsg: result.diagnosticMsg ?? null,

    /**
     * ── Referencia estadística de la red ──────────────────────────────────
     * Para que el Business Case se pueda armar con un escenario central y uno
     * conservador, en vez de un solo número.
     *
     * `networkMedianUf` es la MEDIANA de la red, no el estimado del modelo de
     * comparables. Se verificó con validación leave-one-out sobre los 64
     * locales con venta real que el modelo explica 2,5% de la varianza y que la
     * mediana le gana (MAE 432 vs 515 UF): o sea que el mejor estimador
     * disponible hoy es "un local promedio de la red".
     *
     * `networkP25Uf` es el escenario conservador. Importa porque el riesgo es
     * asimétrico: el arriendo es un costo fijo por años y con la mediana hay
     * ~50% de probabilidad de vender menos.
     */
    networkReference: red
      ? {
          medianUf: red.medianUf,
          p25Uf: red.p25Uf,
          medianClp: Math.round(red.medianUf * ufToClp),
          p25Clp: Math.round(red.p25Uf * ufToClp),
          nStores: red.n,
          basis: "últimos 12 meses de cada local con año completo",
        }
      : null,

    /**
     * Rango de población en que el modelo tiene sustento. Quien arme el
     * Business Case DEBE comparar la población de la ubicación contra esto: si
     * queda fuera, la cifra no aplica (ver `modelCaveat`).
     */
    applicabilityRange: rangoPoblacion
      ? { minPopulation: rangoPoblacion.minPop, maxPopulation: rangoPoblacion.maxPop, nStores: rangoPoblacion.n }
      : null,

    /**
     * Advertencia obligatoria de interpretación. Se envía como texto para que
     * el consumidor no tenga que conocer el detalle estadístico y para que no
     * se pierda si alguien mira solo la cifra.
     */
    modelCaveat:
      "El modelo de comparables no tiene poder predictivo demostrado (explica 2,5% de la " +
      "varianza; validación leave-one-out sobre 64 locales). En la práctica devuelve un valor " +
      "cercano a la mediana de la red para cualquier ubicación. Úsese networkMedianUf como " +
      "escenario central y networkP25Uf como conservador, y verifíquese que la población de la " +
      "ubicación caiga dentro de applicabilityRange: fuera de ese rango la cifra no aplica.",

    // ── Trazabilidad: para que leaseflow pueda mostrar de dónde sale la cifra
    //    y reconstruirla si hace falta. Aditivo, no rompe el contrato mínimo.
    meta: {
      savedIsochroneId: iso.id,
      computedAt: settings.computedAt,
      folderName: nombreCarpeta,
      /** Sin años calendario: son años de vida del local desde la apertura. */
      yearsMeaning: "años 1..5 de vida del local (\"Base\", el año 0, queda excluido)",
      adjustPct,
      isExpress: settings.isExpress ?? false,
      rampEnabled,
      rampApplied: !!curve,
      rampFactors: curve?.rampFactors ?? null,
      maturationSource: !curve
        ? (rampEnabled ? "sin carpeta de comparables resuelta" : "rampa desactivada (traslado)")
        : curve.isCustom
        ? "curva fijada por el admin"
        : curve.isFallback
        ? "curva de respaldo (sin aperturas observadas)"
        : `derivada de ${curve.sampleSize} locales con apertura observada`,
      rateOverrides: overrides,
    },
  });
});
