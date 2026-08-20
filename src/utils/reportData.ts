import type { Feature, MultiPolygon, Polygon } from "geojson";
import bbox from "@turf/bbox";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import type { Isochrone, IsoMode } from "@/types/isochrones";
import { ISO_MODE_LABEL } from "@/types/isochrones";
import type { TerritorialFeature, TerritorialGroup, TerritorialLayer } from "@/types/territorial";
import type { ManzanaFeatureCollection } from "@/types/manzanas";
import type { ComunaFC } from "@/hooks/useComunasGeoIndex";
import type { IneCommuneStats } from "@/utils/ineScales";
import type { GseClass, GseFeatureCollection } from "@/types/gse";
import { GSE_ORDER } from "@/utils/gseScales";
import {
  computeIsochroneAnalysis,
  listTerritorialPointsInIso,
  pickBandFeature,
  type CommuneBreakdownRow,
  type ComparisonRow,
  type DensityBreakdown,
  type GseBreakdown,
  type IsochroneAnalysis,
  type PointsByGroup,
  type TerritorialPointDetail,
} from "@/utils/isochroneAnalysis";
import type { CommerceCategory, CommerceItem } from "@/services/commerceService";
import type { NSE } from "@/data/communes";
import { calcGastoEndogeno, type GastoEndogenoResult } from "@/utils/gastoEndogeno";
import type { ParqueIsochroneStats } from "@/hooks/useParqueIsochroneStats";

const NSE_NUM_TO_LABEL: Record<NSE, GseClass> = {
  5: "ABC1",
  4: "C2",
  3: "C3",
  2: "D",
  1: "E",
};

export interface NseShare {
  label: GseClass;
  pct: number; // 0-100
}

/**
 * Origen de la distribución socioeconómica, de mayor a menor precisión:
 *  - "gse":      manzanas GSE (Censo 2024), ponderado por hogares reales.
 *                Es la misma fuente que pinta la capa "GSE por manzana".
 *  - "manzanas": manzanas INE (Censo 2017), ponderado por población.
 *  - "comuna":   promedio NSE de las comunas cubiertas. Solo estimación:
 *                asigna una única clase a toda la comuna, por lo que puede
 *                ocultar por completo la heterogeneidad interna del área.
 */
export type NseSource = "gse" | "manzanas" | "comuna";

export interface IsochroneBandReport {
  bandSeconds: number;
  bandMinutes: number;
  area_km2: number;
  totals: IsochroneAnalysis["totals"];
  communes: CommuneBreakdownRow[];
  nseDistribution: NseShare[];
  nseSource: NseSource;
  density: DensityBreakdown;
  gse: GseBreakdown | null;
  comparisons: ComparisonRow[];
  pointsByGroup: PointsByGroup[];
  pointsTotal: number;
  pointsDetail: TerritorialPointDetail[];
  commerceItemsInBand: CommerceItem[];
  commerceCountsByCategory: Array<{ id: string; label: string; count: number }>;
}

export interface IsochroneReport {
  iso: {
    id: string;
    name: string | null;
    mode: IsoMode;
    modeLabel: string;
    minutes: number[];
    centerLat: number;
    centerLng: number;
    color: string;
    createdAt: number;
  };
  generatedAt: number;
  bands: IsochroneBandReport[];
  /** Bbox del polígono de mayor banda (para llamadas Overpass con padding). */
  outerBbox: { south: number; west: number; north: number; east: number };
  categoriesQueried: CommerceCategory[];
  commerceErrors: Record<string, string>;
  /** Gasto potencial mensual endógeno por GSE (opcional, calculado en AnalysisPanel). */
  gastoEndogeno?: GastoEndogenoResult | null;
  /** Estadísticas del parque automotor en la isócrona (opcional). */
  parqueStats?: ParqueIsochroneStats | null;
  /** Proyección de venta tal como quedó en pantalla, con sus ajustes. */
  projection?: ReportProjection | null;
}

/**
 * Proyección de venta para el informe. Refleja lo que el usuario tiene en
 * pantalla —incluidos el ajuste manual y las tasas por año que haya tocado—,
 * no un recálculo: el PDF debe decir lo mismo que la sección.
 */
export interface ReportProjection {
  folderName: string;
  baseYear: number;
  estimatedUf: number;
  estimatedClp: number;
  lowUf: number;
  highUf: number;
  /** Total aplicado = expressAppliedPct + exogenoPct. Es lo que ya está descontado de estimatedUf/estimatedClp. */
  adjustPct: number;
  /** El ajuste corresponde al formato Express, no a un criterio puntual. */
  isExpress: boolean;
  /** Castigo fijo de formato Express efectivamente aplicado (0 si isExpress es false). */
  expressAppliedPct: number;
  /** Ajuste manual por gasto exógeno u otro criterio del analista — independiente de Express, se suman. */
  exogenoPct: number;
  usesMaturationCurve: boolean;
  /** true si la curva la fijó el admin en vez de derivarse. */
  maturationIsCustom: boolean;
  maturationSampleSize: number;
  /** true si la curva parte en rampa (ubicación nueva) en vez de en régimen. */
  rampEnabled: boolean;
  /** Potencial en régimen, del que la rampa es una fracción. */
  steadyStateUf: number;
  nWithSales: number;
  nWithPredicted: number;
  usedPredictions: boolean;
  diagnosticMsg: string | null;
  /**
   * Canibalización con locales propios de la red. `null` si no se pudo medir.
   * Los porcentajes van 0..100; `lostClp` en CLP/mes (el informe lo muestra en MM$).
   */
  cannibalization: {
    popPct: number;
    areaPct: number;
    vehiculosPct: number;
    overlapPop: number;
    overlapAreaKm2: number;
    overlapVehiculos: number;
    lostUf: number;
    lostClp: number;
    overlapCount: number;
    overlaps: Array<{ name: string; areaKm2: number }>;
    incomplete: boolean;
  } | null;
  /** Relativos a la apertura: 'Base', 'Año 1', … No hay año calendario porque no se sabe cuándo abre. */
  years: Array<{ label: string; uf: number; clp: number; ratePct: number; maturityPct: number; isBase: boolean }>;
  comparables: Array<{ name: string; ufPerMonth: number; isActual: boolean; weight: number }>;
}

/**
 * Texto declarativo del ajuste aplicado a una proyección, para mostrar junto
 * a la cifra en el panel y en los informes exportados.
 *
 * Express y Exógeno son independientes y se SUMAN, no se componen: por eso
 * "-30% Express + -10% Exógeno" se lee directo como -40% total sin que el
 * analista tenga que calcular nada. Con uno solo activo se omite el paréntesis.
 */
export function formatAdjustmentLabel(
  isExpress: boolean,
  expressAppliedPct: number,
  exogenoPct: number,
): string | null {
  const parts: string[] = [];
  if (isExpress) parts.push(`${expressAppliedPct > 0 ? "+" : ""}${expressAppliedPct}% Express`);
  if (exogenoPct !== 0) parts.push(`${exogenoPct > 0 ? "+" : ""}${exogenoPct}% Exógeno`);
  if (parts.length === 0) return null;
  return parts.length === 2 ? `(${parts.join(" + ")})` : parts[0];
}

const computeNseDistribution = (
  analysis: IsochroneAnalysis,
): { shares: NseShare[]; source: NseSource } => {
  // 1. Manzanas GSE (Censo 2024), ponderadas por hogares reales. Es la misma
  //    fuente que pinta la capa "GSE por manzana", así que el informe y el
  //    mapa cuentan lo mismo. Incluye C1, que las otras fuentes no distinguen.
  const gseDist = analysis.gse?.classDistribution;
  if (gseDist && Object.keys(gseDist).length > 0) {
    const shares = GSE_ORDER.map((label) => ({
      label,
      pct: Math.round(gseDist[label] ?? 0),
    })).filter((s) => s.pct > 0);
    if (shares.length > 0) return { shares, source: "gse" };
  }

  // 2. Manzanas INE (Censo 2017), ponderadas por población.
  if (
    analysis.manzanas &&
    Object.keys(analysis.manzanas.nseDistribution).length > 0
  ) {
    const dist = analysis.manzanas.nseDistribution;
    const total = Object.values(dist).reduce((s, v) => s + (v ?? 0), 0);
    if (total > 0) {
      const shares = (Object.entries(NSE_NUM_TO_LABEL) as Array<[string, GseClass]>)
        .map(([numKey, label]) => ({
          label,
          pct: Math.round(((dist[Number(numKey) as NSE] ?? 0) / total) * 100),
        }))
        .sort((a, b) => GSE_ORDER.indexOf(a.label) - GSE_ORDER.indexOf(b.label));
      return { shares, source: "manzanas" };
    }
  }

  // 3. Último recurso: NSE comunal ponderado por hogares dentro de la iso.
  //    Asigna una sola clase por comuna, así que aplana la realidad del área.
  const counts: Record<string, number> = {};
  let total = 0;
  for (const c of analysis.communes) {
    if (!c.nse) continue;
    counts[c.nse] = (counts[c.nse] ?? 0) + c.hhInIso;
    total += c.hhInIso;
  }
  if (total <= 0) return { shares: [], source: "comuna" };
  return {
    shares: GSE_ORDER.map((label) => ({
      label,
      pct: Math.round(((counts[label] ?? 0) / total) * 100),
    })).filter((s) => s.pct > 0),
    source: "comuna",
  };
};

const filterCommerceByPolygon = (
  items: CommerceItem[],
  poly: Feature<Polygon | MultiPolygon>,
): CommerceItem[] => {
  return items.filter((it) => {
    try {
      return booleanPointInPolygon(point([it.lng, it.lat]), poly as never);
    } catch {
      return false;
    }
  });
};

interface BuildReportParams {
  iso: Isochrone;
  isoName?: string | null;
  territorialFeatures: TerritorialFeature[];
  territorialLayers: TerritorialLayer[];
  territorialGroups: TerritorialGroup[];
  comunasFC: ComunaFC | null;
  ineByName: Map<string, IneCommuneStats>;
  nombresPorCodigo: Record<string, string>;
  manzanas: ManzanaFeatureCollection | null;
  gse?: GseFeatureCollection | null;
  parqueStats?: ParqueIsochroneStats | null;
  /** Mapa categoryId -> items (todos los items en bbox externo, sin filtrar por banda). */
  commerceByCategory: Record<string, CommerceItem[]>;
  categoriesQueried: CommerceCategory[];
  commerceErrors: Record<string, string>;
}

/**
 * Construye el payload completo del informe a partir de la isócrona y el contexto.
 * No dispara llamadas de red — todas las dependencias deben venir resueltas.
 */
export const buildIsochroneReport = (params: BuildReportParams): IsochroneReport => {
  const {
    iso,
    isoName = null,
    territorialFeatures,
    territorialLayers,
    territorialGroups,
    comunasFC,
    ineByName,
    nombresPorCodigo,
    manzanas,
    gse = null,
    parqueStats = null,
    commerceByCategory,
    categoriesQueried,
    commerceErrors,
  } = params;

  // bbox del polígono de mayor banda.
  const largest = pickBandFeature(iso.features);
  const [west, south, east, north] = largest
    ? (bbox(largest as never) as [number, number, number, number])
    : [iso.center.lng - 0.05, iso.center.lat - 0.05, iso.center.lng + 0.05, iso.center.lat + 0.05];

  // Recorremos las bandas de menor a mayor minutos para que la salida sea legible.
  const ordered = [...iso.features].sort(
    (a, b) => (a.properties?.value ?? 0) - (b.properties?.value ?? 0),
  );

  // El análisis de la banda mayor alimenta la página económica del informe,
  // que se rotula con esa misma banda.
  let largestBandAnalysis: IsochroneAnalysis | null = null;

  const bands: IsochroneBandReport[] = ordered.map((feat) => {
    const bandSeconds = feat.properties?.value ?? 0;
    const analysis = computeIsochroneAnalysis({
      isoId: iso.id,
      isoFeature: feat,
      territorialFeatures,
      territorialLayers,
      territorialGroups,
      comunasFC,
      ineByName,
      nombresPorCodigo,
      manzanas,
      gse,
    });

    const detail = listTerritorialPointsInIso(
      feat as Feature<Polygon | MultiPolygon>,
      territorialFeatures,
      territorialLayers,
      territorialGroups,
    );

    const commerceInBand: CommerceItem[] = [];
    const countsByCategory: Array<{ id: string; label: string; count: number }> = [];
    for (const cat of categoriesQueried) {
      const items = commerceByCategory[cat.id] ?? [];
      const inside = filterCommerceByPolygon(items, feat as Feature<Polygon | MultiPolygon>);
      commerceInBand.push(...inside);
      countsByCategory.push({ id: cat.id, label: cat.label, count: inside.length });
    }

    const nse = computeNseDistribution(analysis);
    largestBandAnalysis = analysis; // `ordered` va de menor a mayor: gana la última

    return {
      bandSeconds,
      bandMinutes: Math.round(bandSeconds / 60),
      area_km2: analysis.area_km2,
      totals: analysis.totals,
      communes: analysis.communes,
      nseDistribution: nse.shares,
      nseSource: nse.source,
      density: analysis.density,
      gse: analysis.gse,
      comparisons: analysis.comparisons,
      pointsByGroup: analysis.territorialPoints.groups,
      pointsTotal: analysis.territorialPoints.total,
      pointsDetail: detail,
      commerceItemsInBand: commerceInBand,
      commerceCountsByCategory: countsByCategory,
    };
  });

  return {
    iso: {
      id: iso.id,
      name: isoName,
      mode: iso.mode,
      modeLabel: ISO_MODE_LABEL[iso.mode],
      minutes: iso.minutes,
      centerLat: iso.center.lat,
      centerLng: iso.center.lng,
      color: iso.color,
      createdAt: iso.createdAt,
    },
    generatedAt: Date.now(),
    bands,
    outerBbox: { south, west, north, east },
    categoriesQueried,
    commerceErrors,
    // Se calculan acá para que cualquier camino de exportación produzca el
    // mismo informe: antes solo el botón del panel de análisis los adjuntaba,
    // así que el PDF del diálogo salía sin la página económica.
    gastoEndogeno: largestBandAnalysis ? calcGastoEndogeno(largestBandAnalysis) : null,
    parqueStats: parqueStats ?? null,
  };
};
