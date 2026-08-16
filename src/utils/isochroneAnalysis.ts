import type { Feature, Polygon, MultiPolygon } from "geojson";
import { area as turfArea } from "@turf/area";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import booleanIntersects from "@turf/boolean-intersects";
import intersect from "@turf/intersect";
import { point, featureCollection } from "@turf/helpers";
import type { TerritorialFeature, TerritorialLayer, TerritorialGroup } from "@/types/territorial";
import type { ManzanaFeatureCollection, ManzanaFeature } from "@/types/manzanas";
import type { ComunaFeature, ComunaFC } from "@/hooks/useComunasGeoIndex";
import type { IneCommuneStats } from "@/utils/ineScales";
import type { NSE } from "@/data/communes";
import { normalizeCommuneName } from "@/services/communeDataService";
import type { GseFeatureCollection, GseClass } from "@/types/gse";
import { RM_AVERAGES } from "@/data/rmAverages";

export type NseLabel = "ABC1" | "C2" | "C3" | "D" | "E";

export interface GseBreakdown {
  manzanaCount: number;
  classDistribution: Partial<Record<GseClass, number>>; // % ponderado por HOGARES (n_hog × share), no por área
  quintilDistribution: Partial<Record<"Q1" | "Q2" | "Q3" | "Q4" | "Q5", number>>;
  nseScoreAvg: number | null; // 0-1000
  educYearsAvg: number | null;
  hacinAvg: number | null;
  autoScoreAvg: number | null;
  // Población real desde n_per / n_hog (Censo 2024) — disponible para 334 comunas
  pop: number;  // personas dentro de la isócrona
  hh:  number;  // hogares dentro de la isócrona
}

export interface DensityBreakdown {
  popPerKm2: number;
  hhPerKm2: number;
  pointsPerKm2: number;
  pointsPerKm2ByGroup: { groupId: string; groupName: string; color: string | null; perKm2: number }[];
  serviceCoverageIndex: number; // 0-100
}

export interface ComparisonRow {
  key: string;
  label: string;
  value: number;
  vsRmPct: number | null; // delta % vs RM (positive = above RM)
  format: "int" | "clp" | "pct" | "decimal";
}

export interface PointsByLayer {
  layerId: string;
  layerName: string;
  color: string | null;
  count: number;
}
export interface PointsByGroup {
  groupId: string;
  groupName: string;
  color: string | null;
  count: number;
  layers: PointsByLayer[];
}
export interface TerritorialPointsBreakdown {
  total: number;
  groups: PointsByGroup[];
}

export interface CommuneBreakdownRow {
  name: string;
  areaShareInIso: number; // 0..1 fraction of iso area in this commune
  areaShareOfCommune: number; // 0..1 fraction of commune covered by iso
  poblacion: number | null;
  hogares: number | null;
  ingreso: number | null;
  nse: NseLabel | null;
  popInIso: number;
  hhInIso: number;
  incomeInIso: number; // CLP totales
}

export interface ManzanaBreakdown {
  manzanaCount: number;
  pop: number;
  hh: number;
  nseDistribution: Partial<Record<NSE, number>>; // weighted by pop
}

export interface IsochroneAnalysis {
  isoId: string;
  bandMinutes: number; // minutos de la banda analizada
  area_km2: number;
  territorialPoints: TerritorialPointsBreakdown;
  communes: CommuneBreakdownRow[];
  manzanas: ManzanaBreakdown | null;
  gse: GseBreakdown | null;
  density: DensityBreakdown;
  comparisons: ComparisonRow[];
  totals: {
    pop: number;
    hh: number;
    incomeTotal: number; // CLP
    incomeAvgPerHh: number; // CLP por hogar
    source: "manzanas" | "comuna";
  };
}

const HH_SIZE_FALLBACK = 3.1; // tamaño medio de hogar (CL ≈ 3.1)

const polygonToFeature = (
  geom: Polygon | MultiPolygon,
): Feature<Polygon | MultiPolygon> => ({
  type: "Feature",
  properties: {},
  geometry: geom,
});

/** Selecciona la banda mayor (más minutos, polígono más amplio) de una isócrona. */
export const pickBandFeature = (
  features: Feature<Polygon | MultiPolygon, { value: number }>[],
  bandSeconds?: number,
): Feature<Polygon | MultiPolygon, { value: number }> | null => {
  if (!features.length) return null;
  if (bandSeconds != null) {
    const f = features.find((x) => x.properties?.value === bandSeconds);
    if (f) return f;
  }
  // mayor banda = mayor "value" (segundos)
  return [...features].sort(
    (a, b) => (b.properties?.value ?? 0) - (a.properties?.value ?? 0),
  )[0];
};

export const countTerritorialPoints = (
  iso: Feature<Polygon | MultiPolygon>,
  features: TerritorialFeature[],
  layers: TerritorialLayer[],
  groups: TerritorialGroup[],
): TerritorialPointsBreakdown => {
  const layerMap = new Map(layers.map((l) => [l.id, l]));
  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const perLayer = new Map<string, number>();

  for (const f of features) {
    if (f.lat == null || f.lng == null) continue;
    const pt = point([f.lng, f.lat]);
    try {
      if (booleanPointInPolygon(pt, iso as never)) {
        perLayer.set(f.layer_id, (perLayer.get(f.layer_id) ?? 0) + 1);
      }
    } catch {
      // ignore
    }
  }

  const byGroup = new Map<string, PointsByGroup>();
  let total = 0;
  perLayer.forEach((count, layerId) => {
    const layer = layerMap.get(layerId);
    if (!layer) return;
    total += count;
    const group = groupMap.get(layer.group_id);
    const gid = group?.id ?? "_unknown";
    let g = byGroup.get(gid);
    if (!g) {
      g = {
        groupId: gid,
        groupName: group?.name ?? "Sin grupo",
        color: group?.color ?? null,
        count: 0,
        layers: [],
      };
      byGroup.set(gid, g);
    }
    g.count += count;
    g.layers.push({ layerId, layerName: layer.name, color: layer.color, count });
  });

  return {
    total,
    groups: Array.from(byGroup.values()).sort((a, b) => b.count - a.count),
  };
};

export interface TerritorialPointDetail {
  featureId: string;
  name: string | null;
  lat: number;
  lng: number;
  layerId: string;
  layerName: string;
  layerColor: string | null;
  groupId: string;
  groupName: string;
  groupColor: string | null;
  properties: Record<string, unknown>;
}

/**
 * Devuelve el detalle (no solo el conteo) de cada punto territorial
 * dentro del polígono de la isócrona. Usado por el informe exportable.
 */
export const listTerritorialPointsInIso = (
  iso: Feature<Polygon | MultiPolygon>,
  features: TerritorialFeature[],
  layers: TerritorialLayer[],
  groups: TerritorialGroup[],
): TerritorialPointDetail[] => {
  const layerMap = new Map(layers.map((l) => [l.id, l]));
  const groupMap = new Map(groups.map((g) => [g.id, g]));
  const out: TerritorialPointDetail[] = [];
  for (const f of features) {
    if (f.lat == null || f.lng == null) continue;
    const pt = point([f.lng, f.lat]);
    try {
      if (!booleanPointInPolygon(pt, iso as never)) continue;
    } catch {
      continue;
    }
    const layer = layerMap.get(f.layer_id);
    if (!layer) continue;
    const group = groupMap.get(layer.group_id);
    out.push({
      featureId: f.id,
      name: f.name,
      lat: f.lat,
      lng: f.lng,
      layerId: layer.id,
      layerName: layer.name,
      layerColor: layer.color,
      groupId: group?.id ?? "_unknown",
      groupName: group?.name ?? "Sin grupo",
      groupColor: group?.color ?? null,
      properties: (f.properties ?? {}) as Record<string, unknown>,
    });
  }
  return out;
};

const safeArea = (f: Feature<Polygon | MultiPolygon>): number => {
  try {
    return turfArea(f);
  } catch {
    return 0;
  }
};

const safeIntersect = (
  a: Feature<Polygon | MultiPolygon>,
  b: Feature<Polygon | MultiPolygon>,
): Feature<Polygon | MultiPolygon> | null => {
  try {
    const fc = featureCollection([a, b] as never);
    const r = intersect(fc as never);
    return (r as Feature<Polygon | MultiPolygon>) ?? null;
  } catch {
    return null;
  }
};

export const communeBreakdown = (
  iso: Feature<Polygon | MultiPolygon>,
  comunasFC: ComunaFC | null,
  ineByName: Map<string, IneCommuneStats>,
  nombresPorCodigo: Record<string, string>,
): CommuneBreakdownRow[] => {
  if (!comunasFC) return [];
  const isoArea = safeArea(iso);
  if (isoArea <= 0) return [];

  const rows: CommuneBreakdownRow[] = [];
  for (const cf of comunasFC.features as ComunaFeature[]) {
    try {
      if (!booleanIntersects(iso, cf as never)) continue;
    } catch {
      continue;
    }
    const cg = cf as Feature<Polygon | MultiPolygon, ComunaFeature["properties"]>;
    const interFeat = safeIntersect(iso, cg);
    if (!interFeat) continue;
    const interArea = safeArea(interFeat);
    if (interArea <= 0) continue;
    const comArea = safeArea(cg);
    const codigo = cg.properties.codigo_comuna ?? cg.properties.cod_comuna ?? "";
    const nombre =
      nombresPorCodigo[codigo] ?? cg.properties.nom_comuna ?? "(desconocida)";
    const stats = ineByName.get(normalizeCommuneName(nombre));
    const poblacion = stats?.poblacion ?? null;
    const ingreso = stats?.ingreso ?? null;
    const nse = (stats?.nse ?? null) as NseLabel | null;
    // hogares estimados de la comuna usando tamaño medio de hogar
    const hogares = poblacion != null ? Math.round(poblacion / HH_SIZE_FALLBACK) : null;
    const shareOfCommune = comArea > 0 ? interArea / comArea : 0;
    const popInIso = poblacion != null ? poblacion * shareOfCommune : 0;
    const hhInIso = hogares != null ? hogares * shareOfCommune : 0;
    const incomeInIso = ingreso != null ? hhInIso * ingreso : 0;
    rows.push({
      name: nombre,
      areaShareInIso: interArea / isoArea,
      areaShareOfCommune: shareOfCommune,
      poblacion,
      hogares,
      ingreso,
      nse,
      popInIso,
      hhInIso,
      incomeInIso,
    });
  }
  return rows.sort((a, b) => b.areaShareInIso - a.areaShareInIso);
};

export const manzanaBreakdown = (
  iso: Feature<Polygon | MultiPolygon>,
  manzanas: ManzanaFeatureCollection | null,
): ManzanaBreakdown | null => {
  if (!manzanas?.features?.length) return null;
  const dist: Partial<Record<NSE, number>> = {};
  let pop = 0;
  let hh = 0;
  let count = 0;
  for (const m of manzanas.features as ManzanaFeature[]) {
    try {
      if (!booleanIntersects(iso, m)) continue;
    } catch {
      continue;
    }
    const mArea = safeArea(m as never);
    let share = 1;
    if (mArea > 0) {
      const inter = safeIntersect(iso, m as never);
      const interArea = inter ? safeArea(inter) : 0;
      share = interArea > 0 ? Math.min(1, interArea / mArea) : 0;
    }
    if (share <= 0) continue;
    count += 1;
    const p = (m.properties.pop ?? 0) * share;
    const h = (m.properties.hh ?? 0) * share;
    pop += p;
    hh += h;
    const nse = m.properties.nse;
    if (nse) dist[nse] = (dist[nse] ?? 0) + p;
  }
  if (count === 0) return null;
  return {
    manzanaCount: count,
    pop: Math.round(pop),
    hh: Math.round(hh),
    nseDistribution: dist,
  };
};

const GSE_CLASSES: GseClass[] = ["ABC1", "C1", "C2", "C3", "D", "E"];
const QUINTILES = ["Q1", "Q2", "Q3", "Q4", "Q5"] as const;

export const gseBreakdown = (
  iso: Feature<Polygon | MultiPolygon>,
  gse: GseFeatureCollection | null,
): GseBreakdown | null => {
  if (!gse?.features?.length) return null;
  let totalArea = 0;
  let count = 0;
  const classArea: Partial<Record<GseClass, number>> = {};
  const classHh:   Partial<Record<GseClass, number>> = {};  // hogares reales por GSE
  const quintilArea: Partial<Record<"Q1" | "Q2" | "Q3" | "Q4" | "Q5", number>> = {};
  let nseScoreNum = 0, nseScoreDen = 0;
  let educNum = 0, educDen = 0;
  let hacinNum = 0, hacinDen = 0;
  let autoNum = 0, autoDen = 0;
  let totalPop = 0;
  let totalHh  = 0;

  for (const f of gse.features) {
    try {
      if (!booleanIntersects(iso, f as never)) continue;
    } catch {
      continue;
    }
    const inter = safeIntersect(iso, f as never);
    if (!inter) continue;
    const interArea = safeArea(inter);
    if (interArea <= 0) continue;

    const manzanaArea = safeArea(f as never);
    // share = fracción del polígono de manzana dentro de la isócrona
    const share = manzanaArea > 0 ? Math.min(1, interArea / manzanaArea) : 1;

    count += 1;
    totalArea += interArea;
    const p = f.properties;

    // ── Población real (Censo 2024) escalada por share de área ────────────
    // Los archivos GSE tienen n_per (personas) y n_hog (hogares) por manzana.
    // Se usa como proxy tipado; los campos extra llegan en el JSON pero no en el tipo.
    const nPer = (p as unknown as Record<string, unknown>)["n_per"];
    const nHog = (p as unknown as Record<string, unknown>)["n_hog"];
    const mPop = typeof nPer === "number" ? nPer * share : 0;
    const mHh  = typeof nHog === "number" ? nHog * share : 0;
    totalPop += mPop;
    totalHh  += mHh;

    // ── Distribución GSE ─────────────────────────────────────────────────────
    // classArea: siempre se acumula (fallback si no hay datos de hogares)
    // classHh:   SOLO se acumula cuando la manzana tiene hogares reales (mHh > 0).
    //
    // BUG anterior: usaba interArea como fallback cuando mHh = 0.
    // Resultado: parques, terrenos baldíos e industriales (n_hog=0)
    // inflaban artificialmente el % de su clase GSE porque sus m² eran
    // mucho mayores que los hogares de las manzanas con edificios.
    // Fix: si n_hog = 0 → no contribuye a classHh (distribución por hogares).
    if (p.gse) {
      classArea[p.gse] = (classArea[p.gse] ?? 0) + interArea;
      if (mHh > 0) {
        classHh[p.gse] = (classHh[p.gse] ?? 0) + mHh;
      }
    }
    if (p.quintil) quintilArea[p.quintil] = (quintilArea[p.quintil] ?? 0) + interArea;
    if (p.nse_score != null) { nseScoreNum += p.nse_score * interArea; nseScoreDen += interArea; }
    if (p.educ != null) { educNum += p.educ * interArea; educDen += interArea; }
    if (p.hacin != null) { hacinNum += p.hacin * interArea; hacinDen += interArea; }
    if (p.auto_score != null) { autoNum += p.auto_score * interArea; autoDen += interArea; }
  }
  if (count === 0 || totalArea <= 0) return null;

  // Distribución GSE: usar hogares reales si disponibles, si no usar área
  const totalHhGse = Object.values(classHh).reduce((s, v) => s + (v ?? 0), 0);
  const usePop = totalHhGse > 0;
  const denom  = usePop ? totalHhGse : totalArea;

  const classDistribution: Partial<Record<GseClass, number>> = {};
  for (const k of GSE_CLASSES) {
    const v = usePop ? (classHh[k] ?? 0) : (classArea[k] ?? 0);
    if (v > 0) classDistribution[k] = Math.round((v / denom) * 1000) / 10;
  }
  const quintilDistribution: Partial<Record<"Q1" | "Q2" | "Q3" | "Q4" | "Q5", number>> = {};
  for (const k of QUINTILES) {
    const a = quintilArea[k];
    if (a) quintilDistribution[k] = Math.round((a / totalArea) * 1000) / 10;
  }
  return {
    manzanaCount: count,
    classDistribution,
    quintilDistribution,
    nseScoreAvg:  nseScoreDen > 0 ? Math.round((nseScoreNum / nseScoreDen) * 10) / 10 : null,
    educYearsAvg: educDen > 0     ? Math.round((educNum / educDen) * 10) / 10         : null,
    hacinAvg:     hacinDen > 0    ? Math.round((hacinNum / hacinDen) * 100) / 100      : null,
    autoScoreAvg: autoDen > 0     ? Math.round((autoNum / autoDen) * 10) / 10          : null,
    pop: Math.round(totalPop),
    hh:  Math.round(totalHh),
  };
};

const computeDensity = (
  area_km2: number,
  pop: number,
  hh: number,
  territorialPoints: TerritorialPointsBreakdown,
): DensityBreakdown => {
  const safeArea = area_km2 > 0 ? area_km2 : 1;
  const popPerKm2 = pop / safeArea;
  const hhPerKm2 = hh / safeArea;
  const pointsPerKm2 = territorialPoints.total / safeArea;
  const pointsPerKm2ByGroup = territorialPoints.groups.map((g) => ({
    groupId: g.groupId,
    groupName: g.groupName,
    color: g.color,
    perKm2: g.count / safeArea,
  }));
  // Service coverage: normaliza puntos/km² (cap 50 ≈ 100). Heurística simple.
  const serviceCoverageIndex = Math.min(100, Math.round((pointsPerKm2 / 50) * 100));
  return {
    popPerKm2: Math.round(popPerKm2),
    hhPerKm2: Math.round(hhPerKm2),
    pointsPerKm2: Math.round(pointsPerKm2 * 100) / 100,
    pointsPerKm2ByGroup,
    serviceCoverageIndex,
  };
};

const buildComparisons = (
  totals: { pop: number; hh: number; incomeAvgPerHh: number },
  density: DensityBreakdown,
  gse: GseBreakdown | null,
): ComparisonRow[] => {
  const rm = RM_AVERAGES;
  const pct = (v: number, base: number) => (base > 0 ? Math.round(((v - base) / base) * 1000) / 10 : null);
  const rows: ComparisonRow[] = [
    { key: "popPerKm2", label: "Densidad pob.", value: density.popPerKm2, vsRmPct: pct(density.popPerKm2, rm.popPerKm2), format: "int" },
    { key: "hhPerKm2", label: "Densidad hog.", value: density.hhPerKm2, vsRmPct: pct(density.hhPerKm2, rm.hhPerKm2), format: "int" },
    { key: "income", label: "Ingreso/hogar", value: totals.incomeAvgPerHh, vsRmPct: pct(totals.incomeAvgPerHh, rm.incomeAvgPerHh), format: "clp" },
  ];
  if (gse?.educYearsAvg != null) {
    rows.push({ key: "educ", label: "Escolaridad (años)", value: gse.educYearsAvg, vsRmPct: pct(gse.educYearsAvg, rm.educYears), format: "decimal" });
  }
  if (gse?.hacinAvg != null) {
    rows.push({ key: "hacin", label: "Hacinamiento", value: gse.hacinAvg, vsRmPct: pct(gse.hacinAvg, rm.hacin), format: "decimal" });
  }
  return rows;
};

export const computeIsochroneAnalysis = (params: {
  isoId: string;
  isoFeature: Feature<Polygon | MultiPolygon, { value: number }>;
  territorialFeatures: TerritorialFeature[];
  territorialLayers: TerritorialLayer[];
  territorialGroups: TerritorialGroup[];
  comunasFC: ComunaFC | null;
  ineByName: Map<string, IneCommuneStats>;
  nombresPorCodigo: Record<string, string>;
  manzanas: ManzanaFeatureCollection | null;
  gse?: GseFeatureCollection | null;
}): IsochroneAnalysis => {
  const {
    isoId,
    isoFeature,
    territorialFeatures,
    territorialLayers,
    territorialGroups,
    comunasFC,
    ineByName,
    nombresPorCodigo,
    manzanas,
    gse = null,
  } = params;

  const bandMinutes = Math.round((isoFeature.properties?.value ?? 0) / 60);
  const area_km2 = safeArea(isoFeature) / 1_000_000;

  const territorialPoints = countTerritorialPoints(
    isoFeature,
    territorialFeatures,
    territorialLayers,
    territorialGroups,
  );
  const communes = communeBreakdown(isoFeature, comunasFC, ineByName, nombresPorCodigo);
  const manzanasBD = manzanaBreakdown(isoFeature, manzanas);
  const gseBD = gseBreakdown(isoFeature, gse);

  // ── Jerarquía de fuentes de población (mejor → peor) ────────────────────
  //
  // 1. GSE Censo 2024 (n_per / n_hog por manzana, 334 comunas). Se carga
  //    siempre por bbox de la isócrona, así que cubre el área completa.
  // 2. Manzanas INE Censo 2017 (solo RM). Van SEGUNDAS a propósito: provienen
  //    de la capa del mapa, que solo existe si el usuario la tiene encendida y
  //    está acotada al viewport. Si el viewport no cubre toda la isócrona, el
  //    set es parcial y subcontaba la población — con la jerarquía anterior
  //    ganaban igual, y el mismo análisis daba cifras distintas según dónde
  //    estuviera el mapa. Solo se usan si no hay GSE.
  // 3. Fallback comunal por área. Asume distribución uniforme dentro de la
  //    comuna: INCORRECTO para comunas grandes/mixtas. Último recurso.
  //
  let pop = 0;
  let hh = 0;
  let source: "manzanas" | "comuna" = "comuna";

  if (gseBD && gseBD.pop > 0) {
    // Fuente 1: GSE Censo 2024 — n_per/n_hog por manzana × share de área
    pop = gseBD.pop;
    hh = gseBD.hh > 0 ? gseBD.hh : Math.round(pop / HH_SIZE_FALLBACK);
    source = "manzanas";
  } else if (manzanasBD && manzanasBD.pop > 0) {
    // Fuente 2: manzanas INE (Censo 2017, solo RM)
    pop = manzanasBD.pop;
    hh = manzanasBD.hh > 0 ? manzanasBD.hh : Math.round(pop / HH_SIZE_FALLBACK);
    source = "manzanas";
  } else {
    // Fuente 3: estimación comunal por área proporcional (último recurso)
    pop = Math.round(communes.reduce((s, c) => s + c.popInIso, 0));
    hh  = Math.round(communes.reduce((s, c) => s + c.hhInIso, 0));
    source = "comuna";
  }

  // Ingresos vienen siempre del ingreso comunal aplicado a hogares dentro de la iso.
  let incomeTotal = 0;
  const totalHhCommune = communes.reduce((s, c) => s + c.hhInIso, 0);
  const scale = source === "manzanas" && totalHhCommune > 0 ? hh / totalHhCommune : 1;
  for (const c of communes) {
    if (c.ingreso == null) continue;
    incomeTotal += c.hhInIso * scale * c.ingreso;
  }
  const incomeAvgPerHh = hh > 0 ? incomeTotal / hh : 0;

  const density = computeDensity(area_km2, pop, hh, territorialPoints);
  const comparisons = buildComparisons(
    { pop, hh, incomeAvgPerHh: Math.round(incomeAvgPerHh) },
    density,
    gseBD,
  );

  return {
    isoId,
    bandMinutes,
    area_km2,
    territorialPoints,
    communes,
    manzanas: manzanasBD,
    gse: gseBD,
    density,
    comparisons,
    totals: {
      pop,
      hh,
      incomeTotal: Math.round(incomeTotal),
      incomeAvgPerHh: Math.round(incomeAvgPerHh),
      source,
    },
  };
};

