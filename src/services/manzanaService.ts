import type {
  ManzanaService,
  ManzanaParams,
  ManzanaFeatureCollection,
  ManzanaFeature,
  ManzanaProperties,
} from "@/types/manzanas";
import type { Polygon, MultiPolygon, Feature } from "geojson";
import { COMMUNES, NSE_INCOME, type NSE } from "@/data/communes";

/**
 * Carga manzanas reales del Censo 2017 (RM) pre-procesadas en build-time.
 * Datos en /public/manzanas/ generados por scripts/build-manzanas.mjs.
 *
 * Estrategia:
 *   1. Lee /manzanas/index.json una vez (cache).
 *   2. Para el bbox del viewport, identifica comunas cuyo bbox intersecta.
 *   3. Carga el .geojson de cada comuna (cache por comuna).
 *   4. Filtra features por bbox del viewport y enriquece propiedades:
 *      - pop, hh, commune ← Censo 2017
 *      - nse, income, traffic ← heredados de la comuna (COMMUNES en src/data)
 *      - density ← pop / área aproximada de la manzana (constante 0.01 km²)
 */

interface CommuneIndexEntry {
  commune: string;
  slug: string;
  file: string;
  count: number;
  bbox: [number, number, number, number];
}

interface ManzanaIndex {
  region: string;
  source: string;
  communes: CommuneIndexEntry[];
}

interface RawProps {
  id: string;
  commune: string;
  pop: number;
  hh: number;
}

const MAX_FEATURES = 6000;
const ASSUMED_BLOCK_AREA_KM2 = 0.01; // ~10,000 m² promedio por manzana urbana

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const COMMUNE_BY_NAME = new Map(COMMUNES.map((c) => [norm(c.name), c]));

const enrichProps = (raw: RawProps): ManzanaProperties => {
  const meta = COMMUNE_BY_NAME.get(norm(raw.commune));
  const nse: NSE = (meta?.nse ?? 3) as NSE;
  const traffic = meta?.traffic ?? 50;
  const income = NSE_INCOME[nse];
  const density = Math.max(50, Math.round(raw.pop / ASSUMED_BLOCK_AREA_KM2));
  return {
    id: raw.id,
    commune: raw.commune,
    pop: raw.pop,
    hh: raw.hh,
    nse,
    traffic,
    income,
    density,
  };
};

const bboxIntersects = (
  a: [number, number, number, number],
  b: [number, number, number, number]
): boolean => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);

const featureInBbox = (
  geom: Polygon | MultiPolygon,
  bbox: [number, number, number, number]
): boolean => {
  // Cheap test: does any vertex fall inside, or does the geom bbox overlap?
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

class RealManzanaService implements ManzanaService {
  private indexPromise: Promise<ManzanaIndex> | null = null;
  private fileCache = new Map<string, Promise<Feature<Polygon | MultiPolygon, RawProps>[]>>();

  async isAvailable() {
    try {
      await this.loadIndex();
      return true;
    } catch {
      return false;
    }
  }

  private loadIndex(): Promise<ManzanaIndex> {
    if (!this.indexPromise) {
      this.indexPromise = fetch("/manzanas/index.json").then(async (r) => {
        if (!r.ok) throw new Error(`index.json HTTP ${r.status}`);
        return (await r.json()) as ManzanaIndex;
      });
    }
    return this.indexPromise;
  }

  private loadCommune(slug: string): Promise<Feature<Polygon | MultiPolygon, RawProps>[]> {
    let p = this.fileCache.get(slug);
    if (!p) {
      p = fetch(`/manzanas/${slug}.geojson`).then(async (r) => {
        if (!r.ok) throw new Error(`${slug}.geojson HTTP ${r.status}`);
        const fc = (await r.json()) as {
          features: Feature<Polygon | MultiPolygon, RawProps>[];
        };
        return fc.features ?? [];
      });
      this.fileCache.set(slug, p);
    }
    return p;
  }

  async fetchManzanas(params: ManzanaParams): Promise<ManzanaFeatureCollection> {
    const { west, south, east, north, variable } = params;
    const viewportBbox: [number, number, number, number] = [west, south, east, north];
    const index = await this.loadIndex();

    const matching = index.communes.filter((c) => bboxIntersects(c.bbox, viewportBbox));
    if (matching.length === 0) {
      return {
        type: "FeatureCollection",
        features: [],
        metadata: { total: 0, bbox: viewportBbox, variable, source: "INE Censo 2017" },
      };
    }

    const buckets = await Promise.all(matching.map((c) => this.loadCommune(c.slug)));

    const features: ManzanaFeature[] = [];
    outer: for (const bucket of buckets) {
      for (const f of bucket) {
        if (!f.geometry) continue;
        if (!featureInBbox(f.geometry, viewportBbox)) continue;
        features.push({
          type: "Feature",
          geometry: f.geometry,
          properties: enrichProps(f.properties),
        });
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
        source: "INE Censo 2017",
      },
    };
  }
}

export function createManzanaService(): ManzanaService {
  return new RealManzanaService();
}

// Singleton
export const manzanaService = createManzanaService();
