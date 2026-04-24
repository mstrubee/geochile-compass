import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon } from "geojson";
import { area as turfArea } from "@turf/area";
import { length as turfLength } from "@turf/length";
import { polygonToLine } from "@turf/polygon-to-line";
import booleanIntersects from "@turf/boolean-intersects";
import buffer from "@turf/buffer";
import { voronoi } from "@turf/voronoi";
import bbox from "@turf/bbox";
import { polygon, point } from "@turf/helpers";
import type { ManzanaFeature, ManzanaFeatureCollection } from "@/types/manzanas";
import type { MicrozoneStats } from "@/types/microzones";
import type { NSE } from "@/data/communes";

/** Construye el feature polygon a partir de un anillo de puntos lat/lng */
export const polygonFromLatLngs = (
  pts: Array<{ lat: number; lng: number }>,
): Feature<Polygon> | null => {
  if (pts.length < 3) return null;
  const ring = pts.map((p) => [p.lng, p.lat]);
  // cerrar
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  try {
    return polygon([ring]);
  } catch {
    return null;
  }
};

/** Crea un buffer circular (en metros) alrededor de un punto */
export const bufferAroundPoint = (
  center: { lat: number; lng: number },
  meters: number,
): Feature<Polygon | MultiPolygon> | null => {
  try {
    const p = point([center.lng, center.lat]);
    const buf = buffer(p, meters / 1000, { units: "kilometers" });
    return (buf as Feature<Polygon | MultiPolygon>) ?? null;
  } catch {
    return null;
  }
};

/** Voronoi de los POIs visibles, recortado al bounding box de los puntos */
export const voronoiFromPois = (
  pois: Array<{ id: string; lat: number; lng: number }>,
  paddingKm = 5,
): Feature<Polygon>[] => {
  if (pois.length < 2) return [];
  const fc: FeatureCollection<Point> = {
    type: "FeatureCollection",
    features: pois.map((p) =>
      point([p.lng, p.lat], { id: p.id }),
    ),
  };
  const [minX, minY, maxX, maxY] = bbox(fc);
  // Padding aproximado en grados (1° lat ≈ 111 km)
  const padDeg = paddingKm / 111;
  const bboxArr: [number, number, number, number] = [
    minX - padDeg,
    minY - padDeg,
    maxX + padDeg,
    maxY + padDeg,
  ];
  try {
    const v = voronoi(fc, { bbox: bboxArr });
    return (v.features.filter(
      (f) => f && f.geometry && f.geometry.type === "Polygon",
    ) as Feature<Polygon>[]);
  } catch {
    return [];
  }
};

/** Calcula estadísticas demográficas a partir de manzanas intersectadas */
export const computeMicrozoneStats = (
  geom: Feature<Polygon | MultiPolygon>,
  manzanas: ManzanaFeatureCollection | null,
): MicrozoneStats => {
  const area_km2 = turfArea(geom) / 1_000_000;
  let perimeter_km = 0;
  try {
    const line = polygonToLine(geom);
    // polygonToLine puede devolver Feature o FeatureCollection según geometría
    perimeter_km = turfLength(line as Parameters<typeof turfLength>[0], {
      units: "kilometers",
    });
  } catch {
    perimeter_km = 0;
  }

  const stats: MicrozoneStats = {
    area_km2,
    perimeter_km,
    manzanaCount: 0,
    pop: 0,
    hh: 0,
    nseDistribution: {},
    dominantNse: null,
  };

  if (!manzanas?.features?.length) return stats;

  const dist: Partial<Record<NSE, number>> = {};
  for (const m of manzanas.features as ManzanaFeature[]) {
    try {
      if (booleanIntersects(geom, m)) {
        stats.manzanaCount += 1;
        stats.pop += m.properties.pop ?? 0;
        stats.hh += m.properties.hh ?? 0;
        const nse = m.properties.nse;
        if (nse) dist[nse] = (dist[nse] ?? 0) + (m.properties.pop ?? 0);
      }
    } catch {
      // ignorar geometrías inválidas
    }
  }
  stats.nseDistribution = dist;
  let max = 0;
  let dom: NSE | null = null;
  (Object.entries(dist) as Array<[string, number]>).forEach(([k, v]) => {
    if (v > max) {
      max = v;
      dom = k as NSE;
    }
  });
  stats.dominantNse = dom;
  return stats;
};
