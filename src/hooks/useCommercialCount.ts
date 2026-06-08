/**
 * useCommercialCount
 * ==================
 * Cuenta atractores comerciales (POIs OSM) dentro de una isócrona.
 *
 * Fuente: commercial_heatmap_points.json — datos ya en memoria (bundleados).
 * Grid 100m deduplicado → cada punto representa un establecimiento.
 * Categorizaciones: all / shops / food / services / health_edu / other.
 *
 * Usa booleanPointInPolygon de turf (client-side, ~30ms para 33k puntos).
 */

import { useMemo } from "react";
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import rawData from "@/data/commercial_heatmap_points.json";
import type { CommercialCategory } from "@/components/map/CommercialHeatLayer";

type RawPoint = [number, number];
const DATA = rawData as Record<CommercialCategory, RawPoint[]>;

export interface CommercialCountResult {
  total:      number;
  shops:      number;
  food:       number;
  services:   number;
  health_edu: number;
  other:      number;
}

/**
 * Dado un polígono de isócrona, cuenta puntos de cada categoría
 * comercial que caigan dentro. Memoizado por coordenadas del polígono.
 */
export function useCommercialCount(
  isoFeature: Feature<Polygon | MultiPolygon, unknown> | null,
): CommercialCountResult | null {
  return useMemo(() => {
    if (!isoFeature) return null;

    const iso = isoFeature as Feature<Polygon | MultiPolygon>;
    const counts: CommercialCountResult = {
      total: 0, shops: 0, food: 0, services: 0, health_edu: 0, other: 0,
    };

    // Usar bboxCheck antes del PIP caro para performance
    const coords = isoFeature.geometry.type === "Polygon"
      ? isoFeature.geometry.coordinates.flat()
      : isoFeature.geometry.coordinates.flatMap(p => p.flat());
    const lons = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);

    // Categorías a contar (excluyendo "all" para evitar doble conteo)
    const cats: (keyof Omit<CommercialCountResult, "total">)[] =
      ["shops", "food", "services", "health_edu", "other"];

    for (const cat of cats) {
      const pts = DATA[cat] ?? [];
      let count = 0;
      for (const [lat, lon] of pts) {
        // Bbox check rápido primero
        if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) continue;
        try {
          if (booleanPointInPolygon(point([lon, lat]), iso as never)) {
            count++;
          }
        } catch {
          // ignorar puntos con error
        }
      }
      counts[cat] = count;
      counts.total += count;
    }

    return counts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isoFeature?.geometry]);
}
