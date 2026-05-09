/**
 * Utilidades de geometría 2D para spatial joins client-side.
 * Trabajamos en lon/lat. Para áreas y distancias usamos proyección
 * equirectangular local con corrección por latitud (suficientemente
 * precisa a escala de isócrona urbana, ±0.5%).
 */

import type { Polygon, MultiPolygon, Position } from "geojson";

const R_EARTH_M = 6_371_000;

/** Punto-en-polígono (ray casting) para un anillo simple. */
const pointInRing = (point: Position, ring: Position[]): boolean => {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

/**
 * Punto-en-polígono soportando holes (anillo exterior + interiores).
 * Para Polygon: coords[0] = exterior, coords[1..] = holes.
 */
export const pointInPolygon = (
  point: Position,
  polygon: Polygon | MultiPolygon,
): boolean => {
  if (polygon.type === "Polygon") {
    const [outer, ...holes] = polygon.coordinates;
    if (!pointInRing(point, outer)) return false;
    for (const hole of holes) if (pointInRing(point, hole)) return false;
    return true;
  }
  // MultiPolygon: en alguno de sus polígonos.
  for (const poly of polygon.coordinates) {
    const [outer, ...holes] = poly;
    if (!pointInRing(point, outer)) continue;
    let inHole = false;
    for (const hole of holes) {
      if (pointInRing(point, hole)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
};

/** Distancia haversine en metros. */
export const haversineMeters = (
  a: Position,
  b: Position,
): number => {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.sqrt(aa));
};

/** Centroide simple de un polígono (promedio de vertices del exterior). */
export const polygonCentroid = (polygon: Polygon | MultiPolygon): Position => {
  const ring =
    polygon.type === "Polygon"
      ? polygon.coordinates[0]
      : polygon.coordinates[0]?.[0] ?? [];
  if (!ring.length) return [0, 0];
  let sx = 0;
  let sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  return [sx / ring.length, sy / ring.length];
};

/**
 * Bounding box de un polígono.
 */
export const polygonBbox = (
  polygon: Polygon | MultiPolygon,
): [number, number, number, number] => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const rings: Position[][] =
    polygon.type === "Polygon"
      ? polygon.coordinates
      : polygon.coordinates.flat();
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
};

/**
 * Bbox de muchos polígonos.
 */
export const unionBbox = (
  bboxes: Array<[number, number, number, number]>,
): [number, number, number, number] => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x1, y1, x2, y2] of bboxes) {
    if (x1 < minX) minX = x1;
    if (y1 < minY) minY = y1;
    if (x2 > maxX) maxX = x2;
    if (y2 > maxY) maxY = y2;
  }
  return [minX, minY, maxX, maxY];
};

/**
 * Genera un buffer circular aproximado (polígono de N lados) a una distancia
 * en metros desde un centro lon/lat. Útil para fallback de "comuna como
 * polígono" en regiones cuando no tenemos GeoJSON real.
 */
export const circularBuffer = (
  center: Position,
  radiusMeters: number,
  steps = 32,
): Polygon => {
  const [lng, lat] = center;
  const latRad = (lat * Math.PI) / 180;
  // Aproximación: 1° lat ≈ 111,320 m ; 1° lng ≈ 111,320 * cos(lat) m
  const dLat = radiusMeters / 111_320;
  const dLng = radiusMeters / (111_320 * Math.cos(latRad));
  const ring: Position[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  return { type: "Polygon", coordinates: [ring] };
};

/**
 * Área aproximada de un polígono en m² (proyección equirectangular local).
 * Suficientemente precisa para isócronas urbanas (<10 km radio).
 */
export const polygonAreaM2 = (polygon: Polygon | MultiPolygon): number => {
  const polys =
    polygon.type === "Polygon" ? [polygon.coordinates] : polygon.coordinates;
  let total = 0;
  for (const poly of polys) {
    const [outer, ...holes] = poly;
    total += ringAreaM2(outer);
    for (const hole of holes) total -= ringAreaM2(hole);
  }
  return Math.abs(total);
};

const ringAreaM2 = (ring: Position[]): number => {
  if (ring.length < 3) return 0;
  // Tomamos la latitud media para corregir longitudes.
  let sumLat = 0;
  for (const [, y] of ring) sumLat += y;
  const refLat = sumLat / ring.length;
  const cosLat = Math.cos((refLat * Math.PI) / 180);
  const mPerDegLng = 111_320 * cosLat;
  const mPerDegLat = 110_540;
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    area += (xj * mPerDegLng) * (yi * mPerDegLat);
    area -= (xi * mPerDegLng) * (yj * mPerDegLat);
  }
  return area / 2;
};
