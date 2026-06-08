/**
 * territorialExtras.ts
 * ====================
 * Features territoriales DERIVADOS de las capas agregadas (crime, atractores
 * comerciales, gasto endógeno). Se computan en el cliente (donde están todos
 * los datos cargados) y se pasan a la edge `compute-poi-features` bajo la clave
 * `territorial_extras`, que los fusiona en `poi_features_cache.features`.
 *
 * Diseño:
 *   - Función PURA y sincrónica (los puntos comerciales están bundleados).
 *   - El crime por celda llega en `ManzanaCell.crime_score` (overlay GSE, RM).
 *     Para regiones (1 celda comuna sin GSE) se usa `crimeFallbackIdx`.
 *   - El gasto endógeno usa la clase GSE real de la celda si está disponible,
 *     o cae al mapeo NSE→GSE.
 *
 * Todas las claves resultantes son numéricas (requisito del modelo Ridge).
 */

import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import type { Polygon, MultiPolygon, Feature } from "geojson";
import commercialData from "@/data/commercial_heatmap_points.json";
import { EPF_AUTOPLANET, GSE_TARGET } from "@/utils/gastoEndogeno";
import type { GseClass } from "@/types/gse";

// ── Datos comerciales (bundleados) ────────────────────────────────────────────

type CommercialCategory = "all" | "shops" | "food" | "services" | "health_edu" | "other";
type RawPoint = [number, number]; // [lat, lon]
const COMMERCIAL = commercialData as Record<CommercialCategory, RawPoint[]>;

// ── Mapeo NSE(1-5) → GseClass para EPF cuando no hay clase GSE explícita ──────

const NSE_TO_GSE: Record<1 | 2 | 3 | 4 | 5, GseClass> = {
  5: "ABC1",
  4: "C2",
  3: "C3",
  2: "D",
  1: "E",
};

// ── Celda enriquecida que consume esta función ────────────────────────────────

export interface ExtraCell {
  pop: number;
  hh: number;
  nse: 1 | 2 | 3 | 4 | 5;
  centroid: [number, number]; // [lng, lat]
  crime_score?: number | null; // 0-1 (overlay GSE manzana), opcional
  gse_class?: GseClass | null; // clase GSE real, opcional
}

export interface TerritorialExtrasInput {
  cells: ExtraCell[];
  isoPolygon: Polygon | MultiPolygon;
  areaKm2: number;
  isRm: boolean;
  /** Riesgo 0-100 a nivel comuna, fallback para regiones sin crime por celda. */
  crimeFallbackIdx?: number | null;
}

// ── Cálculo principal ─────────────────────────────────────────────────────────

export function computeTerritorialExtras(
  input: TerritorialExtrasInput,
): Record<string, number> {
  const { cells, isoPolygon, areaKm2, isRm, crimeFallbackIdx } = input;

  // Celdas dentro de la isócrona (en RM filtramos por centroide; en regiones
  // la celda comuna se incluye siempre, igual que hace computeFeatures).
  const cellsInside = isRm
    ? cells.filter((c) => pip(c.centroid, isoPolygon))
    : cells;

  // ── 1) Riesgo delictivo (ponderado por población) ──────────────────────────
  let crimeNum = 0;
  let crimeDen = 0;
  for (const c of cellsInside) {
    if (c.crime_score == null) continue;
    crimeNum += c.crime_score * c.pop;
    crimeDen += c.pop;
  }
  // crime_score viene 0-1 → escalamos a 0-100 para legibilidad/consistencia.
  const crimeRiskIdx =
    crimeDen > 0
      ? (crimeNum / crimeDen) * 100
      : (crimeFallbackIdx ?? 0);

  // ── 2) Atractores comerciales (point-in-polygon en isócrona) ───────────────
  const commercial = countCommercial(isoPolygon);
  const commercialDensity = areaKm2 > 0 ? commercial.total / areaKm2 : 0;

  // ── 3) Gasto endógeno (hogares × EPF[GSE]) ─────────────────────────────────
  let gastoTotal = 0;     // todos los GSE
  let gastoObjetivo = 0;  // solo ABC1, C1, C2, C3, D
  let hhObjetivo = 0;
  for (const c of cellsInside) {
    const gse: GseClass = c.gse_class ?? NSE_TO_GSE[c.nse];
    const coef = EPF_AUTOPLANET[gse] ?? 0;
    const gasto = c.hh * coef;
    gastoTotal += gasto;
    if (GSE_TARGET.includes(gse)) {
      gastoObjetivo += gasto;
      hhObjetivo += c.hh;
    }
  }
  const gastoPorHogar = hhObjetivo > 0 ? gastoObjetivo / hhObjetivo : 0;

  return {
    // Riesgo delictivo
    crime_risk_idx: round(crimeRiskIdx, 2),
    // Atractores comerciales
    commercial_total: commercial.total,
    commercial_shops: commercial.shops,
    commercial_food: commercial.food,
    commercial_services: commercial.services,
    commercial_health_edu: commercial.health_edu,
    commercial_density_km2: round(commercialDensity, 2),
    // Gasto endógeno (CLP/mes)
    gasto_endogeno_objetivo_clp: Math.round(gastoObjetivo),
    gasto_endogeno_total_clp: Math.round(gastoTotal),
    gasto_endogeno_por_hogar: Math.round(gastoPorHogar),
  };
}

// ── Conteo de atractores comerciales por categoría ────────────────────────────

interface CommercialCounts {
  total: number; shops: number; food: number;
  services: number; health_edu: number; other: number;
}

function countCommercial(iso: Polygon | MultiPolygon): CommercialCounts {
  const isoFeat = { type: "Feature", properties: {}, geometry: iso } as Feature<Polygon | MultiPolygon>;

  // Bbox de la isócrona para descarte rápido
  const { minLat, maxLat, minLon, maxLon } = polyBounds(iso);

  const cats: (keyof Omit<CommercialCounts, "total">)[] =
    ["shops", "food", "services", "health_edu", "other"];

  const counts: CommercialCounts = {
    total: 0, shops: 0, food: 0, services: 0, health_edu: 0, other: 0,
  };

  for (const cat of cats) {
    const pts = COMMERCIAL[cat] ?? [];
    let n = 0;
    for (const [lat, lon] of pts) {
      if (lat < minLat || lat > maxLat || lon < minLon || lon > maxLon) continue;
      try {
        if (booleanPointInPolygon(point([lon, lat]), isoFeat as never)) n++;
      } catch {
        // ignorar punto con error
      }
    }
    counts[cat] = n;
    counts.total += n;
  }
  return counts;
}

// ── Helpers geométricos ───────────────────────────────────────────────────────

/** point-in-polygon con [lng, lat]. */
function pip(lnglat: [number, number], geom: Polygon | MultiPolygon): boolean {
  try {
    return booleanPointInPolygon(
      point(lnglat),
      { type: "Feature", properties: {}, geometry: geom } as never,
    );
  } catch {
    return false;
  }
}

function polyBounds(geom: Polygon | MultiPolygon) {
  const rings: number[][][] =
    geom.type === "Polygon" ? geom.coordinates : geom.coordinates.flat();
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minLon) minLon = x;
      if (y < minLat) minLat = y;
      if (x > maxLon) maxLon = x;
      if (y > maxLat) maxLat = y;
    }
  }
  return { minLat, maxLat, minLon, maxLon };
}

const round = (v: number, d: number) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};
