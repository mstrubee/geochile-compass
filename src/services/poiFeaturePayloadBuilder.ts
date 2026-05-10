import type { Polygon, MultiPolygon, Feature } from "geojson";
import type { SavedPoi } from "@/types/pois";
import { manzanaService } from "@/services/manzanaService";
import { gseService } from "@/services/gseService";
import { loadIneIndex } from "@/services/ineService";
import { normalizeCommuneName } from "@/services/communeDataService";
import { polygonBbox, polygonCentroid } from "@/utils/spatial";
import {
  compileRules,
  matchRule,
  type CompiledRule,
} from "@/services/analysisSettingsService";
import type { AnalysisSettings, ComplementWeightRule } from "@/types/analysis";
import type { GseClass, GseFeature } from "@/types/gse";
import { resolveCommuneAndRegion } from "@/utils/communeReverseGeocode";

/**
 * Construye el payload para `compute-poi-features` para UN POI.
 *
 * Fuentes de datos territoriales (todas en /public, archivos estáticos):
 *  - /manzanas/<slug>.geojson — Censo 2017, RM, polígonos de manzana con
 *    población y hogares.
 *  - /gse/<slug>.geojson — clasificación GSE fina por bloque (RM only,
 *    overlay sobre las manzanas).
 *  - /comunas.geojson — perímetro real de las 345 comunas (Chile).
 *  - /ine_communes.csv — población, densidad, ingreso, NSE por comuna
 *    (cargado vía ineService).
 *
 * Estrategia:
 *  · POI en RM con manzanas:
 *     1. Cargar manzanas y polígonos GSE en bbox de isócrona.
 *     2. Para cada manzana: spatial join (point-in-polygon de su centroide
 *        contra los polígonos GSE) → asigna NSE preciso por bloque.
 *     3. Población viene del Censo, NSE del overlay.
 *  · POI en regiones:
 *     1. Una sola "celda" por comuna usando polígono real + IneIndex.
 *     2. Si la isócrona se sale de la comuna (raro pero pasa cerca de
 *        bordes), igual incluimos la celda — la edge function asume que
 *        en regiones la celda comuna siempre cuenta.
 */

/* ---------- Constantes de mapeo NSE ---------- */

const GSE_TO_NSE: Record<GseClass, 1 | 2 | 3 | 4 | 5> = {
  E: 1,
  D: 2,
  C3: 3,
  C2: 4,
  C1: 5,
  ABC1: 5,
};

const NSE_INCOME: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 420_000,
  2: 580_000,
  3: 960_000,
  4: 2_100_000,
  5: 5_200_000,
};

const NSE_LABEL_TO_NUM: Record<string, 1 | 2 | 3 | 4 | 5> = {
  E: 1,
  D: 2,
  C3: 3,
  C2: 4,
  C1: 5,
  ABC1: 5,
};

/* ---------- Tipos de payload ---------- */

export interface ManzanaCell {
  id: string;
  pop: number;
  hh: number;
  nse: 1 | 2 | 3 | 4 | 5;
  income: number;
  density: number;
  traffic: number;
  centroid: [number, number];
  area_m2: number;
}

export interface CompetitorPoi {
  id: string;
  lng: number;
  lat: number;
  iso_minutes: number;
  iso_polygon?: Polygon | MultiPolygon;
  source: "internal" | "external";
}

export interface ComplementCandidate {
  id: string;
  lng: number;
  lat: number;
  text: string;
  weight: number;
  label: string;
}

export interface FeaturePayload {
  poi: {
    id: string;
    lng: number;
    lat: number;
    comuna: string | null;
    is_rm: boolean;
    iso_minutes: number;
  };
  iso_polygon: Polygon | MultiPolygon;
  cells: ManzanaCell[];
  competitors: CompetitorPoi[];
  complements: ComplementCandidate[];
  config_version: number;
  use_fine_cannibalization: boolean;
}

/* ---------- Edge function isochrone ---------- */

const fetchIsochrone = async (
  lng: number,
  lat: number,
  minutes: number,
  supabaseUrl: string,
  supabaseAnonKey: string,
  bearer: string,
): Promise<Polygon | MultiPolygon> => {
  const res = await fetch(`${supabaseUrl}/functions/v1/isochrone`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify({ mode: "driving-car", lat, lng, minutes: [minutes] }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`isochrone HTTP ${res.status}: ${t}`);
  }
  const json = (await res.json()) as {
    type: "FeatureCollection";
    features: Array<Feature<Polygon | MultiPolygon, { value: number }>>;
  };
  const feat = json.features?.[0];
  if (!feat?.geometry) throw new Error("isochrone sin geometría");
  return feat.geometry;
};

/* ---------- Spatial helpers locales ---------- */

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

/* ---------- Manzanas RM con overlay GSE ---------- */

const buildRmCells = async (
  isoBbox: [number, number, number, number],
): Promise<ManzanaCell[]> => {
  const [west, south, east, north] = isoBbox;

  const manzanasFc = await manzanaService.fetchManzanas({
    west,
    south,
    east,
    north,
    variable: "density",
    zoom: 14,
  });
  if (!manzanasFc.features.length) return [];

  let gseFeatures: GseFeature[] = [];
  try {
    const gseFc = await gseService.fetchGse({
      west,
      south,
      east,
      north,
      variable: "gse",
      zoom: 14,
    });
    gseFeatures = gseFc.features ?? [];
  } catch {
    // Si GSE falla por algo, continuamos con NSE heredado de comuna.
    gseFeatures = [];
  }

  const cells: ManzanaCell[] = [];
  for (const f of manzanasFc.features) {
    if (!f.geometry) continue;
    const ring =
      f.geometry.type === "Polygon"
        ? f.geometry.coordinates[0]
        : f.geometry.coordinates[0]?.[0] ?? [];
    if (!ring.length) continue;
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    const centroid: [number, number] = [sx / ring.length, sy / ring.length];

    // Intentar overlay GSE para refinar el NSE
    let nse: 1 | 2 | 3 | 4 | 5 = (f.properties.nse as 1 | 2 | 3 | 4 | 5) ?? 3;
    let gseMatched = false;
    for (const g of gseFeatures) {
      if (!g.geometry || !g.properties.gse) continue;
      if (pointInPoly(centroid, g.geometry)) {
        nse = GSE_TO_NSE[g.properties.gse] ?? nse;
        gseMatched = true;
        break;
      }
    }

    cells.push({
      id: f.properties.id,
      pop: f.properties.pop ?? 0,
      hh: f.properties.hh ?? 0,
      nse,
      income: gseMatched ? NSE_INCOME[nse] : (f.properties.income ?? NSE_INCOME[nse]),
      density: f.properties.density,
      traffic: f.properties.traffic ?? 50,
      centroid,
      area_m2: 10_000,
    });
  }
  return cells;
};

/* ---------- Comuna como celda única (regiones, polígono real) ---------- */

interface CommuneFC {
  features: Array<Feature<Polygon | MultiPolygon, { codigo_comuna?: string; cod_comuna?: string }>>;
}

let comunasFcCache: CommuneFC | null = null;
let nameByCodeCache: Record<string, string> | null = null;
let byNameCache: Map<string, Feature<Polygon | MultiPolygon, { codigo_comuna?: string }>> | null = null;

const loadComunasIndex = async (): Promise<{
  byName: Map<string, Feature<Polygon | MultiPolygon, { codigo_comuna?: string }>>;
}> => {
  if (byNameCache) return { byName: byNameCache };

  const [geoRes, csvRes] = await Promise.all([
    fetch("/comunas.geojson"),
    fetch("/codigos_territoriales.csv"),
  ]);
  if (!geoRes.ok) throw new Error("Falta /comunas.geojson");
  comunasFcCache = (await geoRes.json()) as CommuneFC;

  const csvText = await csvRes.text();
  const lineas = csvText.trim().split(/\r?\n/);
  const nameByCode: Record<string, string> = {};
  for (let i = 1; i < lineas.length; i++) {
    const cols = lineas[i].split(",");
    if (cols.length < 6) continue;
    const codigo = cols[4]?.trim();
    const nombre = cols[5]?.trim();
    if (codigo && nombre) nameByCode[codigo] = nombre;
  }
  nameByCodeCache = nameByCode;

  const byName = new Map<string, Feature<Polygon | MultiPolygon, { codigo_comuna?: string }>>();
  for (const f of comunasFcCache.features) {
    const codigo =
      f.properties?.codigo_comuna ?? f.properties?.cod_comuna ?? "";
    const nombre = nameByCode[codigo];
    if (nombre) byName.set(normalizeCommuneName(nombre), f);
  }
  byNameCache = byName;
  return { byName };
};

const buildRegionCells = async (
  poi: SavedPoi,
  comuna: string | null,
): Promise<ManzanaCell[]> => {
  // Si por alguna razón no hay comuna, igual devolvemos UNA celda con
  // valores neutros — preferimos features pobres pero presentes a una
  // celda vacía que rompe todos los agregados.
  if (!comuna) {
    return [
      {
        id: `commune-unknown`,
        pop: 50_000,
        hh: 15_000,
        nse: 3,
        income: NSE_INCOME[3],
        density: 1_000,
        traffic: 50,
        centroid: [poi.lng, poi.lat],
        area_m2: 50_000_000, // 50 km² aproximado
      },
    ];
  }

  const { byName } = await loadComunasIndex();
  const ine = await loadIneIndex();
  const norm = normalizeCommuneName(comuna);
  const feature = byName.get(norm);
  const ineStats = ine.byName.get(norm);

  const pop = ineStats?.poblacion ?? 50_000;
  const density = ineStats?.densidad ?? 1_000;
  const area = ineStats?.superficie_km2 ?? 50;
  const nse: 1 | 2 | 3 | 4 | 5 = ineStats?.nse
    ? NSE_LABEL_TO_NUM[ineStats.nse] ?? 3
    : 3;
  const income = ineStats?.ingreso ?? NSE_INCOME[nse];

  const centroid: [number, number] = feature?.geometry
    ? polygonCentroid(feature.geometry)
    : [poi.lng, poi.lat];

  return [
    {
      id: `commune-${norm}`,
      pop,
      hh: Math.round(pop / 3.2),
      nse,
      income,
      density,
      traffic: 50,
      centroid,
      area_m2: area * 1_000_000,
    },
  ];
};

/* ---------- Filtros bbox ---------- */

const expandBbox = (
  bbox: [number, number, number, number],
  marginMeters: number,
): [number, number, number, number] => {
  const [west, south, east, north] = bbox;
  const refLat = (south + north) / 2;
  const dLat = marginMeters / 111_320;
  const dLng = marginMeters / (111_320 * Math.cos((refLat * Math.PI) / 180));
  return [west - dLng, south - dLat, east + dLng, north + dLat];
};

const inBbox = (
  pt: { lng: number; lat: number },
  bbox: [number, number, number, number],
): boolean => {
  const [w, s, e, n] = bbox;
  return pt.lng >= w && pt.lng <= e && pt.lat >= s && pt.lat <= n;
};

/* ---------- API pública ---------- */

interface BuildPayloadDeps {
  internalPeers: SavedPoi[];
  externalCompetitors: SavedPoi[];
  otherPois: SavedPoi[];
  externalCompetitorLayerFeatures: Array<{ id: string; lng: number; lat: number; name: string; category?: string }>;
  complementaryLayerFeatures: Array<{ id: string; lng: number; lat: number; name: string; category?: string }>;
  settings: AnalysisSettings;
  rules: ComplementWeightRule[];
}

export interface BuildPayloadOptions {
  poi: SavedPoi;
  /** Comuna conocida del POI. Si no se entrega, se resuelve por reverse-geocode lat/lng. */
  comuna?: string | null;
  /** Flag RM conocido. Si no se entrega, se resuelve por reverse-geocode. */
  isRm?: boolean;
  /**
   * Fallback opcional para detección RM si el reverse-geocode falla. Típicamente
   * el valor del atributo "Zona" del POI ("RM1", "RM2" → RM; otros → regiones).
   */
  zonaFallback?: string | null;
  /** Tiempo de isócrona en minutos. Si no se entrega, se calcula con isoMinutesForCommune. */
  isoMinutes?: number;
  /** Configuración para resolver isoMinutes si no viene explícito. */
  isoMinutesRm?: number;
  isoMinutesRegions?: number;
  precomputedIso?: Polygon | MultiPolygon;
  includeCompetitorIsos?: boolean;
  supabaseUrl: string;
  supabaseAnonKey: string;
  bearer: string;
  deps: BuildPayloadDeps;
}

export const buildFeaturePayload = async (
  opts: BuildPayloadOptions,
): Promise<FeaturePayload> => {
  const {
    poi,
    precomputedIso,
    includeCompetitorIsos = false,
    supabaseUrl,
    supabaseAnonKey,
    bearer,
    deps,
    zonaFallback = null,
    isoMinutesRm = 5,
    isoMinutesRegions = 7,
  } = opts;

  // 0) Resolver comuna y flag RM si no vinieron explícitos
  let comuna: string | null = opts.comuna ?? null;
  let isRm: boolean = opts.isRm ?? false;
  let resolved = false;

  if (comuna == null || opts.isRm == null) {
    const r = await resolveCommuneAndRegion(poi.lat, poi.lng, zonaFallback);
    if (comuna == null) comuna = r.comuna;
    if (opts.isRm == null) isRm = r.isRm;
    resolved = true;
  }

  // Resolver minutos según RM/regiones si no vinieron
  const isoMinutes = opts.isoMinutes ?? (isRm ? isoMinutesRm : isoMinutesRegions);

  // Diagnóstico (visible solo en consola; ayuda al admin a verificar)
  if (resolved) {
    console.debug(
      `[features] poi=${poi.name} resolved: comuna=${comuna ?? "?"}, isRm=${isRm}, iso=${isoMinutes}min`,
    );
  }

  // 1) Isócrona del POI
  const iso =
    precomputedIso ??
    (await fetchIsochrone(poi.lng, poi.lat, isoMinutes, supabaseUrl, supabaseAnonKey, bearer));

  // 2) Bbox de la isócrona
  const bbox = polygonBbox(iso);
  const expanded = expandBbox(bbox, 1500);

  // 3) Celdas: manzanas+GSE en RM, comuna real en regiones.
  //    Si RM y manzanas dan 0 → fallback a celda comuna del IneIndex.
  let cells: ManzanaCell[] = [];
  if (isRm) {
    cells = await buildRmCells(bbox);
    if (!cells.length) {
      cells = await buildRegionCells(poi, comuna);
    }
  } else {
    cells = await buildRegionCells(poi, comuna);
  }

  // 4) Competidores internos cercanos
  const internalPeers = deps.internalPeers
    .filter((p) => p.id !== poi.id)
    .filter((p) => inBbox(p, expanded));

  const competitors: CompetitorPoi[] = [];

  if (includeCompetitorIsos) {
    for (const p of internalPeers) {
      try {
        const peerIso = await fetchIsochrone(
          p.lng,
          p.lat,
          isoMinutes,
          supabaseUrl,
          supabaseAnonKey,
          bearer,
        );
        competitors.push({
          id: p.id,
          lng: p.lng,
          lat: p.lat,
          iso_minutes: isoMinutes,
          iso_polygon: peerIso,
          source: "internal",
        });
      } catch {
        competitors.push({
          id: p.id,
          lng: p.lng,
          lat: p.lat,
          iso_minutes: isoMinutes,
          source: "internal",
        });
      }
    }
  } else {
    for (const p of internalPeers) {
      competitors.push({
        id: p.id,
        lng: p.lng,
        lat: p.lat,
        iso_minutes: isoMinutes,
        source: "internal",
      });
    }
  }

  // 5) Competidores externos (folders y layer features)
  for (const p of deps.externalCompetitors.filter((p) => inBbox(p, expanded))) {
    competitors.push({
      id: p.id,
      lng: p.lng,
      lat: p.lat,
      iso_minutes: isoMinutes,
      source: "external",
    });
  }
  for (const f of deps.externalCompetitorLayerFeatures.filter((f) => inBbox(f, expanded))) {
    competitors.push({
      id: f.id,
      lng: f.lng,
      lat: f.lat,
      iso_minutes: isoMinutes,
      source: "external",
    });
  }

  // 6) Complementarios con regex
  const compiled: CompiledRule[] = compileRules(deps.rules);
  const complements: ComplementCandidate[] = [];
  for (const p of deps.otherPois.filter((p) => inBbox(p, expanded))) {
    const text = `${p.name ?? ""} ${p.category ?? ""}`.trim();
    const m = matchRule(text, compiled);
    complements.push({
      id: p.id,
      lng: p.lng,
      lat: p.lat,
      text,
      weight: m.weight,
      label: m.label,
    });
  }
  for (const f of deps.complementaryLayerFeatures.filter((f) => inBbox(f, expanded))) {
    const text = `${f.name ?? ""} ${f.category ?? ""}`.trim();
    const m = matchRule(text, compiled);
    complements.push({
      id: f.id,
      lng: f.lng,
      lat: f.lat,
      text,
      weight: m.weight,
      label: m.label,
    });
  }

  return {
    poi: {
      id: poi.id,
      lng: poi.lng,
      lat: poi.lat,
      comuna,
      is_rm: isRm,
      iso_minutes: isoMinutes,
    },
    iso_polygon: iso,
    cells,
    competitors,
    complements,
    config_version: deps.settings.config_version,
    use_fine_cannibalization: deps.settings.use_fine_cannibalization,
  };
};
