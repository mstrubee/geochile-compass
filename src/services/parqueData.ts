// ============================================================================
// parqueData.ts
//
// Cache y helpers compartidos del GeoJSON del parque automotor.
// ============================================================================
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import type { Feature, FeatureCollection, Polygon } from "geojson";

export interface ParqueMarcaCount {
  marca: string;
  count: number;
}

export interface ParqueHexProps {
  count: number;
  edad_med: number;
  edad_p25: number;
  edad_p75: number;
  top_marcas: ParqueMarcaCount[];
}

let _cache: FeatureCollection<Polygon, ParqueHexProps> | null = null;
let _cachePromise: Promise<FeatureCollection<Polygon, ParqueHexProps>> | null = null;

export async function loadParqueGeoJson(): Promise<
  FeatureCollection<Polygon, ParqueHexProps>
> {
  if (_cache) return _cache;
  if (_cachePromise) return _cachePromise;
  _cachePromise = fetch("/parque/parque_h3_agregado.geojson")
    .then((r) => r.json())
    .then((j) => {
      _cache = j;
      return j;
    });
  return _cachePromise;
}

export function getParqueGeoJsonSync():
  | FeatureCollection<Polygon, ParqueHexProps>
  | null {
  return _cache;
}

export function findHexAt(
  lat: number,
  lng: number,
): Feature<Polygon, ParqueHexProps> | null {
  if (!_cache) return null;
  const pt = point([lng, lat]);
  for (const f of _cache.features) {
    try {
      if (booleanPointInPolygon(pt, f as any)) return f;
    } catch {
      /* ignore */
    }
  }
  return null;
}
