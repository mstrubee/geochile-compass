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
import type { GseFeatureCollection } from "@/types/gse";
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
import type { GastoEndogenoResult } from "@/utils/gastoEndogeno";
import type { ParqueIsochroneStats } from "@/hooks/useParqueIsochroneStats";

const NSE_LABELS = ["ABC1", "C2", "C3", "D", "E"] as const;
const NSE_NUM_TO_LABEL: Record<NSE, (typeof NSE_LABELS)[number]> = {
  5: "ABC1",
  4: "C2",
  3: "C3",
  2: "D",
  1: "E",
};

export interface NseShare {
  label: (typeof NSE_LABELS)[number];
  pct: number; // 0-100
}

export interface IsochroneBandReport {
  bandSeconds: number;
  bandMinutes: number;
  area_km2: number;
  totals: IsochroneAnalysis["totals"];
  communes: CommuneBreakdownRow[];
  nseDistribution: NseShare[];
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
}

const computeNseDistribution = (analysis: IsochroneAnalysis): NseShare[] => {
  // Si hay manzanas con NSE, usamos esa distribución (ponderada por población).
  if (
    analysis.manzanas &&
    Object.keys(analysis.manzanas.nseDistribution).length > 0
  ) {
    const dist = analysis.manzanas.nseDistribution;
    const total = Object.values(dist).reduce((s, v) => s + (v ?? 0), 0);
    if (total <= 0) return [];
    return NSE_LABELS.map((label) => {
      const numKey = (Object.entries(NSE_NUM_TO_LABEL) as Array<[string, string]>)
        .find(([, v]) => v === label)?.[0];
      const v = numKey ? dist[Number(numKey) as NSE] ?? 0 : 0;
      return { label, pct: Math.round((v / total) * 100) };
    });
  }
  // Fallback: distribución comunal ponderada por hogares dentro de la iso.
  const counts: Record<string, number> = {};
  let total = 0;
  for (const c of analysis.communes) {
    if (!c.nse) continue;
    counts[c.nse] = (counts[c.nse] ?? 0) + c.hhInIso;
    total += c.hhInIso;
  }
  if (total <= 0) return [];
  return NSE_LABELS.map((label) => ({
    label,
    pct: Math.round(((counts[label] ?? 0) / total) * 100),
  }));
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
  territorialFeatures: TerritorialFeature[];
  territorialLayers: TerritorialLayer[];
  territorialGroups: TerritorialGroup[];
  comunasFC: ComunaFC | null;
  ineByName: Map<string, IneCommuneStats>;
  nombresPorCodigo: Record<string, string>;
  manzanas: ManzanaFeatureCollection | null;
  gse?: GseFeatureCollection | null;
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
    territorialFeatures,
    territorialLayers,
    territorialGroups,
    comunasFC,
    ineByName,
    nombresPorCodigo,
    manzanas,
    gse = null,
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

    return {
      bandSeconds,
      bandMinutes: Math.round(bandSeconds / 60),
      area_km2: analysis.area_km2,
      totals: analysis.totals,
      communes: analysis.communes,
      nseDistribution: computeNseDistribution(analysis),
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
  };
};
