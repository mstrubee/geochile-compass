/**
 * parseGeoFile.ts
 * ────────────────
 * Parsea archivos CSV, GeoJSON y KML a un GeoJSON FeatureCollection estándar.
 * Usado por el admin para subir capas personalizadas al mapa.
 */

import type { FeatureCollection, Feature, Point, Geometry } from "geojson";

export type GeoFileFormat = "csv" | "geojson" | "kml";

/** Detecta el formato por extensión. */
export function detectGeoFormat(filename: string): GeoFileFormat | null {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "csv") return "csv";
  if (ext === "geojson" || ext === "json") return "geojson";
  if (ext === "kml") return "kml";
  return null;
}

// ── CSV ───────────────────────────────────────────────────────────────────────

const LAT_ALIASES = ["lat", "latitude", "latitud", "y", "latitude_deg"];
const LNG_ALIASES = ["lng", "lon", "long", "longitude", "longitud", "x", "longitude_deg"];

/** Parsea una línea CSV respetando campos entre comillas. */
function parseCsvLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === sep && !inQ) {
      result.push(cur.trim());
      cur = "";
    } else {
      cur += c;
    }
  }
  result.push(cur.trim());
  return result;
}

export function csvToGeoJSON(text: string): FeatureCollection {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(Boolean);
  if (lines.length < 2) throw new Error("CSV vacío o sin datos");

  // Detectar separador: ; vs ,
  const sep = (lines[0].split(";").length > lines[0].split(",").length) ? ";" : ",";

  const rawHeaders = parseCsvLine(lines[0], sep);
  const headers = rawHeaders.map((h) => h.toLowerCase().replace(/^["']|["']$/g, "").trim());

  const latIdx = headers.findIndex((h) => LAT_ALIASES.includes(h));
  const lngIdx = headers.findIndex((h) => LNG_ALIASES.includes(h));

  if (latIdx === -1 || lngIdx === -1) {
    throw new Error(
      `No se encontraron columnas de coordenadas.\n` +
      `Latitud esperada: ${LAT_ALIASES.join(", ")}\n` +
      `Longitud esperada: ${LNG_ALIASES.join(", ")}\n` +
      `Columnas encontradas: ${headers.join(", ")}`,
    );
  }

  const features: Feature<Point>[] = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i], sep);
    const lat = parseFloat(row[latIdx] ?? "");
    const lng = parseFloat(row[lngIdx] ?? "");
    if (isNaN(lat) || isNaN(lng)) { skipped++; continue; }

    const props: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (idx !== latIdx && idx !== lngIdx && h) {
        props[h] = (row[idx] ?? "").replace(/^["']|["']$/g, "");
      }
    });

    features.push({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: props });
  }

  if (features.length === 0) throw new Error("No se encontraron coordenadas válidas en el CSV");
  if (skipped > 0) console.warn(`parseGeoFile: ${skipped} filas ignoradas por coordenadas inválidas`);

  return { type: "FeatureCollection", features };
}

// ── KML ───────────────────────────────────────────────────────────────────────

export function kmlToGeoJSON(kmlText: string): FeatureCollection {
  const parser = new DOMParser();
  const doc = parser.parseFromString(kmlText, "application/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) throw new Error("KML inválido: " + parseError.textContent?.slice(0, 120));

  const placemarks = Array.from(doc.querySelectorAll("Placemark"));
  if (placemarks.length === 0) throw new Error("No se encontraron Placemarks en el KML");

  const features: Feature[] = placemarks.flatMap((pm) => {
    const name = pm.querySelector("name")?.textContent?.trim() ?? "";
    const desc = pm.querySelector("description")?.textContent?.trim() ?? "";
    const props: Record<string, string> = {};
    if (name) props.name = name;
    if (desc) props.description = desc;

    // Extended data (SimpleData fields)
    pm.querySelectorAll("SimpleData").forEach((sd) => {
      const key = sd.getAttribute("name");
      if (key) props[key] = sd.textContent?.trim() ?? "";
    });

    const parseCoordsStr = (raw: string): number[][] =>
      raw.trim().split(/\s+/).map((c) => {
        const parts = c.split(",").map(Number);
        return [parts[0], parts[1]]; // [lng, lat]
      }).filter(([lng, lat]) => !isNaN(lng) && !isNaN(lat));

    // Point
    const ptCoords = pm.querySelector("Point > coordinates")?.textContent;
    if (ptCoords) {
      const [[lng, lat]] = parseCoordsStr(ptCoords);
      return [{ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [lng, lat] } as Geometry, properties: props }];
    }

    // LineString
    const lsCoords = pm.querySelector("LineString > coordinates")?.textContent;
    if (lsCoords) {
      return [{ type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: parseCoordsStr(lsCoords) } as Geometry, properties: props }];
    }

    // Polygon
    const polyCoords = pm.querySelector("outerBoundaryIs LinearRing coordinates")?.textContent;
    if (polyCoords) {
      return [{ type: "Feature" as const, geometry: { type: "Polygon" as const, coordinates: [parseCoordsStr(polyCoords)] } as Geometry, properties: props }];
    }

    return [];
  });

  if (features.length === 0) throw new Error("El KML no contiene geometrías reconocibles (Point, LineString, Polygon)");
  return { type: "FeatureCollection", features };
}

// ── GeoJSON ───────────────────────────────────────────────────────────────────

export function normalizeGeoJSON(text: string): FeatureCollection {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("JSON inválido"); }

  const obj = parsed as { type?: string; features?: unknown[]; geometry?: unknown; coordinates?: unknown };

  if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
    return parsed as FeatureCollection;
  }
  if (obj.type === "Feature") {
    return { type: "FeatureCollection", features: [parsed as Feature] };
  }
  // GeometryCollection o geometría suelta → envolver
  if (obj.type && obj.coordinates) {
    return { type: "FeatureCollection", features: [{ type: "Feature", geometry: parsed as Geometry, properties: {} }] };
  }
  throw new Error(`GeoJSON inválido: tipo "${obj.type}" no reconocido`);
}

// ── Punto de entrada ──────────────────────────────────────────────────────────

export function parseGeoFileContent(text: string, format: GeoFileFormat): FeatureCollection {
  switch (format) {
    case "csv":     return csvToGeoJSON(text);
    case "kml":     return kmlToGeoJSON(text);
    case "geojson": return normalizeGeoJSON(text);
  }
}
