/**
 * crimeService.ts
 * ===============
 * Carga y cachea el GeoJSON de riesgo delictivo por comuna.
 *
 * Fuente: /public/crime/crime_risk_chile.geojson
 *   → 346 comunas, Censo 2024 + CEAD 2022-2024.
 */

import type { CrimeFeatureCollection, CrimeFeature, RiskLevel } from "@/types/crime";

const CRIME_GEOJSON_URL = "/crime/crime_risk_chile.geojson";

class CrimeService {
  private dataPromise: Promise<CrimeFeatureCollection> | null = null;

  /** Carga el GeoJSON completo (una sola vez, cacheado). */
  async load(): Promise<CrimeFeatureCollection> {
    if (!this.dataPromise) {
      this.dataPromise = fetch(CRIME_GEOJSON_URL)
        .then((r) => {
          if (!r.ok) throw new Error(`crime GeoJSON fetch failed: ${r.status}`);
          return r.json() as Promise<CrimeFeatureCollection>;
        })
        .catch((e) => {
          this.dataPromise = null;
          throw e;
        });
    }
    return this.dataPromise;
  }

  /** Devuelve features cuyo bbox intersecta el viewport. */
  async getFeaturesInBbox(
    bbox: [number, number, number, number],
  ): Promise<CrimeFeature[]> {
    const data = await this.load();
    return data.features.filter((f) => featureInBbox(f, bbox));
  }

  /** Devuelve la feature de una comuna por CUT (código de 5 dígitos). */
  async getBycut(cut: string): Promise<CrimeFeature | null> {
    const data = await this.load();
    return data.features.find((f) => f.properties.cut === cut) ?? null;
  }

  /** Estadísticas rápidas para un conjunto de CUTs (ej: comunas de una isócrona). */
  async summarize(cuts: string[]): Promise<{
    nivelPredominante: RiskLevel;
    avgScore: number;
    avgTasa: number;
    topComunas: Array<{ comuna: string; nivel: RiskLevel; tasa: number }>;
  } | null> {
    if (cuts.length === 0) return null;
    const data = await this.load();
    const features = data.features.filter((f) => cuts.includes(f.properties.cut));
    if (features.length === 0) return null;

    const scores = features.map((f) => f.properties.risk_score);
    const tasas  = features.map((f) => f.properties.tasa_x1000);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const avgTasa  = tasas.reduce((a, b) => a + b, 0) / tasas.length;

    // Nivel predominante = el más frecuente
    const counts: Record<string, number> = {};
    features.forEach((f) => {
      const n = f.properties.nivel_riesgo;
      counts[n] = (counts[n] ?? 0) + 1;
    });
    const nivelPredominante = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as RiskLevel;

    const topComunas = features
      .sort((a, b) => b.properties.tasa_x1000 - a.properties.tasa_x1000)
      .slice(0, 5)
      .map((f) => ({
        comuna: f.properties.comuna,
        nivel: f.properties.nivel_riesgo,
        tasa: f.properties.tasa_x1000,
      }));

    return { nivelPredominante, avgScore, avgTasa, topComunas };
  }
}

// ── Utilidades geométricas ────────────────────────────────────────────────────

function featureInBbox(
  feature: CrimeFeature,
  bbox: [number, number, number, number],
): boolean {
  const geom = feature.geometry;
  if (!geom) return false;
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
  return !(maxX < bbox[0] || minX > bbox[2] || maxY < bbox[1] || minY > bbox[3]);
}

export const crimeService = new CrimeService();
