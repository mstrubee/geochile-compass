import { useCallback, useEffect, useState } from "react";
import { LruCache } from "@/utils/lruCache";
import { supabase } from "@/integrations/supabase/client";
import type { TerritorialGroup, TerritorialLayer, TerritorialFeature } from "@/types/territorial";

export const useTerritorialLayers = () => {
  const [groups, setGroups] = useState<TerritorialGroup[]>([]);
  const [layers, setLayers] = useState<TerritorialLayer[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [g, l] = await Promise.all([
      supabase.from("territorial_layer_groups").select("*").order("order_index", { ascending: true }),
      supabase.from("territorial_layers").select("*").order("order_index", { ascending: true }),
    ]);
    if (!g.error) setGroups((g.data ?? []) as unknown as TerritorialGroup[]);
    if (!l.error) setLayers((l.data ?? []) as unknown as TerritorialLayer[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { groups, layers, loading, refresh };
};

/** [oeste, sur, este, norte] */
export type FeatureBbox = [number, number, number, number];

// Caché de features por layer_id (+ bbox si se pidió recortado), sobrevive a
// remounts dentro de la sesión.
/**
 * Tope alto porque las entradas son por CAPA y hay 128 capas: una sola isócrona
 * analizada agrega hasta 128 claves (capa + bbox). 400 permite tener unas tres
 * isócronas completas en caché más las capas del mapa, sin que una sesión larga
 * de análisis acumule miles de arrays de features.
 */
const featuresCache = new LruCache<string, TerritorialFeature[]>(400);
const inflightCache = new Map<string, Promise<TerritorialFeature[]>>();

/**
 * El bbox forma parte de la clave: sin él, pedir las features de una capa
 * recortadas a una isócrona dejaría ese subconjunto cacheado bajo el id de la
 * capa, y la isócrona siguiente —u otro consumidor que las quiera completas—
 * recibiría el recorte de la anterior.
 *
 * Se redondea a 4 decimales (~11 m) para que un bbox recalculado con ruido de
 * punto flotante siga cayendo en la misma entrada.
 */
const cacheKeyFor = (layerId: string, bbox?: FeatureBbox | null) =>
  bbox ? `${layerId}|${bbox.map((v) => v.toFixed(4)).join(",")}` : layerId;

export const clearTerritorialFeaturesCache = (layerId?: string) => {
  if (layerId) {
    // Cae también cualquier variante recortada por bbox de esa capa.
    for (const k of featuresCache.keys()) {
      if (k === layerId || k.startsWith(`${layerId}|`)) featuresCache.delete(k);
    }
    for (const k of [...inflightCache.keys()]) {
      if (k === layerId || k.startsWith(`${layerId}|`)) inflightCache.delete(k);
    }
  } else {
    featuresCache.clear();
    inflightCache.clear();
  }
};

const PAGE = 1000;
// Para capas grandes, omitir geometry/properties (no se usan en el render
// actual cuando las features son puntos).
const HEAVY_GEOM_THRESHOLD = 1500;

const fetchLayerFeatures = async (
  layerId: string,
  bbox?: FeatureBbox | null,
): Promise<TerritorialFeature[]> => {
  /**
   * Camino recortado: solo las features dentro del bbox.
   *
   * Un punto fuera del bbox de la isócrona no puede estar dentro del polígono,
   * así que esto no cambia ningún número del análisis — solo deja de traer lo
   * que se iba a descartar. Sobre los datos actuales pasa de 67.664 features a
   * entre 242 y 1.459 según la isócrona (98–99,6% menos).
   *
   * Tampoco se pide `feature_count`: el total de la capa no dice cuántas caen
   * en el bbox, y ese `maybeSingle` por capa costaba un round-trip por cada una
   * de las 128 capas. Acá se pagina hasta que una página venga incompleta.
   */
  if (bbox) {
    const [w, s, e, n] = bbox;
    const all: TerritorialFeature[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("territorial_features")
        .select("id,layer_id,name,lat,lng,geometry,properties")
        .eq("layer_id", layerId)
        .gte("lng", w).lte("lng", e)
        .gte("lat", s).lte("lat", n)
        .range(from, from + PAGE - 1);
      if (error || !data) break;
      all.push(...(data as unknown as TerritorialFeature[]));
      if (data.length < PAGE) break;
    }
    return all.map((f) => ({
      ...f,
      geometry: f.geometry ?? ({ type: "Point", coordinates: [f.lng ?? 0, f.lat ?? 0] } as GeoJSON.Geometry),
      properties: f.properties ?? {},
    }));
  }

  // Obtener feature_count para saber cuántas páginas pedir en paralelo.
  const { data: meta } = await supabase
    .from("territorial_layers")
    .select("feature_count")
    .eq("id", layerId)
    .maybeSingle();
  const total = meta?.feature_count ?? 0;

  const heavy = total > HEAVY_GEOM_THRESHOLD;
  const cols = heavy
    ? "id,layer_id,name,lat,lng"
    : "id,layer_id,name,lat,lng,geometry,properties";

  // Si no sabemos el total, hacer una primera página y seguir si hay más.
  if (!total) {
    const { data, error } = await supabase
      .from("territorial_features")
      .select(cols)
      .eq("layer_id", layerId)
      .range(0, PAGE - 1);
    if (error || !data) return [];
    const all = [...(data as unknown as TerritorialFeature[])];
    let from = PAGE;
    while (all.length === from) {
      const { data: more } = await supabase
        .from("territorial_features")
        .select(cols)
        .eq("layer_id", layerId)
        .range(from, from + PAGE - 1);
      if (!more || !more.length) break;
      all.push(...(more as unknown as TerritorialFeature[]));
      from += PAGE;
    }
    return all.map((f) => ({
      ...f,
      geometry: f.geometry ?? ({ type: "Point", coordinates: [f.lng ?? 0, f.lat ?? 0] } as GeoJSON.Geometry),
      properties: f.properties ?? {},
    }));
  }

  // Paginación con concurrencia limitada: evita disparar decenas de requests
  // simultáneos cuando hay capas grandes o varias capas activadas a la vez.
  const pageCount = Math.ceil(total / PAGE);
  const PAGE_CONCURRENCY = 3;
  const results: TerritorialFeature[][] = new Array(pageCount);
  let nextIdx = 0;
  const worker = async () => {
    while (true) {
      const i = nextIdx++;
      if (i >= pageCount) return;
      const { data } = await supabase
        .from("territorial_features")
        .select(cols)
        .eq("layer_id", layerId)
        .range(i * PAGE, i * PAGE + PAGE - 1);
      results[i] = (data ?? []) as unknown as TerritorialFeature[];
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PAGE_CONCURRENCY, pageCount) }, () => worker()),
  );
  const flat = results.flat();
  // Si vinimos en modo "heavy" sin geometry, sintetizar Point para los renders que la requieran.
  return flat.map((f) => ({
    ...f,
    geometry: f.geometry ?? ({ type: "Point", coordinates: [f.lng ?? 0, f.lat ?? 0] } as GeoJSON.Geometry),
    properties: f.properties ?? {},
  }));
};

/**
 * Trae las features de VARIAS capas de una sola vez, filtradas al mismo bbox.
 *
 * El camino recortado (bbox) antes pedía una capa a la vez: analizar una
 * isócrona dispara esto para las ~128 capas territoriales existentes, así que
 * abría hasta 128 round-trips (2 en paralelo) aunque el total de features
 * dentro del bbox rara vez pasa de unos pocos miles — el mismo comentario de
 * `fetchLayerFeatures` ya medía 242 a 1.459 features típicas en TODA la red de
 * capas. Un solo `.in(layer_id, ...)` trae lo mismo en 1-2 páginas.
 */
const fetchLayersFeaturesBatched = async (
  layerIds: string[],
  bbox: FeatureBbox,
): Promise<Map<string, TerritorialFeature[]>> => {
  const [w, s, e, n] = bbox;
  const all: TerritorialFeature[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("territorial_features")
      .select("id,layer_id,name,lat,lng,geometry,properties")
      .in("layer_id", layerIds)
      .gte("lng", w).lte("lng", e)
      .gte("lat", s).lte("lat", n)
      .range(from, from + PAGE - 1);
    if (error || !data) break;
    all.push(...(data as unknown as TerritorialFeature[]));
    if (data.length < PAGE) break;
  }
  const byLayer = new Map<string, TerritorialFeature[]>(layerIds.map((id) => [id, []]));
  for (const f of all) {
    const normalized: TerritorialFeature = {
      ...f,
      geometry: f.geometry ?? ({ type: "Point", coordinates: [f.lng ?? 0, f.lat ?? 0] } as GeoJSON.Geometry),
      properties: f.properties ?? {},
    };
    const arr = byLayer.get(f.layer_id);
    if (arr) arr.push(normalized);
    else byLayer.set(f.layer_id, [normalized]);
  }
  return byLayer;
};

const inflightBatchCache = new Map<string, Promise<Map<string, TerritorialFeature[]>>>();

/** Dedup por lote: dos consumidores pidiendo el mismo bbox (p.ej. el panel de
 *  análisis y el informe exportable de la misma isócrona) comparten un único
 *  request en vez de disparar cada uno el suyo. */
const getLayersFeaturesBboxBatched = (
  layerIds: string[],
  bbox: FeatureBbox,
): Promise<Map<string, TerritorialFeature[]>> => {
  const batchKey = `${layerIds.slice().sort().join(",")}|${bbox.map((v) => v.toFixed(4)).join(",")}`;
  const inflight = inflightBatchCache.get(batchKey);
  if (inflight) return inflight;
  const p = fetchLayersFeaturesBatched(layerIds, bbox)
    .then((byLayer) => {
      for (const [id, feats] of byLayer) featuresCache.set(cacheKeyFor(id, bbox), feats);
      inflightBatchCache.delete(batchKey);
      return byLayer;
    })
    .catch((e) => {
      inflightBatchCache.delete(batchKey);
      throw e;
    });
  inflightBatchCache.set(batchKey, p);
  return p;
};

const getLayerFeatures = (
  layerId: string,
  bbox?: FeatureBbox | null,
): Promise<TerritorialFeature[]> => {
  const ck = cacheKeyFor(layerId, bbox);
  const cached = featuresCache.get(ck);
  if (cached) return Promise.resolve(cached);
  // Si ya tenemos la capa COMPLETA en caché, el recorte se hace en memoria en
  // vez de pedirla otra vez: el superconjunto ya está pago.
  if (bbox) {
    const full = featuresCache.get(layerId);
    if (full) {
      const [w, s, e, n] = bbox;
      const clipped = full.filter(
        (f) => f.lng != null && f.lat != null &&
          f.lng >= w && f.lng <= e && f.lat >= s && f.lat <= n,
      );
      featuresCache.set(ck, clipped);
      return Promise.resolve(clipped);
    }
  }
  const inflight = inflightCache.get(ck);
  if (inflight) return inflight;
  const p = fetchLayerFeatures(layerId, bbox)
    .then((feats) => {
      featuresCache.set(ck, feats);
      inflightCache.delete(ck);
      return feats;
    })
    .catch((e) => {
      inflightCache.delete(ck);
      throw e;
    });
  inflightCache.set(ck, p);
  return p;
};

/**
 * `bbox` recorta la consulta al área dada. Los consumidores de análisis lo
 * pasan (el bbox de la isócrona); el render del mapa no, y su comportamiento
 * queda idéntico.
 */
export const useTerritorialFeatures = (
  layerIds: string[],
  bbox?: FeatureBbox | null,
) => {
  const [features, setFeatures] = useState<TerritorialFeature[]>([]);
  const bboxKey = bbox ? bbox.map((v) => v.toFixed(4)).join(",") : "";
  const key = `${layerIds.slice().sort().join(",")}#${bboxKey}`;

  useEffect(() => {
    let cancel = false;
    if (!layerIds.length) {
      setFeatures([]);
      return;
    }

    // Mostrar inmediatamente lo cacheado mientras se cargan las capas faltantes.
    const cachedNow: TerritorialFeature[] = [];
    layerIds.forEach((id) => {
      const c = featuresCache.get(cacheKeyFor(id, bbox));
      if (c) cachedNow.push(...c);
    });
    if (cachedNow.length) setFeatures(cachedNow);

    (async () => {
      try {
        if (bbox) {
          // Analizar una isócrona pide TODAS las capas territoriales (~128)
          // recortadas al mismo bbox. Antes esto abría un round-trip por
          // capa; acá se resuelve lo ya cacheado en memoria (caché exacta o
          // capa completa recortada localmente) y el resto se trae en UN
          // solo `.in(layer_id, ...)` — ver `getLayersFeaturesBboxBatched`.
          const resolved = new Map<string, TerritorialFeature[]>();
          const missing: string[] = [];
          for (const id of layerIds) {
            const ck = cacheKeyFor(id, bbox);
            const cached = featuresCache.get(ck);
            if (cached) { resolved.set(id, cached); continue; }
            const full = featuresCache.get(id);
            if (full) {
              const [w, s, e, n] = bbox;
              const clipped = full.filter(
                (f) => f.lng != null && f.lat != null &&
                  f.lng >= w && f.lng <= e && f.lat >= s && f.lat <= n,
              );
              featuresCache.set(ck, clipped);
              resolved.set(id, clipped);
              continue;
            }
            missing.push(id);
          }
          if (missing.length) {
            const byLayer = await getLayersFeaturesBboxBatched(missing, bbox);
            if (cancel) return;
            for (const [id, feats] of byLayer) resolved.set(id, feats);
          }
          if (cancel) return;
          setFeatures(layerIds.flatMap((id) => resolved.get(id) ?? []));
          return;
        }

        // Sin bbox (render del mapa): igual que antes, una capa a la vez con
        // concurrencia limitada — acá cada capa completa puede ser grande y
        // conviene no disparar todas a la vez.
        const LAYER_CONCURRENCY = 2;
        const lists: TerritorialFeature[][] = new Array(layerIds.length);
        let i = 0;
        const worker = async () => {
          while (true) {
            const idx = i++;
            if (idx >= layerIds.length) return;
            lists[idx] = await getLayerFeatures(layerIds[idx], bbox);
            if (cancel) return;
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(LAYER_CONCURRENCY, layerIds.length) }, () => worker()),
        );
        if (cancel) return;
        setFeatures(lists.flat());
      } catch (e) {
        if (!cancel) console.warn("[useTerritorialFeatures] error", e);
      }
    })();

    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return features;
};
