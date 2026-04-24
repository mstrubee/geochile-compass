import type { Polygon, MultiPolygon, Feature } from "geojson";
import type {
  GseFeature,
  GseFeatureCollection,
  GseIndex,
  GseIndexEntry,
  GseParams,
  GseProperties,
} from "@/types/gse";

/**
 * Carga manzanas con datos GSE (Censo 2012, AMS) pre-procesadas en
 * /public/gse/<slug>.geojson + /public/gse/index.json.
 *
 * Estrategia (igual que manzanaService):
 *   1. index.json una vez (cache).
 *   2. Identificar comunas cuyo bbox intersecta el viewport.
 *   3. Cargar el geojson de cada comuna (cache por slug).
 *   4. Filtrar features por bbox del viewport.
 */

const MAX_FEATURES = 8000;

const bboxIntersects = (
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);

const featureInBbox = (
  geom: Polygon | MultiPolygon,
  bbox: [number, number, number, number],
): boolean => {
  const rings: number[][][] =
    geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flat();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return bboxIntersects([minX, minY, maxX, maxY], bbox);
};

class GseService {
  private indexPromise: Promise<GseIndex> | null = null;
  private fileCache = new Map<string, Promise<Feature<Polygon | MultiPolygon, GseProperties>[]>>();

  loadIndex(): Promise<GseIndex> {
    if (!this.indexPromise) {
      this.indexPromise = fetch("/gse/index.json").then(async (r) => {
        if (!r.ok) throw new Error(`gse index.json HTTP ${r.status}`);
        return (await r.json()) as GseIndex;
      });
    }
    return this.indexPromise;
  }

  private loadCommune(slug: string): Promise<Feature<Polygon | MultiPolygon, GseProperties>[]> {
    let p = this.fileCache.get(slug);
    if (!p) {
      p = fetch(`/gse/${slug}.geojson`).then(async (r) => {
        if (!r.ok) throw new Error(`${slug}.geojson HTTP ${r.status}`);
        const fc = (await r.json()) as { features: Feature<Polygon | MultiPolygon, GseProperties>[] };
        return fc.features ?? [];
      });
      this.fileCache.set(slug, p);
    }
    return p;
  }

  /** Comunas del índice cuyo bbox intersecta el viewport. */
  async coveredCommunesIn(bbox: [number, number, number, number]): Promise<GseIndexEntry[]> {
    const idx = await this.loadIndex();
    return idx.communes.filter((c) => bboxIntersects(c.bbox, bbox));
  }

  async fetchGse(params: GseParams): Promise<GseFeatureCollection> {
    const { west, south, east, north, variable } = params;
    const viewportBbox: [number, number, number, number] = [west, south, east, north];

    const matching = await this.coveredCommunesIn(viewportBbox);
    if (matching.length === 0) {
      return {
        type: "FeatureCollection",
        features: [],
        metadata: {
          total: 0,
          bbox: viewportBbox,
          variable,
          source: "Censo 2012",
          fallbackCommunes: [],
        },
      };
    }

    const buckets = await Promise.all(matching.map((c) => this.loadCommune(c.slug)));
    const features: GseFeature[] = [];
    outer: for (const bucket of buckets) {
      for (const f of bucket) {
        if (!f.geometry) continue;
        if (!featureInBbox(f.geometry, viewportBbox)) continue;
        features.push({ type: "Feature", geometry: f.geometry, properties: f.properties });
        if (features.length >= MAX_FEATURES) break outer;
      }
    }

    return {
      type: "FeatureCollection",
      features,
      metadata: {
        total: features.length,
        bbox: viewportBbox,
        variable,
        source: "Censo 2012",
        fallbackCommunes: [],
      },
    };
  }
}

export const gseService = new GseService();
