import hexGrid from "@turf/hex-grid";
import type {
  ManzanaService,
  ManzanaParams,
  ManzanaFeatureCollection,
  ManzanaFeature,
  ManzanaProperties,
} from "@/types/manzanas";
import { idwValue } from "@/utils/idwInterpolation";
import type { NSE } from "@/data/communes";

const MAX_FEATURES = 2000;

// Cell size (km) tuned by zoom — denser grid at higher zoom
const cellSizeForZoom = (zoom: number): number => {
  if (zoom >= 14) return 0.18;
  if (zoom >= 13) return 0.30;
  if (zoom >= 12) return 0.50;
  if (zoom >= 11) return 0.90;
  return 1.6;
};

const noise = (amount = 0.15) => 1 + (Math.random() * 2 - 1) * amount;
const clampNSE = (n: number): NSE => Math.max(1, Math.min(5, Math.round(n))) as NSE;

class MockManzanaService implements ManzanaService {
  async isAvailable() {
    return true;
  }

  async fetchManzanas(params: ManzanaParams): Promise<ManzanaFeatureCollection> {
    // Simulate network latency
    await new Promise((r) => setTimeout(r, 200 + Math.random() * 200));

    const { west, south, east, north, variable, zoom } = params;
    const cellSize = cellSizeForZoom(zoom);

    const grid = hexGrid<Record<string, never>>(
      [west, south, east, north],
      cellSize,
      { units: "kilometers" }
    );

    const features: ManzanaFeature[] = [];
    for (let i = 0; i < grid.features.length && features.length < MAX_FEATURES; i++) {
      const hex = grid.features[i];
      // Centroid for IDW (simple average of polygon ring vertices)
      const ring = hex.geometry.coordinates[0];
      let sx = 0;
      let sy = 0;
      for (const [lng, lat] of ring) {
        sx += lng;
        sy += lat;
      }
      const cx = sx / ring.length;
      const cy = sy / ring.length;

      const { value: densityRaw, nearest } = idwValue(cy, cx, "density");
      const { value: nseRaw } = idwValue(cy, cx, "nse", 2, 3);
      const { value: trafficRaw } = idwValue(cy, cx, "traffic");
      const { value: popRaw } = idwValue(cy, cx, "pop");
      const { value: hhRaw } = idwValue(cy, cx, "hh");

      const nse = clampNSE(nseRaw);
      // Synthesize income from NSE band with mild variance
      const incomeBase: Record<NSE, number> = {
        1: 420_000,
        2: 580_000,
        3: 960_000,
        4: 2_100_000,
        5: 5_200_000,
      };

      const density = Math.max(50, Math.round(densityRaw * noise()));
      const traffic = Math.max(0, Math.min(100, Math.round(trafficRaw * noise(0.10))));
      const income = Math.round(incomeBase[nse] * noise(0.18));
      // Per-block pop scaled down significantly from commune values
      const pop = Math.max(20, Math.round((popRaw / 1500) * noise()));
      const hh = Math.max(8, Math.round((hhRaw / 1500) * noise()));

      const properties: ManzanaProperties = {
        id: `mock-${i}`,
        density,
        nse,
        income,
        traffic,
        pop,
        hh,
        commune: nearest.name,
      };

      features.push({
        type: "Feature",
        geometry: hex.geometry,
        properties,
      });
    }

    return {
      type: "FeatureCollection",
      features,
      metadata: {
        total: features.length,
        bbox: [west, south, east, north],
        variable,
        source: "mock",
      },
    };
  }
}

class RealManzanaService implements ManzanaService {
  // TODO: conectar con PostGIS backend
  // Datos: shapefile manzanas INE Censo 2017 (~120k manzanas RM)
  // Fuente: ide.cl / redatam.org
  // Stack sugerido: PostGIS + Node.js/Python + tile server
  // Migración: solo cambiar VITE_MANZANA_API_URL en .env
  constructor(private apiUrl: string) {}

  async isAvailable() {
    try {
      const res = await fetch(`${this.apiUrl}/health`, { method: "GET" });
      return res.ok;
    } catch {
      return false;
    }
  }

  async fetchManzanas(params: ManzanaParams): Promise<ManzanaFeatureCollection> {
    const url = new URL(`${this.apiUrl}/manzanas`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Manzana API error ${res.status}`);
    return (await res.json()) as ManzanaFeatureCollection;
  }
}

export function createManzanaService(): ManzanaService {
  const apiUrl = import.meta.env.VITE_MANZANA_API_URL as string | undefined;
  return apiUrl ? new RealManzanaService(apiUrl) : new MockManzanaService();
}

// Singleton
export const manzanaService = createManzanaService();
