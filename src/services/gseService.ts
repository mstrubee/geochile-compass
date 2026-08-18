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
 * Carga manzanas con datos GSE (Censo 2024, AMS) pre-procesadas en
 * /public/gse/<slug>.geojson + /public/gse/index.json.
 *
 * Estrategia (igual que manzanaService):
 *   1. index.json una vez (cache).
 *   2. Identificar comunas cuyo bbox intersecta el viewport.
 *   3. Cargar el geojson de cada comuna (cache por slug).
 *   4. Filtrar features por bbox del viewport.
 */

const MAX_FEATURES = 8000;

import { capEvenlyAcrossBuckets } from "@/utils/evenCap";

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

    const idx = await this.loadIndex();
    const sourceYear = idx.source_year ?? 2012;
    const matching = idx.communes.filter((c) => bboxIntersects(c.bbox, viewportBbox));
    if (matching.length === 0) {
      return {
        type: "FeatureCollection",
        features: [],
        metadata: {
          total: 0,
          bbox: viewportBbox,
          variable,
          source: `Censo ${sourceYear}`,
          source_year: sourceYear,
          fallbackCommunes: [],
        },
      };
    }

    const cap = params.maxFeatures ?? MAX_FEATURES;
    const rawBuckets = await Promise.all(matching.map((c) => this.loadCommune(c.slug)));

    // Un bucket por comuna, ya filtrado al viewport. El tope se reparte entre
    // ellos en vez de llenarlos por orden: cortar en secuencia dejaba las
    // últimas comunas del viewport completamente sin manzanas, que es el
    // territorio en blanco que aparecía al alejar el zoom.
    const inBbox: GseFeature[][] = rawBuckets.map((bucket) =>
      bucket
        .filter((f) => f.geometry && featureInBbox(f.geometry, viewportBbox))
        .map((f) => ({ type: "Feature", geometry: f.geometry, properties: f.properties } as GseFeature)),
    );
    const { features, truncated, totalAvailable } = capEvenlyAcrossBuckets(inBbox, cap);
    if (truncated) {
      console.warn(
        `[gseService] ${totalAvailable} manzanas en el viewport exceden el tope de ${cap}: ` +
        `se muestra una muestra repartida entre las ${matching.length} comunas. ` +
        `Los totales de población/distribución quedan subestimados.`,
      );
    }

    return {
      type: "FeatureCollection",
      features,
      metadata: {
        total: features.length,
        bbox: viewportBbox,
        variable,
        source: `Censo ${sourceYear}`,
        source_year: sourceYear,
        fallbackCommunes: [],
        truncated,
        totalAvailable,
      },
    };
  }
}

export const gseService = new GseService();
