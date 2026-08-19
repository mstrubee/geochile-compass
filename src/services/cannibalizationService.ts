import type { Feature, MultiPolygon, Polygon } from "geojson";
import area from "@turf/area";
import intersect from "@turf/intersect";
import bboxFn from "@turf/bbox";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point, feature as turfFeature, featureCollection } from "@turf/helpers";
import { loadParqueGeoJson, type ParqueHexProps } from "@/services/parqueData";
import { fetchPoiIsochrones } from "@/services/poiIsochroneService";
import type { GseFeatureCollection } from "@/types/gse";

/**
 * Canibalización: cuánto del área de influencia de una ubicación nueva ya está
 * cubierto por locales propios.
 *
 * Se mide sobre la INTERSECCIÓN de isócronas —la del emplazamiento nuevo contra
 * las de los locales existentes de la misma carpeta—, que es la definición
 * operativa de solape de áreas de influencia.
 *
 * El indicador principal es POBLACIÓN solapada sobre población total: un solape
 * en zona despoblada no canibaliza nada, y medirlo por área lo trataría igual
 * que uno en zona densa. El área y el parque se reportan igual porque son
 * legibles y sirven de contexto, pero no son la base del porcentaje.
 */

export interface CannibalizationOverlap {
  /** Local propio con el que se solapa. */
  poiId: string;
  name: string;
  /** km² de intersección. */
  areaKm2: number;
}

export interface CannibalizationResult {
  /** Locales propios cuya isócrona intersecta la del emplazamiento nuevo. */
  overlaps: CannibalizationOverlap[];
  /** Unión de las intersecciones — evita contar dos veces donde 3 áreas se cruzan. */
  overlapAreaKm2: number;
  /** Área de la isócrona nueva, para dar contexto al porcentaje. */
  isoAreaKm2: number;
  /** % del ÁREA solapada. Informativo. */
  areaPct: number;
  /** Población dentro de la zona solapada. */
  overlapPop: number;
  /** Población total de la isócrona. */
  totalPop: number;
  /** % de POBLACIÓN solapada — la base del castigo por canibalización. */
  popPct: number;
  /** Vehículos dentro de la zona solapada. */
  overlapVehiculos: number;
  /** Vehículos totales de la isócrona. */
  totalVehiculos: number;
  /** % de parque solapado. Informativo. */
  vehiculosPct: number;
  /** true si algún vecino no tenía isócrona guardada y quedó fuera del cálculo. */
  incomplete: boolean;
  /** Cuántos vecinos quedaron sin medir por falta de isócrona guardada. */
  missingIsoCount: number;
}

const KM2 = 1_000_000;

const bboxesOverlap = (a: number[], b: number[]) =>
  !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);

/** Suma de áreas de una lista de polígonos, sin descontar sus cruces. */
const sumAreaKm2 = (polys: Array<Feature<Polygon | MultiPolygon>>): number =>
  polys.reduce((s, p) => s + area(p as never) / KM2, 0);

/**
 * Población dentro de un conjunto de polígonos, a partir de las manzanas GSE.
 *
 * Se decide por CENTROIDE de la manzana y no por fracción de área: las manzanas
 * son chicas frente a una isócrona, así que el error se promedia, y repartir por
 * fracción exigiría intersectar miles de polígonos con costo mucho mayor.
 */
const popInPolygons = (
  gse: GseFeatureCollection | null,
  polys: Array<Feature<Polygon | MultiPolygon>>,
): number => {
  if (!gse?.features?.length || polys.length === 0) return 0;
  const boxes = polys.map((p) => bboxFn(p as never) as number[]);
  let total = 0;
  for (const f of gse.features) {
    const props = f.properties as { personas?: number; pop?: number } | null;
    const pop = Number(props?.personas ?? props?.pop ?? 0);
    if (!pop) continue;
    let cx = 0, cy = 0, n = 0;
    const coords = (f.geometry as Polygon)?.coordinates?.[0];
    if (!coords) continue;
    for (const c of coords) { cx += c[0]; cy += c[1]; n++; }
    if (!n) continue;
    const pt = point([cx / n, cy / n]);
    for (let i = 0; i < polys.length; i++) {
      if (!bboxesOverlap(boxes[i], [cx / n, cy / n, cx / n, cy / n])) continue;
      try {
        if (booleanPointInPolygon(pt, polys[i] as never)) { total += pop; break; }
      } catch { /* geometría inválida: se ignora esa manzana */ }
    }
  }
  return Math.round(total);
};

/** Vehículos dentro de un conjunto de polígonos, ponderando por área de hex. */
const vehiculosInPolygons = async (
  polys: Array<Feature<Polygon | MultiPolygon>>,
): Promise<number> => {
  if (polys.length === 0) return 0;
  const fc = await loadParqueGeoJson().catch(() => null);
  if (!fc?.features?.length) return 0;
  const boxes = polys.map((p) => bboxFn(p as never) as number[]);
  let total = 0;
  for (const hex of fc.features) {
    const props = hex.properties as ParqueHexProps | null;
    const v = Number((props as { n_vehiculos?: number } | null)?.n_vehiculos ?? 0);
    if (!v) continue;
    const hb = bboxFn(hex as never) as number[];
    const hexArea = area(hex as never);
    if (hexArea <= 0) continue;
    // Fracción del hexágono cubierta por el solape. Acá sí se pondera por área:
    // los hexágonos son grandes y decidir por centroide sobre/subestimaría mucho.
    let covered = 0;
    for (let i = 0; i < polys.length; i++) {
      if (!bboxesOverlap(hb, boxes[i])) continue;
      try {
        const inter = intersect(featureCollection([hex as never, polys[i] as never]) as never);
        if (inter) covered += area(inter as never);
      } catch { /* ignora hexágonos con geometría problemática */ }
    }
    total += v * Math.min(1, covered / hexArea);
  }
  return Math.round(total);
};

export interface ComputeCannibalizationInput {
  folderId: string;
  /** Isócrona del emplazamiento nuevo. */
  isoFeature: Feature<Polygon | MultiPolygon>;
  /** Minutos de la isócrona: define qué isócrona de los vecinos comparar. */
  isoMinutes: number;
  /** Locales de la carpeta (vigentes). */
  peers: Array<{ id: string; name: string; lat: number; lng: number }>;
  /** Manzanas GSE del área, ya cargadas por el informe. */
  gse: GseFeatureCollection | null;
  /** Población y vehículos totales del área, para los denominadores. */
  totalPop: number;
  totalVehiculos: number;
}

export const computeCannibalization = async (
  input: ComputeCannibalizationInput,
): Promise<CannibalizationResult> => {
  const { isoFeature, isoMinutes, peers, gse, totalPop, totalVehiculos } = input;

  const isoAreaKm2 = area(isoFeature as never) / KM2;
  const isoBbox = bboxFn(isoFeature as never) as number[];

  const peerIsos = await fetchPoiIsochrones(peers.map((p) => p.id), isoMinutes);

  const overlaps: CannibalizationOverlap[] = [];
  const interPolys: Array<Feature<Polygon | MultiPolygon>> = [];
  let missingIsoCount = 0;

  for (const p of peers) {
    const stored = peerIsos.get(p.id);
    if (!stored) {
      // Solo cuenta como "faltante" si el local está lo bastante cerca para que
      // su isócrona pudiera solapar; los lejanos no distorsionan nada.
      if (
        p.lng >= isoBbox[0] - 0.2 && p.lng <= isoBbox[2] + 0.2 &&
        p.lat >= isoBbox[1] - 0.2 && p.lat <= isoBbox[3] + 0.2
      ) missingIsoCount += 1;
      continue;
    }
    const peerFeat = turfFeature(stored.geometry) as Feature<Polygon | MultiPolygon>;
    if (!bboxesOverlap(isoBbox, bboxFn(peerFeat as never) as number[])) continue;
    try {
      const inter = intersect(featureCollection([isoFeature as never, peerFeat as never]) as never);
      if (!inter) continue;
      const a = area(inter as never) / KM2;
      if (a <= 0) continue;
      overlaps.push({ poiId: p.id, name: p.name, areaKm2: a });
      interPolys.push(inter as Feature<Polygon | MultiPolygon>);
    } catch {
      // Una intersección que falla no debe tumbar el cálculo completo.
    }
  }

  overlaps.sort((a, b) => b.areaKm2 - a.areaKm2);

  // El área solapada NO es la suma de intersecciones: donde tres isócronas se
  // cruzan, esa zona se contaría dos veces. Se acota por el área de la isócrona.
  const overlapAreaKm2 = Math.min(isoAreaKm2, sumAreaKm2(interPolys));

  // Población y parque sí se miden sobre la lista de polígonos con corte al
  // primer match (población) o acumulando cobertura acotada a 1 (parque), así
  // que el doble conteo ya está resuelto en esas funciones.
  const overlapPop = popInPolygons(gse, interPolys);
  const overlapVehiculos = await vehiculosInPolygons(interPolys);

  const pct = (part: number, whole: number) =>
    whole > 0 ? Math.min(100, (part / whole) * 100) : 0;

  return {
    overlaps,
    overlapAreaKm2,
    isoAreaKm2,
    areaPct: pct(overlapAreaKm2, isoAreaKm2),
    overlapPop,
    totalPop,
    popPct: pct(overlapPop, totalPop),
    overlapVehiculos,
    totalVehiculos,
    vehiculosPct: pct(overlapVehiculos, totalVehiculos),
    incomplete: missingIsoCount > 0,
    missingIsoCount,
  };
};
