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
import { isoMinutesForCommune } from "@/data/rmCommunes";
import type { GseClass, GseFeature } from "@/types/gse";
import { GSE_INCOME } from "@/data/gseIncome";
import { resolveCommuneAndRegion } from "@/utils/communeReverseGeocode";
import { supabase } from "@/integrations/supabase/client";
import area from "@turf/area";
import { computeTerritorialExtras } from "@/services/territorialExtras";
import { crimeService } from "@/services/crimeService";

/* ---------- Mapeo rol territorial → peso (folder_layer_roles) ----------
 * Defaults hardcoded para Sprint 3 Tarea 3. Si una capa NO tiene rol
 * asignado (ni por layer_id ni por group_id) la ignoramos: NO se asume
 * "complementario default" — sería peligroso (ej: 46k features SII).
 */
// Sprint 3 Tarea 3 - DESACTIVADO temporalmente.
// El cálculo nuevo desestabiliza el modelo Ridge.
// Reactivar en Sprint 4 con normalización por área.
// Cuando la carpeta no tiene roles configurados, `buildFromFolderRoles`
// devuelve null y se sigue usando la lógica antigua, así que habilitarlo no
// cambia nada en ese caso. Con roles configurados, es la única forma de que
// `complement_score` signifique lo mismo en los comparables y en la isócrona
// analizada (ver `computeComplementScoreInPolygon`).
const ENABLE_FOLDER_LAYER_ROLES = true;

const ROLE_WEIGHTS_BUILDER = {
  competencia: -1.0,
  complementario: 0.5,
  ancla: 1.5,
  irrelevante: 0.0,
} as const;
type BuilderRole = keyof typeof ROLE_WEIGHTS_BUILDER;

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
  /** Riesgo delictivo 0-1 (overlay GSE manzana). Opcional — solo RM. */
  crime_score?: number | null;
  /** Clase GSE real (ABC1…E) del overlay. Opcional. Permite EPF preciso. */
  gse_class?: import("@/types/gse").GseClass | null;
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
  /** Subconjunto de complements con role='ancla'. Hoy la edge function no lo
   *  consume todavía (Fase 3b lo agrega como anchor_score). */
  anchors: ComplementCandidate[];
  config_version: number;
  use_fine_cannibalization: boolean;
  /** Features derivados de capas nuevas (crime, comercio, gasto endógeno).
   *  Pre-calculados en el cliente; la edge los fusiona en `features`. */
  territorial_extras?: Record<string, number>;
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

    // Overlay GSE para refinar NSE + capturar crime_score, gse_class y n_hog/n_per
    let nse: 1 | 2 | 3 | 4 | 5 = (f.properties.nse as 1 | 2 | 3 | 4 | 5) ?? 3;
    let gseMatched = false;
    let gseClass: import("@/types/gse").GseClass | null = null;
    let crimeScore: number | null = null;
    let gseNHog: number | null = null;  // n_hog del GSE Censo 2024 (más reciente que INE 2017)
    let gseNPer: number | null = null;
    for (const g of gseFeatures) {
      if (!g.geometry || !g.properties.gse) continue;
      if (pointInPoly(centroid, g.geometry)) {
        nse = GSE_TO_NSE[g.properties.gse] ?? nse;
        gseClass = g.properties.gse;
        const gp = g.properties as unknown as Record<string, unknown>;
        if (typeof gp["crime_score"] === "number") crimeScore = gp["crime_score"] as number;
        // Preferir datos de hogares/personas del Censo 2024 (GSE) sobre el INE 2017
        if (typeof gp["n_hog"] === "number" && gp["n_hog"] > 0) gseNHog = gp["n_hog"] as number;
        if (typeof gp["n_per"] === "number" && gp["n_per"] > 0) gseNPer = gp["n_per"] as number;
        gseMatched = true;
        break;
      }
    }

    // Usar datos Censo 2024 (GSE) si están disponibles; fallback a INE 2017
    // Nota: si n_hog del GSE es null (manzana sin datos), usar INE.
    // Si n_hog del GSE es 0 (parque/baldío confirmado), respetar el 0.
    const ineHh  = f.properties.hh  ?? 0;
    const inePop = f.properties.pop ?? 0;
    const finalHh  = gseNHog !== null ? gseNHog : ineHh;
    const finalPop = gseNPer !== null ? gseNPer : inePop;

    cells.push({
      id: f.properties.id,
      pop: finalPop,
      hh:  finalHh,
      nse,
      // Con clase GSE conocida se usa la tabla canónica de 6 clases: NSE_INCOME
      // solo tiene 5 niveles y colapsaba C1 en ABC1, cobrándole a un hogar C1
      // el ingreso de uno ABC1. El análisis de isócronas usa esta misma tabla,
      // así que ambos lados del modelo quedan en la misma escala.
      income: gseMatched && gseClass
        ? GSE_INCOME[gseClass]
        : (f.properties.income ?? NSE_INCOME[nse]),
      // Densidad sobre el área real de la manzana. `f.properties.density` la
      // calcula asumiendo una superficie fija de 0,01 km² para toda manzana;
      // las celdas GSE de regiones usan el área real, así que con la fórmula
      // vieja la densidad de RM y regiones no sería comparable entre sí.
      density: finalPop / (Math.max(1, area(f as never)) / 1_000_000),
      traffic: f.properties.traffic ?? 50,
      centroid,
      area_m2: 10_000,
      crime_score: crimeScore,
      gse_class: gseClass,
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

/**
 * Celdas construidas desde manzanas GSE (Censo 2024), disponibles para las 334
 * comunas del país. Se usa fuera de la RM, donde no hay manzanas INE.
 *
 * Sin esto, un POI regional se medía con UNA sola celda igual a la comuna
 * entera: `pop_total` terminaba siendo la población comunal completa (no la de
 * la isócrona) y `nse_high_pct` solo podía dar 0% o 100%, porque con una única
 * celda el promedio ponderado es binario.
 *
 * El filtrado por centroide se hace ACÁ y no en la edge function: esa solo
 * filtra por isócrona cuando el POI es de la RM (`poi.is_rm`), así que mandar
 * las manzanas sin filtrar sumaría todas las del bbox.
 */
const buildGseCells = async (
  iso: Polygon | MultiPolygon,
  isoBbox: [number, number, number, number],
): Promise<ManzanaCell[]> => {
  const [west, south, east, north] = isoBbox;
  let features: GseFeature[] = [];
  try {
    const fc = await gseService.fetchGse({
      west, south, east, north,
      variable: "gse",
      zoom: 14,
      maxFeatures: 200_000,
    });
    features = fc.features ?? [];
  } catch {
    return [];
  }

  const cells: ManzanaCell[] = [];
  for (const f of features) {
    if (!f.geometry || !f.properties.gse) continue;
    const ring =
      f.geometry.type === "Polygon"
        ? f.geometry.coordinates[0]
        : f.geometry.coordinates[0]?.[0] ?? [];
    if (!ring.length) continue;
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) { sx += x; sy += y; }
    const centroid: [number, number] = [sx / ring.length, sy / ring.length];
    if (!pointInPoly(centroid, iso)) continue;

    const gseClass = f.properties.gse;
    const p = f.properties as unknown as Record<string, unknown>;
    const pop = typeof p["n_per"] === "number" ? p["n_per"] : 0;
    const hh  = typeof p["n_hog"] === "number" ? p["n_hog"] : 0;
    const areaM2 = Math.max(1, area(f as never));

    cells.push({
      id: String(f.properties.id ?? `${centroid[0]},${centroid[1]}`),
      pop,
      hh,
      nse: GSE_TO_NSE[gseClass] ?? 3,
      income: GSE_INCOME[gseClass],
      density: pop / (areaM2 / 1_000_000),
      traffic: 50,
      centroid,
      area_m2: areaM2,
      crime_score: typeof p["crime_score"] === "number" ? (p["crime_score"] as number) : null,
      gse_class: gseClass,
    });
  }
  return cells;
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

  const centroidPos = feature?.geometry
    ? polygonCentroid(feature.geometry)
    : [poi.lng, poi.lat];
  const centroid: [number, number] = [centroidPos[0] ?? poi.lng, centroidPos[1] ?? poi.lat];

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

/* ---------- Lógica nueva: folder_layer_roles → buckets ---------- */

interface RoleBuckets {
  competitors: CompetitorPoi[];
  complements: ComplementCandidate[];
  anchors: ComplementCandidate[];
}

/**
 * Si la carpeta tiene roles configurados en folder_layer_roles, esta función
 * devuelve los buckets (competitors / complements / anchors) derivados de
 * territorial_features filtrados por isócrona.
 *
 * Retorna null si la carpeta NO tiene roles → caller debe usar la lógica
 * vieja (analysis_settings.external_competition_* + complement_weight_rules).
 *
 * Herencia: layer_id override > group_id de la categoría. Capas sin rol
 * asignado se IGNORAN (no default complementario).
 */
const buildFromFolderRoles = async (
  folderId: string,
  iso: Polygon | MultiPolygon,
  isoBbox: [number, number, number, number],
  isoMinutes: number,
): Promise<RoleBuckets | null> => {
  const { data: roles, error: rolesErr } = await supabase
    .from("folder_layer_roles")
    .select("layer_id, group_id, role, weight_override")
    .eq("folder_id", folderId);
  if (rolesErr) throw rolesErr;
  if (!roles || roles.length === 0) return null;

  const byLayer = new Map<string, { role: string; weight_override: number | null }>();
  const byGroup = new Map<string, { role: string; weight_override: number | null }>();
  for (const r of roles) {
    const rec = { role: r.role, weight_override: r.weight_override };
    if (r.layer_id) byLayer.set(r.layer_id, rec);
    else if (r.group_id) byGroup.set(r.group_id, rec);
  }

  const { data: layers, error: layersErr } = await supabase
    .from("territorial_layers")
    .select("id, group_id, name");
  if (layersErr) throw layersErr;

  const layerResolved = new Map<string, { role: BuilderRole; weight: number; label: string }>();
  for (const l of layers ?? []) {
    const eff = byLayer.get(l.id) ?? (l.group_id ? byGroup.get(l.group_id) : null);
    if (!eff) continue; // capa sin rol → ignorada (conservador)
    const role = eff.role as BuilderRole;
    if (!(role in ROLE_WEIGHTS_BUILDER)) continue;
    const weight =
      eff.weight_override ?? ROLE_WEIGHTS_BUILDER[role] ?? 0;
    layerResolved.set(l.id, { role, weight, label: l.name ?? role });
  }

  const relevantLayerIds = [...layerResolved.entries()]
    .filter(([, v]) => v.role !== "irrelevante")
    .map(([id]) => id);

  if (relevantLayerIds.length === 0) {
    return { competitors: [], complements: [], anchors: [] };
  }

  const [w, s, e, n] = isoBbox;
  const { data: feats, error: featsErr } = await supabase
    .from("territorial_features")
    .select("id, layer_id, lat, lng, name")
    .in("layer_id", relevantLayerIds)
    .gte("lng", w).lte("lng", e)
    .gte("lat", s).lte("lat", n);
  if (featsErr) throw featsErr;

  const competitors: CompetitorPoi[] = [];
  const complements: ComplementCandidate[] = [];
  const anchors: ComplementCandidate[] = [];

  for (const f of feats ?? []) {
    if (f.lat == null || f.lng == null) continue;
    if (!pointInPoly([f.lng, f.lat], iso)) continue;
    const meta = layerResolved.get(f.layer_id);
    if (!meta || meta.role === "irrelevante") continue;

    if (meta.role === "competencia") {
      competitors.push({
        id: f.id, lng: f.lng, lat: f.lat,
        iso_minutes: isoMinutes, source: "external",
      });
    } else {
      const cand: ComplementCandidate = {
        id: f.id, lng: f.lng, lat: f.lat,
        text: f.name ?? "",
        weight: meta.weight,
        label: meta.label,
      };
      complements.push(cand);
      if (meta.role === "ancla") anchors.push(cand);
    }
  }

  return { competitors, complements, anchors };
};

/**
 * `complement_score` de un polígono cualquiera, con la MISMA definición que
 * usan los comparables del caché: suma de los pesos por rol de los puntos
 * territoriales que caen dentro.
 *
 * Devuelve null si la carpeta no tiene roles configurados. En ese caso no hay
 * definición común: los comparables se calcularon con la lógica antigua, y
 * medir la isócrona con un conteo crudo de puntos compararía unidades
 * distintas — quien llama debe excluir el feature en vez de inventar un valor.
 */
export const computeComplementScoreInPolygon = async (
  folderId: string,
  iso: Polygon | MultiPolygon,
): Promise<number | null> => {
  if (!ENABLE_FOLDER_LAYER_ROLES) return null;
  try {
    const buckets = await buildFromFolderRoles(folderId, iso, polygonBbox(iso), 0);
    if (!buckets) return null;
    return buckets.complements.reduce((s, c) => s + c.weight, 0);
  } catch {
    return null;
  }
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
  /** Carpeta del POI. Si se entrega y tiene folder_layer_roles, el builder
   *  usa la lógica nueva (roles territoriales); si no, lógica vieja. */
  folderId?: string | null;
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
  /** Comunas con población <= a este umbral usan `isoMinutesSmallCommune`. 0 = off. */
  smallCommunePopThreshold?: number;
  isoMinutesSmallCommune?: number;
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
    smallCommunePopThreshold = 0,
    isoMinutesSmallCommune = 10,
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

  // Resolver minutos: RM/regiones, salvo que la comuna caiga bajo el umbral
  // de población, donde se usa una isócrona mayor.
  let isoMinutes = opts.isoMinutes ?? (isRm ? isoMinutesRm : isoMinutesRegions);
  let usedSmallCommuneRule = false;
  if (opts.isoMinutes == null && smallCommunePopThreshold > 0) {
    const ineIdx = await loadIneIndex();
    const communePop = comuna
      ? ineIdx.byName.get(normalizeCommuneName(comuna))?.poblacion ?? null
      : null;
    const r = isoMinutesForCommune(comuna, {
      rmMinutes: isoMinutesRm,
      regionsMinutes: isoMinutesRegions,
      communePop,
      smallCommunePopThreshold,
      smallCommuneMinutes: isoMinutesSmallCommune,
    });
    isoMinutes = r.minutes;
    usedSmallCommuneRule = r.usedSmallCommuneRule;
  }

  // Diagnóstico (visible solo en consola; ayuda al admin a verificar)
  if (resolved) {
    console.debug(
      `[features] poi=${poi.name} resolved: comuna=${comuna ?? "?"}, isRm=${isRm}, ` +
        `iso=${isoMinutes}min${usedSmallCommuneRule ? " (regla comuna pequeña)" : ""}`,
    );
  }

  // 1) Isócrona del POI
  const iso =
    precomputedIso ??
    (await fetchIsochrone(poi.lng, poi.lat, isoMinutes, supabaseUrl, supabaseAnonKey, bearer));

  // 2) Bbox de la isócrona
  const bbox = polygonBbox(iso);
  const expanded = expandBbox(bbox, 1500);

  // 3) Celdas, de mayor a menor granularidad:
  //    RM       → manzanas INE + overlay GSE.
  //    Regiones → manzanas GSE (existen para las 334 comunas del país).
  //    Fallback → una celda con la comuna entera. Último recurso: vuelve
  //               binario el nse_high_pct y sobrestima la población, así que
  //               solo se usa cuando no hay manzanas utilizables.
  let cells: ManzanaCell[] = [];
  if (isRm) {
    cells = await buildRmCells(bbox);
  } else {
    cells = await buildGseCells(iso, bbox);
  }
  // Sin celdas, o con celdas que no suman ni una persona (una isócrona que solo
  // toca parques o zona industrial), los agregados quedarían en cero: es
  // preferible la estimación comunal, más gruesa pero no vacía.
  if (!cells.length || cells.reduce((s, c) => s + c.pop, 0) <= 0) {
    cells = await buildRegionCells(poi, comuna);
  }

  // 4-6) Competidores y complementarios.
  //
  // Si la carpeta tiene folder_layer_roles configurados → lógica NUEVA
  // (territorial_features bucketizados por rol). Si no → lógica VIEJA
  // (deps.externalCompetitors + complement_weight_rules vía regex).
  let competitors: CompetitorPoi[] = [];
  let complements: ComplementCandidate[] = [];
  let anchors: ComplementCandidate[] = [];

  const folderIdEff = opts.folderId ?? poi.folder_id ?? null;
  let usedRolesPath = false;

  if (folderIdEff && ENABLE_FOLDER_LAYER_ROLES) {
    try {
      const buckets = await buildFromFolderRoles(folderIdEff, iso, bbox, isoMinutes);
      if (buckets) {
        competitors = buckets.competitors;
        complements = buckets.complements;
        anchors = buckets.anchors;
        usedRolesPath = true;
      }
    } catch (e) {
      console.warn("[features] folder_layer_roles falló, fallback a lógica vieja:", e);
    }
  }

  if (!usedRolesPath) {
    // === LÓGICA VIEJA (intacta) ===
    const internalPeers = deps.internalPeers
      .filter((p) => p.id !== poi.id)
      .filter((p) => inBbox(p, expanded));

    if (includeCompetitorIsos) {
      for (const p of internalPeers) {
        try {
          const peerIso = await fetchIsochrone(
            p.lng, p.lat, isoMinutes, supabaseUrl, supabaseAnonKey, bearer,
          );
          competitors.push({
            id: p.id, lng: p.lng, lat: p.lat,
            iso_minutes: isoMinutes, iso_polygon: peerIso, source: "internal",
          });
        } catch {
          competitors.push({
            id: p.id, lng: p.lng, lat: p.lat,
            iso_minutes: isoMinutes, source: "internal",
          });
        }
      }
    } else {
      for (const p of internalPeers) {
        competitors.push({
          id: p.id, lng: p.lng, lat: p.lat,
          iso_minutes: isoMinutes, source: "internal",
        });
      }
    }

    // 5) Competidores externos (folders y layer features)
    for (const p of deps.externalCompetitors.filter((p) => inBbox(p, expanded))) {
      competitors.push({
        id: p.id, lng: p.lng, lat: p.lat,
        iso_minutes: isoMinutes, source: "external",
      });
    }
    for (const f of deps.externalCompetitorLayerFeatures.filter((f) => inBbox(f, expanded))) {
      competitors.push({
        id: f.id, lng: f.lng, lat: f.lat,
        iso_minutes: isoMinutes, source: "external",
      });
    }

    // 6) Complementarios con regex
    const compiled: CompiledRule[] = compileRules(deps.rules);
    for (const p of deps.otherPois.filter((p) => inBbox(p, expanded))) {
      const text = `${p.name ?? ""} ${p.category ?? ""}`.trim();
      const m = matchRule(text, compiled);
      complements.push({
        id: p.id, lng: p.lng, lat: p.lat, text, weight: m.weight, label: m.label,
      });
    }
    for (const f of deps.complementaryLayerFeatures.filter((f) => inBbox(f, expanded))) {
      const text = `${f.name ?? ""} ${f.category ?? ""}`.trim();
      const m = matchRule(text, compiled);
      complements.push({
        id: f.id, lng: f.lng, lat: f.lat, text, weight: m.weight, label: m.label,
      });
    }
  }

  console.debug(
    `[features] poi=${poi.name} folder=${folderIdEff} ` +
    `usedRolesPath=${usedRolesPath} ` +
    `comp=${competitors.length} compl=${complements.length} ` +
    `ancl=${anchors.length}`,
  );

  // ── Features derivados de capas nuevas (crime, comercio, gasto endógeno) ──
  // Se computan en el cliente (todos los datos ya cargados) y la edge los fusiona.
  let territorial_extras: Record<string, number> | undefined;
  try {
    // En regiones las celdas no traen crime_score por manzana → fallback comunal
    let crimeFallbackIdx: number | null = null;
    if (!isRm && comuna) {
      crimeFallbackIdx = await crimeRiskByCommune(comuna);
    }
    const areaKm2 = area(iso) / 1_000_000;
    territorial_extras = computeTerritorialExtras({
      cells,
      isoPolygon: iso,
      areaKm2,
      isRm,
      crimeFallbackIdx,
    });
  } catch (e) {
    console.warn("[features] territorial_extras falló (continúa sin extras):", e);
    territorial_extras = undefined;
  }

  return {
    poi: {
      id: poi.id, lng: poi.lng, lat: poi.lat,
      comuna, is_rm: isRm, iso_minutes: isoMinutes,
    },
    iso_polygon: iso,
    cells,
    competitors,
    complements,
    anchors,
    config_version: deps.settings.config_version,
    use_fine_cannibalization: deps.settings.use_fine_cannibalization,
    territorial_extras,
  };
};

/** Riesgo delictivo 0-100 de una comuna (fallback para regiones sin GSE manzana). */
const crimeRiskByCommune = async (comuna: string): Promise<number | null> => {
  try {
    const data = await crimeService.load();
    const norm = normalizeCommuneName(comuna);
    const feat = data.features.find(
      (f) => normalizeCommuneName(f.properties.comuna) === norm,
    );
    if (!feat) return null;
    // risk_score viene 0-1000 → normalizar a 0-100
    return feat.properties.risk_score / 10;
  } catch {
    return null;
  }
};
