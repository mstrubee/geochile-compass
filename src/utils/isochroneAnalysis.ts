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

export type NseLabel = "ABC1" | "C2" | "C3" | "D" | "E";

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

  // Decide source for population & households
  let pop = 0;
  let hh = 0;
  let source: "manzanas" | "comuna" = "comuna";
  if (manzanasBD && manzanasBD.pop > 0) {
    pop = manzanasBD.pop;
    hh = manzanasBD.hh > 0 ? manzanasBD.hh : Math.round(pop / HH_SIZE_FALLBACK);
    source = "manzanas";
  } else {
    pop = Math.round(communes.reduce((s, c) => s + c.popInIso, 0));
    hh = Math.round(communes.reduce((s, c) => s + c.hhInIso, 0));
    source = "comuna";
  }

  // Ingresos vienen siempre del ingreso comunal aplicado a hogares dentro de la iso.
  // Si la fuente fue manzanas, escalamos los hogares comunales para que sumen `hh`.
  let incomeTotal = 0;
  const totalHhCommune = communes.reduce((s, c) => s + c.hhInIso, 0);
  const scale = source === "manzanas" && totalHhCommune > 0 ? hh / totalHhCommune : 1;
  for (const c of communes) {
    if (c.ingreso == null) continue;
    incomeTotal += c.hhInIso * scale * c.ingreso;
  }
  const incomeAvgPerHh = hh > 0 ? incomeTotal / hh : 0;

  return {
    isoId,
    bandMinutes,
    area_km2,
    territorialPoints,
    communes,
    manzanas: manzanasBD,
    totals: {
      pop,
      hh,
      incomeTotal: Math.round(incomeTotal),
      incomeAvgPerHh: Math.round(incomeAvgPerHh),
      source,
    },
  };
};
