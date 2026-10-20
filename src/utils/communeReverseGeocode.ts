import type { Feature, FeatureCollection, Polygon, MultiPolygon } from "geojson";
import { polygonBbox } from "@/utils/spatial";
import { parseCsvLine } from "@/utils/csv";

/**
 * Reverse geocoding cliente: dado lat/lng → nombre de comuna chilena.
 *
 * Estrategia:
 *  1. Carga (con caché) /comunas.geojson (345 comunas, ~11 MB) y
 *     /codigos_territoriales.csv (códigos → nombres).
 *  2. Construye un índice bbox → features para acelerar (un punto solo
 *     puede caer dentro de comunas cuyo bbox lo contenga).
 *  3. Para cada query, filtra por bbox y luego point-in-polygon hasta
 *     encontrar la comuna que contiene el punto.
 *
 * No usa Leaflet (a diferencia de useComunasGeoIndex.ts que sí), así
 * que se puede llamar desde cualquier servicio/hook sin dependencias React.
 */

interface ComunaProps {
  codigo_comuna?: string;
  cod_comuna?: string;
  nom_comuna?: string;
}

type ComunaFeature = Feature<Polygon | MultiPolygon, ComunaProps>;
type ComunaFC = FeatureCollection<Polygon | MultiPolygon, ComunaProps>;

interface ResolvedComuna {
  name: string;             // Nombre oficial de la comuna ("Macul", "Las Condes")
  codigo: string;           // Código INE de 5 dígitos ("13110")
  region_codigo: string;    // Código región (primeros 2 dígitos del código comuna)
  feature: ComunaFeature;
}

interface IndexedFeature {
  feature: ComunaFeature;
  bbox: [number, number, number, number];
  name: string;
  codigo: string;
}

let cache: {
  features: IndexedFeature[];
} | null = null;
let inflight: Promise<{ features: IndexedFeature[] }> | null = null;

/* ---------- Spatial helpers ---------- */

const pointInRing = (pt: [number, number], ring: number[][]): boolean => {
  const [x, y] = pt;
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

const pointInPoly = (pt: [number, number], geom: Polygon | MultiPolygon): boolean => {
  if (geom.type === "Polygon") {
    const [outer, ...holes] = geom.coordinates;
    if (!pointInRing(pt, outer)) return false;
    for (const hole of holes) if (pointInRing(pt, hole)) return false;
    return true;
  }
  for (const poly of geom.coordinates) {
    const [outer, ...holes] = poly;
    if (!pointInRing(pt, outer)) continue;
    let inHole = false;
    for (const hole of holes) {
      if (pointInRing(pt, hole)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
};

const inBbox = (
  pt: [number, number],
  bbox: [number, number, number, number],
): boolean => {
  const [w, s, e, n] = bbox;
  return pt[0] >= w && pt[0] <= e && pt[1] >= s && pt[1] <= n;
};

/* ---------- Carga del índice ---------- */

const loadIndex = async (): Promise<{ features: IndexedFeature[] }> => {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const [geoRes, csvRes] = await Promise.all([
      fetch("/comunas.geojson"),
      fetch("/codigos_territoriales.csv"),
    ]);
    if (!geoRes.ok) throw new Error(`comunas.geojson HTTP ${geoRes.status}`);

    const fc = (await geoRes.json()) as ComunaFC;
    const csvText = await csvRes.text();

    // Parse CSV: region_id,region_name,province_id,province_name,commune_id,commune_name
    const nameByCode: Record<string, string> = {};
    const lines = csvText.trim().split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols.length < 6) continue;
      const codigo = cols[4]?.trim();
      const nombre = cols[5]?.trim();
      if (codigo && nombre) nameByCode[codigo] = nombre;
    }

    const features: IndexedFeature[] = [];
    for (const f of fc.features) {
      if (!f.geometry) continue;
      const codigo =
        f.properties?.codigo_comuna ?? f.properties?.cod_comuna ?? "";
      const name = nameByCode[codigo] ?? f.properties?.nom_comuna ?? "";
      if (!codigo || !name) continue;
      features.push({
        feature: f,
        bbox: polygonBbox(f.geometry),
        name,
        codigo,
      });
    }

    cache = { features };
    inflight = null;
    return cache;
  })().catch((e) => {
    inflight = null;
    throw e;
  });
  return inflight;
};

/* ---------- API pública ---------- */

/**
 * Resuelve lat/lng → comuna chilena. Devuelve null si el punto está
 * fuera de Chile (mar, frontera, error de captura).
 */
export const reverseGeocodeCommune = async (
  lat: number,
  lng: number,
): Promise<ResolvedComuna | null> => {
  const { features } = await loadIndex();
  const pt: [number, number] = [lng, lat];

  // Filtro rápido por bbox (evita point-in-polygon contra 345 features).
  const candidates = features.filter((f) => inBbox(pt, f.bbox));
  for (const c of candidates) {
    if (pointInPoly(pt, c.feature.geometry)) {
      return {
        name: c.name,
        codigo: c.codigo,
        region_codigo: c.codigo.slice(0, 2),
        feature: c.feature,
      };
    }
  }
  return null;
};

/**
 * Devuelve true si el punto cae en la Región Metropolitana (código región 13).
 */
export const isRmByCoords = async (lat: number, lng: number): Promise<boolean> => {
  const r = await reverseGeocodeCommune(lat, lng);
  return r?.region_codigo === "13";
};

/**
 * Helper para uso desde el batch: resuelve comuna + flag RM en una sola pasada.
 * Si el reverse-geocode falla (punto en mar, etc.), permite un fallback usando
 * el campo `Zona` de los atributos del POI (ej. "RM1", "RM2" → RM; otros → regiones).
 */
export const resolveCommuneAndRegion = async (
  lat: number,
  lng: number,
  zonaFallback?: string | null,
): Promise<{ comuna: string | null; isRm: boolean; codigo: string | null }> => {
  const r = await reverseGeocodeCommune(lat, lng);
  if (r) {
    return {
      comuna: r.name,
      codigo: r.codigo,
      isRm: r.region_codigo === "13",
    };
  }
  // Fallback: usar Zona ("RM1" → RM)
  if (zonaFallback) {
    const isRm = /^rm\d?$/i.test(zonaFallback.trim());
    return { comuna: null, codigo: null, isRm };
  }
  return { comuna: null, codigo: null, isRm: false };
};

/* ---------- Nombres oficiales y búsqueda por nombre (los usa el export de locales) ---------- */

/**
 * Clave para comparar nombres de comuna: sin tildes, en minúsculas y sin guiones,
 * apóstrofos ni espacios ("Til Til" y "Tiltil" → "tiltil", "O'Higgins" → "ohiggins").
 * No unifica grafías distintas ("Llay-Llay" vs "Llaillay"): eso lo resuelve el índice
 * al registrar ambos nombres de cada código.
 */
export const communeNameKey = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/**
 * Lee `public/ine_communes.csv` y devuelve código INE (5 dígitos) → nombre con tildes.
 * Solo usa `commune_id` y `commune_name`; ignora el resto de las columnas.
 */
export const parseIneCommuneNames = (csvText: string): Map<string, string> => {
  const lines = csvText.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  const header = parseCsvLine(lines[0] ?? "", ",");
  const idCol = header.indexOf("commune_id");
  const nameCol = header.indexOf("commune_name");
  if (idCol < 0 || nameCol < 0) throw new Error("ine_communes.csv: faltan las columnas commune_id/commune_name");
  const out = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line, ",");
    const id = cols[idCol]?.padStart(5, "0");
    const name = cols[nameCol];
    if (id && name) out.set(id, name);
  }
  return out;
};

let ineNamesPromise: Promise<Map<string, string>> | null = null;

// Se carga aparte de `loadIndex` para que quienes solo hacen reverse geocode no paguen este fetch.
const loadIneNames = (): Promise<Map<string, string>> => {
  ineNamesPromise ??= fetch("/ine_communes.csv")
    .then(async (res) => {
      if (!res.ok) throw new Error(`ine_communes.csv HTTP ${res.status}`);
      return parseIneCommuneNames(await res.text());
    })
    .catch((e) => {
      ineNamesPromise = null;
      throw e;
    });
  return ineNamesPromise;
};

/** Nombre oficial con tildes de una comuna por código INE; null si el código no está en ine_communes.csv. */
export const officialCommuneName = async (codigo: string): Promise<string | null> =>
  (await loadIneNames()).get(codigo.padStart(5, "0")) ?? null;

let codesByKeyPromise: Promise<Map<string, Set<string>>> | null = null;

/** clave de nombre → códigos, con los dos nombres de cada código (ine_communes.csv y codigos_territoriales.csv). */
const loadCodesByKey = (): Promise<Map<string, Set<string>>> => {
  codesByKeyPromise ??= Promise.all([loadIndex(), loadIneNames()])
    .then(([{ features }, ineNames]) => {
      const out = new Map<string, Set<string>>();
      const add = (name: string, codigo: string) => {
        const key = communeNameKey(name);
        if (key) out.set(key, (out.get(key) ?? new Set()).add(codigo));
      };
      for (const f of features) add(f.name, f.codigo);
      for (const [codigo, name] of ineNames) add(name, codigo);
      return out;
    })
    .catch((e) => {
      codesByKeyPromise = null;
      throw e;
    });
  return codesByKeyPromise;
};

/**
 * Códigos de comuna que corresponden a un nombre. Se registran los dos nombres de cada código,
 * así "La Calera"/"Calera" o "Llay-Llay"/"Llaillay" resuelven al mismo código. Vacío si no existe.
 */
export const communeCodesByName = async (name: string): Promise<string[]> => [
  ...((await loadCodesByKey()).get(communeNameKey(name)) ?? []),
];

/** Código de región (2 dígitos) de una comuna por nombre; null si no existe o sus códigos caen en regiones distintas. */
export const regionCodeByCommuneName = async (name: string): Promise<string | null> => {
  const regions = new Set((await communeCodesByName(name)).map((c) => c.slice(0, 2)));
  return regions.size === 1 ? [...regions][0] : null;
};
