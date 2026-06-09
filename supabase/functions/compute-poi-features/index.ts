// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * compute-poi-features
 * --------------------
 * Recibe un payload pre-armado por el cliente (isócrona del POI + manzanas
 * recortadas + candidatos cercanos) y calcula los ~12 features territoriales
 * con descuento por canibalización. Persiste a poi_features_cache.
 *
 * El cliente arma el payload (ver `src/services/poiFeaturePayloadBuilder.ts`)
 * porque tiene acceso directo a los archivos estáticos de manzanas en /public.
 *
 * El servidor solo hace:
 *   1) Validación + auth (admin).
 *   2) Spatial join (point-in-polygon de cada celda en la isócrona).
 *   3) Canibalización: por cada celda dentro de la iso del POI, contar
 *      cuántas isócronas internas la cubren también. Dividir aporte.
 *   4) Agregaciones: pop, density media, % NSE, # competencia, # complementarios
 *      ponderados por su peso.
 *   5) UPSERT a poi_features_cache.
 *
 * Auth: requiere bearer token de un usuario admin. Validamos con un client
 * Supabase usando ese token; las RLS hacen el resto.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ManzanaCell {
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

interface CompetitorPoi {
  id: string;
  lng: number;
  lat: number;
  iso_minutes: number;
  iso_polygon?: any;
  source: "internal" | "external";
}

interface ComplementCandidate {
  id: string;
  lng: number;
  lat: number;
  text: string;
  weight: number;
  label: string;
}

interface FeaturePayload {
  poi: {
    id: string;
    lng: number;
    lat: number;
    comuna: string | null;
    is_rm: boolean;
    iso_minutes: number;
  };
  iso_polygon: any;
  cells: ManzanaCell[];
  competitors: CompetitorPoi[];
  complements: ComplementCandidate[];
  config_version: number;
  use_fine_cannibalization: boolean;
  /** Features derivados de capas nuevas (crime, comercio, gasto endógeno),
   *  pre-calculados en el cliente. Se fusionan tal cual en `features`. */
  territorial_extras?: Record<string, number>;
}

/* ---------- Geometría ---------- */

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

const pointInPolygon = (pt: [number, number], polygon: any): boolean => {
  if (!polygon) return false;
  if (polygon.type === "Polygon") {
    const [outer, ...holes] = polygon.coordinates;
    if (!pointInRing(pt, outer)) return false;
    for (const hole of holes) if (pointInRing(pt, hole)) return false;
    return true;
  }
  if (polygon.type === "MultiPolygon") {
    for (const poly of polygon.coordinates) {
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
  }
  return false;
};

const haversineMeters = (
  a: [number, number],
  b: [number, number],
): number => {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const aa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(aa));
};

/* ---------- Hash simple del polígono (detección de movimientos) ---------- */

const isoGeomHash = async (geom: any): Promise<string> => {
  const text = JSON.stringify(geom);
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const arr = Array.from(new Uint8Array(buf));
  return arr.slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
};

/* ---------- Cálculo de features ---------- */

const computeFeatures = (payload: FeaturePayload): Record<string, number> => {
  const { iso_polygon, cells, competitors, complements, use_fine_cannibalization } = payload;

  // 1) Filtrar celdas DENTRO de la isócrona del POI (point-in-polygon de
  //    su centroide). Para regiones tenemos una sola celda comuna que
  //    incluimos siempre (dado que el POI está dentro de su comuna).
  const cellsInside: ManzanaCell[] = payload.poi.is_rm
    ? cells.filter((c) => pointInPolygon(c.centroid, iso_polygon))
    : cells;

  // 2) Canibalización fina: por cada celda dentro, contar cuántas
  //    isócronas internas la cubren TAMBIÉN. Si k locales del chain la
  //    comparten, su aporte se divide por (k+1) (incluye el POI analizado).
  //    Si está apagado, aporte completo.
  const internalCompetitorsWithIso = competitors.filter(
    (c) => c.source === "internal" && c.iso_polygon,
  );

  const cellsWithFraction: Array<ManzanaCell & { fraction: number }> = cellsInside.map(
    (c) => {
      if (!use_fine_cannibalization || internalCompetitorsWithIso.length === 0) {
        return { ...c, fraction: 1.0 };
      }
      let coveringPeers = 0;
      for (const peer of internalCompetitorsWithIso) {
        if (pointInPolygon(c.centroid, peer.iso_polygon)) coveringPeers++;
      }
      const fraction = 1 / (coveringPeers + 1);
      return { ...c, fraction };
    },
  );

  // 3) Agregados con fracción aplicada
  let popTotal = 0;
  let popExclusive = 0; // sin canibalización (= popTotal si no hay overlap)
  let popWeightedDensity = 0;
  let popWeightedNseHigh = 0; // NSE 4-5
  let popWeightedNseMid = 0;  // NSE 3
  let popWeightedNseLow = 0;  // NSE 1-2
  let popWeightedTraffic = 0;
  let popWeightedIncome = 0;

  for (const c of cellsWithFraction) {
    const popRaw = c.pop;
    const popFr = popRaw * c.fraction;
    popTotal += popRaw;
    popExclusive += popFr;
    popWeightedDensity += c.density * popRaw;
    popWeightedTraffic += c.traffic * popRaw;
    popWeightedIncome += c.income * popRaw;
    if (c.nse >= 4) popWeightedNseHigh += popRaw;
    else if (c.nse === 3) popWeightedNseMid += popRaw;
    else popWeightedNseLow += popRaw;
  }

  const densityAvg = popTotal > 0 ? popWeightedDensity / popTotal : 0;
  const trafficIdx = popTotal > 0 ? popWeightedTraffic / popTotal : 0;
  const incomeAvg = popTotal > 0 ? popWeightedIncome / popTotal : 0;
  const nseHighPct = popTotal > 0 ? popWeightedNseHigh / popTotal : 0;
  const nseMidPct = popTotal > 0 ? popWeightedNseMid / popTotal : 0;
  const nseLowPct = popTotal > 0 ? popWeightedNseLow / popTotal : 0;

  const cannibalizationFactor = popTotal > 0 ? popExclusive / popTotal : 1;

  // 4) Competencia (point-in-polygon de los competidores en la iso)
  const competitorsInside = competitors.filter((c) =>
    pointInPolygon([c.lng, c.lat], iso_polygon),
  );
  const nCompetitionInt = competitorsInside.filter((c) => c.source === "internal").length;
  const nCompetitionExt = competitorsInside.filter((c) => c.source === "external").length;

  // Distancia al competidor más cercano (independiente de iso)
  let minDist = Infinity;
  for (const c of competitors) {
    const d = haversineMeters([payload.poi.lng, payload.poi.lat], [c.lng, c.lat]);
    if (d < minDist) minDist = d;
  }
  const distCompetition = isFinite(minDist) ? minDist : 0;

  // 5) Complementarios: suma de pesos de los que están dentro
  let complementScore = 0;
  let nAnchors = 0;
  let nMedium = 0;
  let nLow = 0;
  for (const x of complements) {
    if (!pointInPolygon([x.lng, x.lat], iso_polygon)) continue;
    complementScore += x.weight;
    if (x.weight >= 0.85) nAnchors++;
    else if (x.weight >= 0.55) nMedium++;
    else nLow++;
  }

  return {
    pop_total: Math.round(popTotal),
    pop_exclusive: Math.round(popExclusive),
    pop_density_avg: Math.round(densityAvg),
    nse_high_pct: Number(nseHighPct.toFixed(4)),
    nse_mid_pct: Number(nseMidPct.toFixed(4)),
    nse_low_pct: Number(nseLowPct.toFixed(4)),
    income_avg: Math.round(incomeAvg),
    traffic_idx: Number(trafficIdx.toFixed(2)),
    n_competition_int: nCompetitionInt,
    n_competition_ext: nCompetitionExt,
    dist_competition_m: Math.round(distCompetition),
    complement_score: Number(complementScore.toFixed(2)),
    n_anchors: nAnchors,
    n_complement_medium: nMedium,
    n_complement_low: nLow,
    cannibalization_factor: Number(cannibalizationFactor.toFixed(4)),
    cells_count: cellsInside.length,
  };
};

/* ---------- Handler ---------- */

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "missing auth" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Cliente con sesión del usuario para que las RLS validen el rol.
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });

    const payload = (await req.json()) as FeaturePayload;
    if (!payload?.poi?.id || !payload?.iso_polygon) {
      return new Response(JSON.stringify({ error: "invalid payload" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sanidad: limit cells y competitors a tamaños razonables
    if (payload.cells.length > 30_000) {
      return new Response(JSON.stringify({ error: "too many cells" }), {
        status: 413,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Features territoriales base + extras derivados de capas nuevas (crime,
    // comercio, gasto endógeno). Los extras vienen pre-calculados del cliente.
    const baseFeatures = computeFeatures(payload);
    const extras = (payload.territorial_extras ?? {}) as Record<string, number>;
    const features = { ...baseFeatures, ...extras };
    const hash = await isoGeomHash(payload.iso_polygon);

    // Buscar folder_id del POI
    const { data: poiRow, error: poiErr } = await supabase
      .from("pois")
      .select("folder_id")
      .eq("id", payload.poi.id)
      .maybeSingle();
    if (poiErr || !poiRow?.folder_id) {
      return new Response(
        JSON.stringify({ error: poiErr?.message ?? "poi not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Persistir
    const { error: upErr } = await supabase
      .from("poi_features_cache")
      .upsert(
        {
          poi_id: payload.poi.id,
          folder_id: poiRow.folder_id,
          iso_minutes: payload.poi.iso_minutes,
          is_rm: payload.poi.is_rm,
          features,
          config_version: payload.config_version,
          iso_geom_hash: hash,
          computed_at: new Date().toISOString(),
        },
        { onConflict: "poi_id" },
      );
    if (upErr) {
      return new Response(
        JSON.stringify({ error: upErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ ok: true, features, hash }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("compute-poi-features fatal:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
