import type { FeatureCollection, Feature, Point } from "geojson";

/**
 * OpenStreetMap Overpass API service.
 * Queries POIs within a bounding box, returns GeoJSON Point features.
 */

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export type OverpassPreset = {
  id: string;
  label: string;
  /** Overpass union body — without enclosing `(` `);` and bbox.
   *  Use `__BBOX__` placeholder where bbox should be inserted. */
  query: string;
};

export const OVERPASS_PRESETS: OverpassPreset[] = [
  {
    id: "supermarket",
    label: "Supermercados",
    query: `
      node["shop"="supermarket"](__BBOX__);
      way["shop"="supermarket"](__BBOX__);
      relation["shop"="supermarket"](__BBOX__);
    `,
  },
  {
    id: "pharmacy",
    label: "Farmacias",
    query: `
      node["amenity"="pharmacy"](__BBOX__);
      way["amenity"="pharmacy"](__BBOX__);
      node["shop"="chemist"](__BBOX__);
    `,
  },
  {
    id: "restaurant",
    label: "Restaurantes",
    query: `
      node["amenity"="restaurant"](__BBOX__);
      way["amenity"="restaurant"](__BBOX__);
      node["amenity"="fast_food"](__BBOX__);
    `,
  },
  {
    id: "car_repair",
    label: "Talleres automotrices",
    query: `
      node["shop"="car_repair"](__BBOX__);
      way["shop"="car_repair"](__BBOX__);
      node["amenity"="car_repair"](__BBOX__);
    `,
  },
];

export interface OverpassBbox {
  /** [south, west, north, east] */
  south: number;
  west: number;
  north: number;
  east: number;
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

function buildPresetQuery(preset: OverpassPreset, bbox: OverpassBbox): string {
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  const body = preset.query.replace(/__BBOX__/g, bboxStr);
  return `[out:json][timeout:25];(${body});out center tags;`;
}

/**
 * Build a query for free-text shop/amenity search.
 * Matches against name, shop, amenity, cuisine and brand using a case-insensitive regex.
 */
function buildFreeTextQuery(text: string, bbox: OverpassBbox): string {
  const bboxStr = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  // Escape regex special characters
  const safe = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = `"${safe}",i`;
  return `[out:json][timeout:25];
(
  node["name"~${re}](${bboxStr});
  way["name"~${re}](${bboxStr});
  node["shop"~${re}](${bboxStr});
  way["shop"~${re}](${bboxStr});
  node["amenity"~${re}](${bboxStr});
  way["amenity"~${re}](${bboxStr});
  node["brand"~${re}](${bboxStr});
  way["brand"~${re}](${bboxStr});
  node["cuisine"~${re}](${bboxStr});
);
out center tags;`;
}

async function runQuery(query: string, signal?: AbortSignal): Promise<OverpassResponse> {
  let lastErr: unknown = null;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal,
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      return (await res.json()) as OverpassResponse;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("No se pudo conectar con Overpass API");
}

/**
 * Map de cadenas conocidas → dominio para obtener logo desde Clearbit/Google favicons.
 * La key se compara en minúsculas contra brand/name normalizados.
 */
const BRAND_DOMAINS: Record<string, string> = {
  // Supermercados Chile
  "jumbo": "jumbo.cl",
  "lider": "lider.cl",
  "líder": "lider.cl",
  "santa isabel": "santaisabel.cl",
  "unimarc": "unimarc.cl",
  "tottus": "tottus.cl",
  "ekono": "ekono.cl",
  "acuenta": "acuenta.cl",
  "mayorista 10": "mayorista10.cl",
  "construmart": "construmart.cl",
  // Farmacias
  "cruz verde": "cruzverde.cl",
  "salcobrand": "salcobrand.cl",
  "ahumada": "farmaciasahumada.cl",
  "farmacias ahumada": "farmaciasahumada.cl",
  "dr. simi": "drsimi.cl",
  "dr simi": "drsimi.cl",
  // Restaurantes / fast food
  "mcdonald's": "mcdonalds.cl",
  "mcdonalds": "mcdonalds.cl",
  "burger king": "burgerking.cl",
  "kfc": "kfc.cl",
  "starbucks": "starbucks.cl",
  "subway": "subway.com",
  "domino's": "dominos.cl",
  "dominos": "dominos.cl",
  "pizza hut": "pizzahut.cl",
  "papa john's": "papajohns.cl",
  "telepizza": "telepizza.cl",
  "doggis": "doggis.cl",
  "juan maestro": "juanmaestro.cl",
  "schop dog": "schopdog.cl",
  // Talleres / autos
  "copec": "copec.cl",
  "shell": "shell.cl",
  "petrobras": "petrobras.cl",
  "enex": "enex.cl",
  // Tiendas
  "falabella": "falabella.com",
  "paris": "paris.cl",
  "ripley": "ripley.cl",
  "la polar": "lapolar.cl",
  "sodimac": "sodimac.cl",
  "easy": "easy.cl",
  "homecenter": "sodimac.cl",
};

function normalizeBrand(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function brandLogoUrl(tags: Record<string, string>): string | null {
  const candidates = [tags.brand, tags["brand:en"], tags.name, tags["name:es"], tags.operator];
  for (const c of candidates) {
    if (!c) continue;
    const norm = normalizeBrand(c);
    // exact match
    if (BRAND_DOMAINS[norm]) return `https://logo.clearbit.com/${BRAND_DOMAINS[norm]}`;
    // partial match (eg "Farmacia Cruz Verde Centro")
    for (const key of Object.keys(BRAND_DOMAINS)) {
      if (norm.includes(key)) return `https://logo.clearbit.com/${BRAND_DOMAINS[key]}`;
    }
  }
  // wikidata logo via brand:wikidata? skip — keep simple
  return null;
}

function elementsToFeatureCollection(
  elements: OverpassElement[],
  category: string,
): FeatureCollection {
  const features: Feature<Point>[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;
    const tags = el.tags ?? {};
    const name =
      tags.name ||
      tags.brand ||
      tags["name:es"] ||
      tags.operator ||
      `${category} #${el.id}`;
    const logo = brandLogoUrl(tags);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: {
        ...tags,
        name,
        osm_type: el.type,
        osm_id: el.id,
        category,
        ...(logo ? { icon: logo, "icon-scale": 0.9 } : {}),
      },
    });
  }
  return { type: "FeatureCollection", features };
}

export async function fetchOverpassPreset(
  presetId: string,
  bbox: OverpassBbox,
  signal?: AbortSignal,
): Promise<FeatureCollection> {
  const preset = OVERPASS_PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error(`Preset desconocido: ${presetId}`);
  const q = buildPresetQuery(preset, bbox);
  const r = await runQuery(q, signal);
  return elementsToFeatureCollection(r.elements, preset.label);
}

export async function fetchOverpassFreeText(
  text: string,
  bbox: OverpassBbox,
  signal?: AbortSignal,
): Promise<FeatureCollection> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Texto vacío");
  const q = buildFreeTextQuery(trimmed, bbox);
  const r = await runQuery(q, signal);
  return elementsToFeatureCollection(r.elements, trimmed);
}

/** Quick area sanity check — Overpass rejects huge bboxes, warn early. */
export function bboxAreaDegSq(bbox: OverpassBbox): number {
  return Math.abs((bbox.north - bbox.south) * (bbox.east - bbox.west));
}
